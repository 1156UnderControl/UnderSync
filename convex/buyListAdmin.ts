import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./lib/auth";

const fieldTypeValidator = v.union(v.literal("STRING"), v.literal("BOOLEAN"));
const settingsValidator = v.object({ title: v.string(), description: v.string(), addLabel: v.string() });
const typeValidator = v.object({ id: v.id("buyListTypes"), name: v.string(), slug: v.string(), icon: v.string(), sortOrder: v.number(), active: v.boolean() });
const fieldValidator = v.object({ id: v.id("buyListFieldDefinitions"), buyListTypeId: v.id("buyListTypes"), key: v.string(), label: v.string(), fieldType: fieldTypeValidator, sortOrder: v.number(), active: v.boolean() });

function normalizedKey(value: string): string {
  const key = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  if (key.length < 2) throw new Error("Enter a key with at least two letters or numbers.");
  return key;
}
function validOrder(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 100_000) throw new Error("Order must be from 0 to 100,000.");
  return value;
}

async function readSettings(ctx: Parameters<typeof requireAdmin>[0]) {
  const defaults = { buyListTitle: "Buy List", buyListDescription: "Organize everything the team needs to purchase.", buyListAddLabel: "Add item" };
  const output = new Map<string, string>();
  for (const key of Object.keys(defaults)) {
    const row = await ctx.db.query("appSettings").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (row) output.set(key, row.value);
  }
  return {
    title: output.get("buyListTitle") ?? defaults.buyListTitle,
    description: output.get("buyListDescription") ?? defaults.buyListDescription,
    addLabel: output.get("buyListAddLabel") ?? defaults.buyListAddLabel,
  };
}

export const get = query({
  args: {},
  returns: v.object({ settings: settingsValidator, types: v.array(typeValidator), fields: v.array(fieldValidator) }),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const types = await ctx.db.query("buyListTypes").order("asc").take(100);
    const fields = [];
    for (const type of types) {
      fields.push(...await ctx.db.query("buyListFieldDefinitions")
        .withIndex("by_buyListTypeId_and_sortOrder", (q) => q.eq("buyListTypeId", type._id)).take(100));
    }
    return {
      settings: await readSettings(ctx),
      types: types.map((row) => ({ id: row._id, name: row.name, slug: row.slug, icon: row.icon, sortOrder: row.sortOrder, active: row.active })),
      fields: fields.map((row) => ({ id: row._id, buyListTypeId: row.buyListTypeId, key: row.key, label: row.label, fieldType: row.fieldType, sortOrder: row.sortOrder, active: row.active })),
    };
  },
});

export const saveSettings = mutation({
  args: settingsValidator.fields,
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const entries = [["buyListTitle", args.title], ["buyListDescription", args.description], ["buyListAddLabel", args.addLabel]] as const;
    for (const [key, raw] of entries) {
      const value = raw.trim();
      if (value.length < 2 || value.length > 200) throw new Error("Buy-list labels must contain 2 to 200 characters.");
      const row = await ctx.db.query("appSettings").withIndex("by_key", (q) => q.eq("key", key)).unique();
      if (row) await ctx.db.patch("appSettings", row._id, { value });
      else await ctx.db.insert("appSettings", { key, value });
    }
    await ctx.db.insert("auditEvents", { actorUserId: admin._id, action: "BUY_LIST_SETTINGS_UPDATED", targetType: "settings", targetId: "buy-list", summary: "Updated Buy List labels.", createdAt: Date.now() });
    return null;
  },
});

export const addType = mutation({
  args: { name: v.string(), slug: v.string(), icon: v.string(), sortOrder: v.number() },
  returns: v.id("buyListTypes"),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const name = args.name.trim(); const slug = normalizedKey(args.slug || name); const icon = args.icon.trim();
    if (name.length < 2 || name.length > 100 || icon.length < 1 || icon.length > 500) throw new Error("Enter a valid category name and icon.");
    if (await ctx.db.query("buyListTypes").withIndex("by_slug", (q) => q.eq("slug", slug)).unique()) throw new Error("That category slug already exists.");
    return await ctx.db.insert("buyListTypes", { name, slug, icon, sortOrder: validOrder(args.sortOrder), active: true });
  },
});

export const updateType = mutation({
  args: { id: v.id("buyListTypes"), name: v.string(), icon: v.string(), sortOrder: v.number(), active: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx); const name = args.name.trim(); const icon = args.icon.trim();
    if (name.length < 2 || name.length > 100 || icon.length < 1 || icon.length > 500) throw new Error("Enter a valid category name and icon.");
    await ctx.db.patch("buyListTypes", args.id, { name, icon, sortOrder: validOrder(args.sortOrder), active: args.active }); return null;
  },
});

export const deleteType = mutation({
  args: { id: v.id("buyListTypes") }, returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    if (await ctx.db.query("buyListItems").withIndex("by_buyListTypeId", (q) => q.eq("buyListTypeId", args.id)).first()) {
      throw new Error("This category contains items. Disable it instead.");
    }
    const fields = await ctx.db.query("buyListFieldDefinitions")
      .withIndex("by_buyListTypeId_and_sortOrder", (q) => q.eq("buyListTypeId", args.id)).take(100);
    for (const field of fields) await ctx.db.delete("buyListFieldDefinitions", field._id);
    await ctx.db.delete("buyListTypes", args.id); return null;
  },
});

export const addField = mutation({
  args: { buyListTypeId: v.id("buyListTypes"), label: v.string(), key: v.string(), fieldType: fieldTypeValidator, sortOrder: v.number() },
  returns: v.id("buyListFieldDefinitions"),
  handler: async (ctx, args) => {
    await requireAdmin(ctx); const type = await ctx.db.get("buyListTypes", args.buyListTypeId);
    const label = args.label.trim(); const key = normalizedKey(args.key || label);
    if (!type) throw new Error("Buy-list category not found.");
    if (label.length < 2 || label.length > 100) throw new Error("Enter a valid question label.");
    if (await ctx.db.query("buyListFieldDefinitions").withIndex("by_buyListTypeId_and_key", (q) => q.eq("buyListTypeId", type._id).eq("key", key)).unique()) throw new Error("That question key already exists.");
    return await ctx.db.insert("buyListFieldDefinitions", { buyListTypeId: type._id, label, key, fieldType: args.fieldType, sortOrder: validOrder(args.sortOrder), active: true });
  },
});

export const updateField = mutation({
  args: { id: v.id("buyListFieldDefinitions"), label: v.string(), fieldType: fieldTypeValidator, sortOrder: v.number(), active: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx); const label = args.label.trim();
    if (label.length < 2 || label.length > 100) throw new Error("Enter a valid question label.");
    const existing = await ctx.db.get("buyListFieldDefinitions", args.id);
    if (!existing) throw new Error("Question not found.");
    if (existing.fieldType !== args.fieldType && await ctx.db.query("buyListItemFieldValues").withIndex("by_fieldDefinitionId", (q) => q.eq("fieldDefinitionId", args.id)).first()) {
      throw new Error("The answer type cannot change after values have been saved.");
    }
    await ctx.db.patch("buyListFieldDefinitions", args.id, { label, fieldType: args.fieldType, sortOrder: validOrder(args.sortOrder), active: args.active }); return null;
  },
});

export const deleteField = mutation({
  args: { id: v.id("buyListFieldDefinitions") }, returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const values = await ctx.db.query("buyListItemFieldValues").withIndex("by_fieldDefinitionId", (q) => q.eq("fieldDefinitionId", args.id)).take(500);
    for (const value of values) await ctx.db.delete("buyListItemFieldValues", value._id);
    await ctx.db.delete("buyListFieldDefinitions", args.id); return null;
  },
});
