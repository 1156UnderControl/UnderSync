import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin, requireUser } from "./lib/auth";

const fieldTypeValidator = v.union(v.literal("STRING"), v.literal("BOOLEAN"));
const fieldValidator = v.object({
  id: v.id("buyListFieldDefinitions"), key: v.string(), label: v.string(),
  fieldType: fieldTypeValidator, sortOrder: v.number(),
});
const itemValidator = v.object({
  id: v.id("buyListItems"), name: v.string(), quantity: v.number(), purchased: v.boolean(),
  values: v.array(v.object({ fieldDefinitionId: v.id("buyListFieldDefinitions"), value: v.string() })),
});

export const settings = query({
  args: {},
  returns: v.object({ title: v.string(), description: v.string(), addLabel: v.string() }),
  handler: async (ctx) => {
    await requireUser(ctx);
    const values = new Map<string, string>();
    for (const key of ["buyListTitle", "buyListDescription", "buyListAddLabel"]) {
      const row = await ctx.db.query("appSettings").withIndex("by_key", (q) => q.eq("key", key)).unique();
      if (row) values.set(key, row.value);
    }
    return {
      title: values.get("buyListTitle") ?? "Buy List",
      description: values.get("buyListDescription") ?? "Organize everything the team needs to purchase.",
      addLabel: values.get("buyListAddLabel") ?? "Add item",
    };
  },
});

export const catalog = query({
  args: {},
  returns: v.array(v.object({
    id: v.id("buyListTypes"), name: v.string(), slug: v.string(), icon: v.string(),
    itemCount: v.number(), totalQuantity: v.number(),
  })),
  handler: async (ctx) => {
    await requireUser(ctx);
    const types = await ctx.db.query("buyListTypes")
      .withIndex("by_active_and_sortOrder", (q) => q.eq("active", true)).take(100);
    const output = [];
    for (const type of types) {
      const items = await ctx.db.query("buyListItems")
        .withIndex("by_buyListTypeId_and_archivedAt", (q) =>
          q.eq("buyListTypeId", type._id).eq("archivedAt", undefined))
        .take(500);
      output.push({
        id: type._id, name: type.name, slug: type.slug, icon: type.icon,
        itemCount: items.length, totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
      });
    }
    return output;
  },
});

export const typeDetails = query({
  args: { buyListTypeId: v.id("buyListTypes") },
  returns: v.union(v.null(), v.object({
    type: v.object({ id: v.id("buyListTypes"), name: v.string(), slug: v.string(), icon: v.string() }),
    fields: v.array(fieldValidator), items: v.array(itemValidator),
  })),
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const type = await ctx.db.get("buyListTypes", args.buyListTypeId);
    if (!type?.active) return null;
    const [fields, items] = await Promise.all([
      ctx.db.query("buyListFieldDefinitions")
        .withIndex("by_buyListTypeId_and_sortOrder", (q) => q.eq("buyListTypeId", type._id)).take(100),
      ctx.db.query("buyListItems")
        .withIndex("by_buyListTypeId_and_archivedAt", (q) =>
          q.eq("buyListTypeId", type._id).eq("archivedAt", undefined))
        .order("desc").take(500),
    ]);
    const output = [];
    for (const item of items) {
      const values = await ctx.db.query("buyListItemFieldValues")
        .withIndex("by_buyListItemId_and_fieldDefinitionId", (q) => q.eq("buyListItemId", item._id)).take(100);
      output.push({
        id: item._id, name: item.name, quantity: item.quantity, purchased: item.purchased,
        values: values.map((row) => ({ fieldDefinitionId: row.fieldDefinitionId, value: row.value })),
      });
    }
    return {
      type: { id: type._id, name: type.name, slug: type.slug, icon: type.icon },
      fields: fields.filter((field) => field.active).map((field) => ({
        id: field._id, key: field.key, label: field.label, fieldType: field.fieldType,
        sortOrder: field.sortOrder,
      })),
      items: output,
    };
  },
});

export const createItem = mutation({
  args: {
    buyListTypeId: v.id("buyListTypes"), name: v.string(), quantity: v.number(),
    values: v.array(v.object({ fieldDefinitionId: v.id("buyListFieldDefinitions"), value: v.string() })),
  },
  returns: v.id("buyListItems"),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const type = await ctx.db.get("buyListTypes", args.buyListTypeId);
    const name = args.name.trim();
    if (!type?.active) throw new Error("This buy-list category is not active.");
    if (name.length < 2 || name.length > 160) throw new Error("Item name must contain 2 to 160 characters.");
    if (!Number.isInteger(args.quantity) || args.quantity < 1 || args.quantity > 1_000_000) {
      throw new Error("Quantity must be from 1 to 1,000,000.");
    }
    const fields = await ctx.db.query("buyListFieldDefinitions")
      .withIndex("by_buyListTypeId_and_sortOrder", (q) => q.eq("buyListTypeId", type._id)).take(100);
    const activeFields = fields.filter((field) => field.active);
    const values = new Map(args.values.map((row) => [row.fieldDefinitionId, row.value.trim()]));
    for (const field of activeFields) {
      const value = values.get(field._id);
      if (field.fieldType === "BOOLEAN") {
        if (value !== "true" && value !== "false") throw new Error(`Choose yes or no for ${field.label}.`);
      } else if (!value || value.length > 500) throw new Error(`Enter a valid value for ${field.label}.`);
    }
    const now = Date.now();
    const itemId = await ctx.db.insert("buyListItems", {
      buyListTypeId: type._id, name, quantity: args.quantity, purchased: false,
      createdBy: user._id, createdAt: now, updatedAt: now,
    });
    for (const field of activeFields) {
      await ctx.db.insert("buyListItemFieldValues", {
        buyListItemId: itemId, fieldDefinitionId: field._id, value: values.get(field._id)!,
      });
    }
    await ctx.db.insert("auditEvents", {
      actorUserId: user._id, action: "BUY_LIST_ITEM_CREATED", targetType: "buyListItem",
      targetId: itemId, summary: `${name} added to ${type.name}.`, createdAt: now,
    });
    return itemId;
  },
});

export const setPurchased = mutation({
  args: { itemId: v.id("buyListItems"), purchased: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const item = await ctx.db.get("buyListItems", args.itemId);
    if (item === null || item.archivedAt !== undefined) throw new Error("Buy-list item not found.");
    await ctx.db.patch("buyListItems", item._id, { purchased: args.purchased, updatedAt: Date.now() });
    await ctx.db.insert("auditEvents", {
      actorUserId: user._id, action: args.purchased ? "BUY_LIST_ITEM_PURCHASED" : "BUY_LIST_ITEM_REOPENED",
      targetType: "buyListItem", targetId: item._id,
      summary: `${item.name} marked ${args.purchased ? "purchased" : "needed"}.`, createdAt: Date.now(),
    });
    return null;
  },
});

export const deleteItem = mutation({
  args: { itemId: v.id("buyListItems") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const item = await ctx.db.get("buyListItems", args.itemId);
    if (item === null) throw new Error("Buy-list item not found.");
    const values = await ctx.db.query("buyListItemFieldValues")
      .withIndex("by_buyListItemId_and_fieldDefinitionId", (q) => q.eq("buyListItemId", item._id)).take(100);
    for (const value of values) await ctx.db.delete("buyListItemFieldValues", value._id);
    await ctx.db.delete("buyListItems", item._id);
    await ctx.db.insert("auditEvents", {
      actorUserId: admin._id, action: "BUY_LIST_ITEM_DELETED", targetType: "buyListItem",
      targetId: item._id, summary: `${item.name} was deleted.`, createdAt: Date.now(),
    });
    return null;
  },
});
