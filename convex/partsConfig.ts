import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin, requireUser } from "./lib/auth";

const methodValidator = v.object({
  id: v.id("manufacturingMethods"), code: v.string(), name: v.string(), active: v.boolean(),
});
const materialValidator = v.object({
  id: v.id("materials"), code: v.string(), name: v.string(), active: v.boolean(),
  methodIds: v.array(v.id("manufacturingMethods")),
});
const subsystemValidator = v.object({ id: v.id("subsystems"), code: v.string(), name: v.string() });
const designerValidator = v.object({ id: v.id("users"), name: v.string() });
const settingsValidator = v.object({
  title: v.string(), nameLabel: v.string(), quantityLabel: v.string(), subsystemLabel: v.string(),
  designerLabel: v.string(), methodLabel: v.string(), materialLabel: v.string(), submitLabel: v.string(),
});

async function settings(ctx: Parameters<typeof requireUser>[0]) {
  const keys = ["partsFormTitle", "partsNameLabel", "partsQuantityLabel", "partsSubsystemLabel",
    "partsDesignerLabel", "partsMethodLabel", "partsMaterialLabel", "partsSubmitLabel"] as const;
  const values = new Map<string, string>();
  for (const key of keys) {
    const row = await ctx.db.query("appSettings").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (row) values.set(key, row.value);
  }
  return {
    title: values.get("partsFormTitle") ?? "Registrar peça",
    nameLabel: values.get("partsNameLabel") ?? "Nome da peça",
    quantityLabel: values.get("partsQuantityLabel") ?? "Quantidade",
    subsystemLabel: values.get("partsSubsystemLabel") ?? "Subsistema",
    designerLabel: values.get("partsDesignerLabel") ?? "Designer",
    methodLabel: values.get("partsMethodLabel") ?? "Método de fabricação",
    materialLabel: values.get("partsMaterialLabel") ?? "Material",
    submitLabel: values.get("partsSubmitLabel") ?? "Registrar peça",
  };
}

export const get = query({
  args: {},
  returns: v.object({
    settings: settingsValidator,
    subsystems: v.array(subsystemValidator), designers: v.array(designerValidator),
    methods: v.array(methodValidator), materials: v.array(materialValidator),
  }),
  handler: async (ctx) => {
    await requireUser(ctx);
    const [subsystems, users, methods, materials] = await Promise.all([
      ctx.db.query("subsystems").order("asc").take(100),
      ctx.db.query("users").withIndex("by_status", (q) => q.eq("status", "ACTIVE")).take(100),
      ctx.db.query("manufacturingMethods").order("asc").take(100),
      ctx.db.query("materials").order("asc").take(100),
    ]);
    const materialOutput = [];
    for (const material of materials) {
      const mappings = await ctx.db.query("manufacturingMethodMaterials")
        .withIndex("by_materialId_and_manufacturingMethodId", (q) => q.eq("materialId", material._id))
        .take(100);
      materialOutput.push({ id: material._id, code: material.code, name: material.name, active: material.active,
        methodIds: mappings.map((item) => item.manufacturingMethodId) });
    }
    return {
      settings: await settings(ctx),
      subsystems: subsystems.filter((item) => item.active).map((item) => ({ id: item._id, code: item.code, name: item.name })),
      designers: users.map((item) => ({ id: item._id, name: item.displayName ?? item.name ?? item.email ?? "User" })),
      methods: methods.map((item) => ({ id: item._id, code: item.code, name: item.name, active: item.active })),
      materials: materialOutput,
    };
  },
});

function normalizedCode(value: string) {
  const code = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  if (code.length < 2) throw new Error("Code must contain at least two letters or numbers.");
  return code;
}

export const saveSettings = mutation({
  args: settingsValidator.fields,
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const pairs = [
      ["partsFormTitle", args.title], ["partsNameLabel", args.nameLabel], ["partsQuantityLabel", args.quantityLabel],
      ["partsSubsystemLabel", args.subsystemLabel], ["partsDesignerLabel", args.designerLabel],
      ["partsMethodLabel", args.methodLabel], ["partsMaterialLabel", args.materialLabel], ["partsSubmitLabel", args.submitLabel],
    ] as const;
    for (const [key, rawValue] of pairs) {
      const value = rawValue.trim();
      if (value.length < 2 || value.length > 100) throw new Error("Each form label must contain 2 to 100 characters.");
      const existing = await ctx.db.query("appSettings").withIndex("by_key", (q) => q.eq("key", key)).unique();
      if (existing) await ctx.db.patch("appSettings", existing._id, { value });
      else await ctx.db.insert("appSettings", { key, value });
    }
    await ctx.db.insert("auditEvents", { actorUserId: admin._id, action: "PARTS_FORM_UPDATED", targetType: "settings",
      targetId: "parts-tracking", summary: "Updated Parts Tracking labels.", createdAt: Date.now() });
    return null;
  },
});

export const addMethod = mutation({
  args: { name: v.string(), code: v.string() }, returns: v.id("manufacturingMethods"),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const name = args.name.trim(); const code = normalizedCode(args.code || name);
    if (name.length < 2 || name.length > 100) throw new Error("Enter a valid method name.");
    if (await ctx.db.query("manufacturingMethods").withIndex("by_code", (q) => q.eq("code", code)).unique()) throw new Error("That method code already exists.");
    return await ctx.db.insert("manufacturingMethods", { name, code, active: true });
  },
});

export const updateMethod = mutation({
  args: { id: v.id("manufacturingMethods"), name: v.string(), active: v.boolean() }, returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx); const name = args.name.trim();
    if (name.length < 2 || name.length > 100) throw new Error("Enter a valid method name.");
    await ctx.db.patch("manufacturingMethods", args.id, { name, active: args.active }); return null;
  },
});

export const deleteMethod = mutation({
  args: { id: v.id("manufacturingMethods") }, returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    if (await ctx.db.query("parts").withIndex("by_manufacturingMethodId", (q) => q.eq("manufacturingMethodId", args.id)).first()) {
      throw new Error("This method is used by a registered part. Disable it instead.");
    }
    const mappings = await ctx.db.query("manufacturingMethodMaterials")
      .withIndex("by_manufacturingMethodId_and_materialId", (q) => q.eq("manufacturingMethodId", args.id)).take(100);
    for (const mapping of mappings) await ctx.db.delete("manufacturingMethodMaterials", mapping._id);
    await ctx.db.delete("manufacturingMethods", args.id); return null;
  },
});

export const addMaterial = mutation({
  args: { name: v.string(), code: v.string(), methodIds: v.array(v.id("manufacturingMethods")) }, returns: v.id("materials"),
  handler: async (ctx, args) => {
    await requireAdmin(ctx); const name = args.name.trim(); const code = normalizedCode(args.code || name);
    if (name.length < 2 || name.length > 100) throw new Error("Enter a valid material name.");
    if (await ctx.db.query("materials").withIndex("by_code", (q) => q.eq("code", code)).unique()) throw new Error("That material code already exists.");
    const materialId = await ctx.db.insert("materials", { name, code, active: true });
    for (const methodId of [...new Set(args.methodIds)]) {
      if (await ctx.db.get("manufacturingMethods", methodId)) await ctx.db.insert("manufacturingMethodMaterials", { materialId, manufacturingMethodId: methodId });
    }
    return materialId;
  },
});

export const updateMaterial = mutation({
  args: { id: v.id("materials"), name: v.string(), active: v.boolean(), methodIds: v.array(v.id("manufacturingMethods")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx); const name = args.name.trim();
    if (name.length < 2 || name.length > 100) throw new Error("Enter a valid material name.");
    await ctx.db.patch("materials", args.id, { name, active: args.active });
    const mappings = await ctx.db.query("manufacturingMethodMaterials")
      .withIndex("by_materialId_and_manufacturingMethodId", (q) => q.eq("materialId", args.id)).take(100);
    for (const mapping of mappings) await ctx.db.delete("manufacturingMethodMaterials", mapping._id);
    for (const methodId of [...new Set(args.methodIds)]) await ctx.db.insert("manufacturingMethodMaterials", { materialId: args.id, manufacturingMethodId: methodId });
    return null;
  },
});

export const deleteMaterial = mutation({
  args: { id: v.id("materials") }, returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    if (await ctx.db.query("parts").withIndex("by_materialId", (q) => q.eq("materialId", args.id)).first()) throw new Error("This material is used by a registered part. Disable it instead.");
    const mappings = await ctx.db.query("manufacturingMethodMaterials")
      .withIndex("by_materialId_and_manufacturingMethodId", (q) => q.eq("materialId", args.id)).take(100);
    for (const mapping of mappings) await ctx.db.delete("manufacturingMethodMaterials", mapping._id);
    await ctx.db.delete("materials", args.id); return null;
  },
});
