import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./lib/auth";

const fieldTypeValidator = v.union(v.literal("STRING"), v.literal("BOOLEAN"), v.literal("SELECT"), v.literal("MEASUREMENT"));
const typeValidator = v.object({ id: v.id("cotsTypes"), name: v.string(), slug: v.string(), code: v.string(), icon: v.string(), sortOrder: v.number(), active: v.boolean() });
const statusValidator = v.object({ id: v.id("cotsStatuses"), name: v.string(), code: v.string(), sortOrder: v.number(), active: v.boolean() });
const fieldValidator = v.object({ id: v.id("cotsFieldDefinitions"), cotsTypeId: v.id("cotsTypes"), key: v.string(), code: v.string(), label: v.string(), fieldType: fieldTypeValidator, sortOrder: v.number(), active: v.boolean() });
const optionValidator = v.object({ id: v.id("cotsFieldOptions"), fieldDefinitionId: v.id("cotsFieldDefinitions"), label: v.string(), value: v.string(), sortOrder: v.number(), active: v.boolean() });

function normalizedKey(value: string) {
  const key = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  if (key.length < 2) throw new Error("Enter a key with at least two letters or numbers.");
  return key;
}

function normalizedCode(value: string) {
  const code = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 18);
  if (!code) throw new Error("Enter a code with at least one letter or number.");
  return code;
}

function normalizedOptionValue(value: string) {
  const result = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  if (!result) throw new Error("Enter a valid option value.");
  return result;
}

function validOrder(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 100_000) throw new Error("Order must be a whole number from 0 to 100,000.");
  return value;
}

export const get = query({
  args: {}, returns: v.object({ types: v.array(typeValidator), statuses: v.array(statusValidator), fields: v.array(fieldValidator), options: v.array(optionValidator) }),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const [types, statuses] = await Promise.all([ctx.db.query("cotsTypes").order("asc").take(100), ctx.db.query("cotsStatuses").order("asc").take(100)]);
    const fields = [];
    const options = [];
    for (const type of types) {
      const definitions = await ctx.db.query("cotsFieldDefinitions").withIndex("by_cotsTypeId_and_sortOrder", (q) => q.eq("cotsTypeId", type._id)).take(100);
      fields.push(...definitions);
      for (const definition of definitions) {
        options.push(...await ctx.db.query("cotsFieldOptions").withIndex("by_fieldDefinitionId_and_sortOrder", (q) => q.eq("fieldDefinitionId", definition._id)).take(100));
      }
    }
    return {
      types: types.map((row) => ({ id: row._id, name: row.name, slug: row.slug, code: row.code ?? normalizedCode(row.slug), icon: row.icon, sortOrder: row.sortOrder, active: row.active })),
      statuses: statuses.map((row) => ({ id: row._id, name: row.name, code: row.code, sortOrder: row.sortOrder, active: row.active })),
      fields: fields.map((row) => ({ id: row._id, cotsTypeId: row.cotsTypeId, key: row.key, code: row.code ?? normalizedCode(row.key), label: row.label, fieldType: row.fieldType ?? "STRING" as const, sortOrder: row.sortOrder, active: row.active })),
      options: options.map((row) => ({ id: row._id, fieldDefinitionId: row.fieldDefinitionId, label: row.label, value: row.value, sortOrder: row.sortOrder, active: row.active })),
    };
  },
});

export const addType = mutation({
  args: { name: v.string(), slug: v.string(), code: v.string(), icon: v.string(), sortOrder: v.number() }, returns: v.id("cotsTypes"),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const name = args.name.trim(); const slug = normalizedKey(args.slug || name); const code = normalizedCode(args.code || slug); const icon = args.icon.trim();
    if (name.length < 2 || name.length > 100 || !icon || icon.length > 500) throw new Error("Enter a valid COTS type name and icon/image URL.");
    if (await ctx.db.query("cotsTypes").withIndex("by_slug", (q) => q.eq("slug", slug)).unique()) throw new Error("That COTS type slug already exists.");
    return await ctx.db.insert("cotsTypes", { name, slug, code, icon, sortOrder: validOrder(args.sortOrder), active: true });
  },
});

export const updateType = mutation({
  args: { id: v.id("cotsTypes"), name: v.string(), code: v.string(), icon: v.string(), sortOrder: v.number(), active: v.boolean() }, returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx); const name = args.name.trim(); const icon = args.icon.trim();
    if (name.length < 2 || name.length > 100 || !icon || icon.length > 500) throw new Error("Enter a valid COTS type name and icon/image URL.");
    await ctx.db.patch("cotsTypes", args.id, { name, code: normalizedCode(args.code), icon, sortOrder: validOrder(args.sortOrder), active: args.active }); return null;
  },
});

export const deleteType = mutation({
  args: { id: v.id("cotsTypes") }, returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    if (await ctx.db.query("cotsItems").withIndex("by_cotsTypeId", (q) => q.eq("cotsTypeId", args.id)).first()) throw new Error("This type contains COTS items. Disable it instead.");
    const fields = await ctx.db.query("cotsFieldDefinitions").withIndex("by_cotsTypeId_and_sortOrder", (q) => q.eq("cotsTypeId", args.id)).take(100);
    for (const field of fields) {
      const options = await ctx.db.query("cotsFieldOptions").withIndex("by_fieldDefinitionId_and_sortOrder", (q) => q.eq("fieldDefinitionId", field._id)).take(100);
      for (const option of options) await ctx.db.delete("cotsFieldOptions", option._id);
      await ctx.db.delete("cotsFieldDefinitions", field._id);
    }
    await ctx.db.delete("cotsTypes", args.id); return null;
  },
});

export const addStatus = mutation({
  args: { name: v.string(), code: v.string(), sortOrder: v.number() }, returns: v.id("cotsStatuses"),
  handler: async (ctx, args) => {
    await requireAdmin(ctx); const name = args.name.trim(); const code = normalizedCode(args.code || name);
    if (name.length < 2 || name.length > 100) throw new Error("Enter a valid quantity status name.");
    if (await ctx.db.query("cotsStatuses").withIndex("by_code", (q) => q.eq("code", code)).unique()) throw new Error("That status code already exists.");
    return await ctx.db.insert("cotsStatuses", { name, code, sortOrder: validOrder(args.sortOrder), active: true });
  },
});

export const updateStatus = mutation({
  args: { id: v.id("cotsStatuses"), name: v.string(), sortOrder: v.number(), active: v.boolean() }, returns: v.null(),
  handler: async (ctx, args) => { await requireAdmin(ctx); const name = args.name.trim(); if (name.length < 2 || name.length > 100) throw new Error("Enter a valid quantity status name."); await ctx.db.patch("cotsStatuses", args.id, { name, sortOrder: validOrder(args.sortOrder), active: args.active }); return null; },
});

export const deleteStatus = mutation({
  args: { id: v.id("cotsStatuses") }, returns: v.null(),
  handler: async (ctx, args) => { await requireAdmin(ctx); if (await ctx.db.query("cotsItemQuantities").withIndex("by_statusId", (q) => q.eq("statusId", args.id)).first()) throw new Error("This status is used by COTS inventory. Disable it instead."); await ctx.db.delete("cotsStatuses", args.id); return null; },
});

export const addField = mutation({
  args: { cotsTypeId: v.id("cotsTypes"), label: v.string(), key: v.string(), code: v.string(), fieldType: fieldTypeValidator, sortOrder: v.number() }, returns: v.id("cotsFieldDefinitions"),
  handler: async (ctx, args) => {
    await requireAdmin(ctx); const type = await ctx.db.get("cotsTypes", args.cotsTypeId); const label = args.label.trim(); const key = normalizedKey(args.key || label);
    if (!type) throw new Error("COTS type not found.");
    if (label.length < 2 || label.length > 100) throw new Error("Enter a valid question label.");
    if (await ctx.db.query("cotsFieldDefinitions").withIndex("by_cotsTypeId_and_key", (q) => q.eq("cotsTypeId", type._id).eq("key", key)).unique()) throw new Error("That question key already exists for this type.");
    return await ctx.db.insert("cotsFieldDefinitions", { cotsTypeId: type._id, label, key, code: normalizedCode(args.code || key), fieldType: args.fieldType, sortOrder: validOrder(args.sortOrder), active: true });
  },
});

export const updateField = mutation({
  args: { id: v.id("cotsFieldDefinitions"), label: v.string(), code: v.string(), fieldType: fieldTypeValidator, sortOrder: v.number(), active: v.boolean() }, returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx); const label = args.label.trim(); if (label.length < 2 || label.length > 100) throw new Error("Enter a valid question label.");
    const existing = await ctx.db.get("cotsFieldDefinitions", args.id); if (!existing) throw new Error("Question not found.");
    if ((existing.fieldType ?? "STRING") !== args.fieldType) {
      const savedValues = await ctx.db.query("cotsItemFieldValues").withIndex("by_fieldDefinitionId", (q) => q.eq("fieldDefinitionId", args.id)).take(500);
      const canConvertToMeasurement = args.fieldType === "MEASUREMENT" && savedValues.every((row) => {
        const value = Number(row.value); return Number.isFinite(value) && value >= 0 && value <= 1_000_000;
      });
      if (savedValues.length > 0 && !canConvertToMeasurement) throw new Error("The answer type cannot change after values have been saved.");
    }
    await ctx.db.patch("cotsFieldDefinitions", args.id, { label, code: normalizedCode(args.code), fieldType: args.fieldType, sortOrder: validOrder(args.sortOrder), active: args.active }); return null;
  },
});

export const deleteField = mutation({
  args: { id: v.id("cotsFieldDefinitions") }, returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const [values, options] = await Promise.all([
      ctx.db.query("cotsItemFieldValues").withIndex("by_fieldDefinitionId", (q) => q.eq("fieldDefinitionId", args.id)).take(500),
      ctx.db.query("cotsFieldOptions").withIndex("by_fieldDefinitionId_and_sortOrder", (q) => q.eq("fieldDefinitionId", args.id)).take(100),
    ]);
    for (const value of values) await ctx.db.delete("cotsItemFieldValues", value._id);
    for (const option of options) await ctx.db.delete("cotsFieldOptions", option._id);
    await ctx.db.delete("cotsFieldDefinitions", args.id); return null;
  },
});

export const addOption = mutation({
  args: { fieldDefinitionId: v.id("cotsFieldDefinitions"), label: v.string(), value: v.string(), sortOrder: v.number() }, returns: v.id("cotsFieldOptions"),
  handler: async (ctx, args) => {
    await requireAdmin(ctx); const field = await ctx.db.get("cotsFieldDefinitions", args.fieldDefinitionId); const label = args.label.trim(); const value = normalizedOptionValue(args.value || label);
    if (!field || (field.fieldType ?? "STRING") !== "SELECT") throw new Error("Options can only be added to selection questions.");
    if (!label || label.length > 100) throw new Error("Enter a valid option label.");
    if (await ctx.db.query("cotsFieldOptions").withIndex("by_fieldDefinitionId_and_value", (q) => q.eq("fieldDefinitionId", field._id).eq("value", value)).unique()) throw new Error("That option value already exists.");
    return await ctx.db.insert("cotsFieldOptions", { fieldDefinitionId: field._id, label, value, sortOrder: validOrder(args.sortOrder), active: true });
  },
});

export const updateOption = mutation({
  args: { id: v.id("cotsFieldOptions"), label: v.string(), sortOrder: v.number(), active: v.boolean() }, returns: v.null(),
  handler: async (ctx, args) => { await requireAdmin(ctx); const label = args.label.trim(); if (!label || label.length > 100) throw new Error("Enter a valid option label."); await ctx.db.patch("cotsFieldOptions", args.id, { label, sortOrder: validOrder(args.sortOrder), active: args.active }); return null; },
});

export const deleteOption = mutation({
  args: { id: v.id("cotsFieldOptions") }, returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx); const option = await ctx.db.get("cotsFieldOptions", args.id); if (!option) throw new Error("Option not found.");
    const values = await ctx.db.query("cotsItemFieldValues").withIndex("by_fieldDefinitionId", (q) => q.eq("fieldDefinitionId", option.fieldDefinitionId)).take(500);
    if (values.some((row) => row.value === option.value)) throw new Error("This option is already used. Disable it instead.");
    await ctx.db.delete("cotsFieldOptions", option._id); return null;
  },
});
