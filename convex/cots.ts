import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin, requireUser } from "./lib/auth";

const typeSummaryValidator = v.object({
  id: v.id("cotsTypes"), name: v.string(), slug: v.string(), icon: v.string(), itemCount: v.number(), totalQuantity: v.number(),
});
const fieldValidator = v.object({
  id: v.id("cotsFieldDefinitions"), key: v.string(), label: v.string(),
  fieldType: v.union(v.literal("STRING"), v.literal("BOOLEAN")), sortOrder: v.number(),
});
const statusValidator = v.object({ id: v.id("cotsStatuses"), code: v.string(), name: v.string(), sortOrder: v.number() });
const itemValidator = v.object({
  id: v.id("cotsItems"), name: v.string(),
  values: v.array(v.object({ fieldDefinitionId: v.id("cotsFieldDefinitions"), value: v.string() })),
  quantities: v.array(v.object({ statusId: v.id("cotsStatuses"), quantity: v.number() })),
});

export const catalog = query({
  args: {},
  returns: v.array(typeSummaryValidator),
  handler: async (ctx) => {
    await requireUser(ctx);
    const types = await ctx.db.query("cotsTypes")
      .withIndex("by_active_and_sortOrder", (q) => q.eq("active", true))
      .take(100);
    const output = [];
    for (const type of types) {
      const items = await ctx.db.query("cotsItems").withIndex("by_cotsTypeId", (q) => q.eq("cotsTypeId", type._id)).take(500);
      let totalQuantity = 0;
      for (const item of items) {
        const quantities = await ctx.db.query("cotsItemQuantities")
          .withIndex("by_cotsItemId_and_statusId", (q) => q.eq("cotsItemId", item._id)).take(50);
        totalQuantity += quantities.reduce((sum, row) => sum + row.quantity, 0);
      }
      output.push({ id: type._id, name: type.name, slug: type.slug, icon: type.icon, itemCount: items.length, totalQuantity });
    }
    return output;
  },
});

export const typeDetails = query({
  args: { cotsTypeId: v.id("cotsTypes") },
  returns: v.union(v.null(), v.object({
    type: v.object({ id: v.id("cotsTypes"), name: v.string(), slug: v.string(), icon: v.string() }),
    fields: v.array(fieldValidator), statuses: v.array(statusValidator), items: v.array(itemValidator),
  })),
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const type = await ctx.db.get("cotsTypes", args.cotsTypeId);
    if (!type || !type.active) return null;
    const [definitions, statuses, items] = await Promise.all([
      ctx.db.query("cotsFieldDefinitions").withIndex("by_cotsTypeId_and_sortOrder", (q) => q.eq("cotsTypeId", type._id)).take(100),
      ctx.db.query("cotsStatuses").withIndex("by_active_and_sortOrder", (q) => q.eq("active", true)).take(100),
      ctx.db.query("cotsItems").withIndex("by_cotsTypeId", (q) => q.eq("cotsTypeId", type._id)).order("desc").take(500),
    ]);
    const itemOutput = [];
    for (const item of items) {
      const [values, quantities] = await Promise.all([
        ctx.db.query("cotsItemFieldValues").withIndex("by_cotsItemId_and_fieldDefinitionId", (q) => q.eq("cotsItemId", item._id)).take(100),
        ctx.db.query("cotsItemQuantities").withIndex("by_cotsItemId_and_statusId", (q) => q.eq("cotsItemId", item._id)).take(100),
      ]);
      itemOutput.push({ id: item._id, name: item.name,
        values: values.map((row) => ({ fieldDefinitionId: row.fieldDefinitionId, value: row.value })),
        quantities: quantities.map((row) => ({ statusId: row.statusId, quantity: row.quantity })) });
    }
    return {
      type: { id: type._id, name: type.name, slug: type.slug, icon: type.icon },
      fields: definitions.filter((row) => row.active).map((row) => ({
        id: row._id, key: row.key, label: row.label, fieldType: row.fieldType ?? "STRING" as const,
        sortOrder: row.sortOrder,
      })),
      statuses: statuses.map((row) => ({ id: row._id, code: row.code, name: row.name, sortOrder: row.sortOrder })),
      items: itemOutput,
    };
  },
});

export const createItem = mutation({
  args: {
    cotsTypeId: v.id("cotsTypes"), name: v.string(),
    values: v.array(v.object({ fieldDefinitionId: v.id("cotsFieldDefinitions"), value: v.string() })),
    quantities: v.array(v.object({ statusId: v.id("cotsStatuses"), quantity: v.number() })),
  },
  returns: v.id("cotsItems"),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const type = await ctx.db.get("cotsTypes", args.cotsTypeId);
    const name = args.name.trim();
    if (!type?.active) throw new Error("This COTS type is not active.");
    if (name.length < 2 || name.length > 160) throw new Error("COTS name must contain 2 to 160 characters.");
    const definitions = await ctx.db.query("cotsFieldDefinitions")
      .withIndex("by_cotsTypeId_and_sortOrder", (q) => q.eq("cotsTypeId", type._id)).take(100);
    const activeDefinitions = definitions.filter((row) => row.active);
    const valueMap = new Map(args.values.map((row) => [row.fieldDefinitionId, row.value.trim()]));
    for (const definition of activeDefinitions) {
      const value = valueMap.get(definition._id);
      const fieldType = definition.fieldType ?? "STRING";
      if (fieldType === "BOOLEAN") {
        if (value !== "true" && value !== "false") throw new Error(`Choose yes or no for ${definition.label}.`);
      } else if (!value || value.length > 500) {
        throw new Error(`Enter a valid value for ${definition.label}.`);
      }
    }
    const statuses = await ctx.db.query("cotsStatuses")
      .withIndex("by_active_and_sortOrder", (q) => q.eq("active", true)).take(100);
    const quantityMap = new Map(args.quantities.map((row) => [row.statusId, row.quantity]));
    for (const status of statuses) {
      const quantity = quantityMap.get(status._id) ?? 0;
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > 1_000_000) throw new Error(`Enter a valid quantity for ${status.name}.`);
    }
    const now = Date.now();
    const itemId = await ctx.db.insert("cotsItems", { cotsTypeId: type._id, name, createdBy: user._id, createdAt: now, updatedAt: now });
    for (const definition of activeDefinitions) {
      await ctx.db.insert("cotsItemFieldValues", { cotsItemId: itemId, fieldDefinitionId: definition._id, value: valueMap.get(definition._id)! });
    }
    for (const status of statuses) {
      await ctx.db.insert("cotsItemQuantities", { cotsItemId: itemId, statusId: status._id, quantity: quantityMap.get(status._id) ?? 0 });
    }
    await ctx.db.insert("auditEvents", { actorUserId: user._id, action: "COTS_ITEM_CREATED", targetType: "cotsItem",
      targetId: itemId, summary: `${name} added to ${type.name}.`, createdAt: now });
    return itemId;
  },
});

export const deleteItem = mutation({
  args: { itemId: v.id("cotsItems") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const item = await ctx.db.get("cotsItems", args.itemId);
    if (item === null) throw new Error("COTS item not found.");
    const [values, quantities] = await Promise.all([
      ctx.db.query("cotsItemFieldValues")
        .withIndex("by_cotsItemId_and_fieldDefinitionId", (q) => q.eq("cotsItemId", item._id)).take(200),
      ctx.db.query("cotsItemQuantities")
        .withIndex("by_cotsItemId_and_statusId", (q) => q.eq("cotsItemId", item._id)).take(200),
    ]);
    for (const value of values) await ctx.db.delete("cotsItemFieldValues", value._id);
    for (const quantity of quantities) await ctx.db.delete("cotsItemQuantities", quantity._id);
    await ctx.db.delete("cotsItems", item._id);
    await ctx.db.insert("auditEvents", {
      actorUserId: admin._id, action: "COTS_ITEM_DELETED", targetType: "cotsItem",
      targetId: item._id, summary: `${item.name} was deleted.`, createdAt: Date.now(),
    });
    return null;
  },
});
