import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { requireAdmin, requireUser } from "./lib/auth";

const fieldTypeValidator = v.union(v.literal("STRING"), v.literal("BOOLEAN"), v.literal("SELECT"), v.literal("MEASUREMENT"));
const optionValidator = v.object({ id: v.id("cotsFieldOptions"), label: v.string(), value: v.string(), sortOrder: v.number() });
const typeSummaryValidator = v.object({
  id: v.id("cotsTypes"), name: v.string(), slug: v.string(), icon: v.string(), itemCount: v.number(), totalQuantity: v.number(),
});
const fieldValidator = v.object({
  id: v.id("cotsFieldDefinitions"), key: v.string(), code: v.string(), label: v.string(),
  fieldType: fieldTypeValidator, sortOrder: v.number(), options: v.array(optionValidator),
});
const statusValidator = v.object({ id: v.id("cotsStatuses"), code: v.string(), name: v.string(), sortOrder: v.number() });
const itemValidator = v.object({
  id: v.id("cotsItems"), code: v.string(),
  values: v.array(v.object({ fieldDefinitionId: v.id("cotsFieldDefinitions"), value: v.string() })),
  quantities: v.array(v.object({ statusId: v.id("cotsStatuses"), quantity: v.number() })),
});
const itemValuesValidator = v.array(v.object({ fieldDefinitionId: v.id("cotsFieldDefinitions"), value: v.string() }));
const itemQuantitiesValidator = v.array(v.object({ statusId: v.id("cotsStatuses"), quantity: v.number() }));

function codeSegment(value: string, fallback = "NA") {
  const result = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()
    .replace(/[^A-Z0-9]+/g, "").slice(0, 18);
  return result || fallback;
}

function canonicalMeasurement(value: string, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000) throw new Error(`Enter a valid measurement for ${label}.`);
  return Number(parsed.toFixed(6)).toString();
}

async function validateAnswers(
  ctx: MutationCtx,
  definitions: Array<{ _id: Id<"cotsFieldDefinitions">; label: string; fieldType?: "STRING" | "BOOLEAN" | "SELECT" | "MEASUREMENT" }>,
  values: Array<{ fieldDefinitionId: Id<"cotsFieldDefinitions">; value: string }>,
) {
  const provided = new Map(values.map((row) => [row.fieldDefinitionId, row.value.trim()]));
  const normalized = new Map<Id<"cotsFieldDefinitions">, string>();
  for (const definition of definitions) {
    const value = provided.get(definition._id) ?? "";
    const fieldType = definition.fieldType ?? "STRING";
    if (fieldType === "BOOLEAN") {
      if (value !== "true" && value !== "false") throw new Error(`Choose yes or no for ${definition.label}.`);
      normalized.set(definition._id, value);
    } else if (fieldType === "SELECT") {
      const option = await ctx.db.query("cotsFieldOptions")
        .withIndex("by_fieldDefinitionId_and_value", (q) => q.eq("fieldDefinitionId", definition._id).eq("value", value)).unique();
      if (!option?.active) throw new Error(`Choose a valid option for ${definition.label}.`);
      normalized.set(definition._id, value);
    } else if (fieldType === "MEASUREMENT") {
      normalized.set(definition._id, canonicalMeasurement(value, definition.label));
    } else {
      if (!value || value.length > 500) throw new Error(`Enter a valid value for ${definition.label}.`);
      normalized.set(definition._id, value);
    }
  }
  return normalized;
}

function validateQuantities(
  statuses: Array<{ _id: Id<"cotsStatuses">; name: string }>,
  quantities: Array<{ statusId: Id<"cotsStatuses">; quantity: number }>,
) {
  const result = new Map(quantities.map((row) => [row.statusId, row.quantity]));
  for (const status of statuses) {
    const quantity = result.get(status._id) ?? 0;
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 1_000_000) throw new Error(`Enter a valid quantity for ${status.name}.`);
  }
  return result;
}

async function generatedCode(
  ctx: MutationCtx,
  type: { _id: Id<"cotsTypes">; slug: string; code?: string },
  definitions: Array<{ _id: Id<"cotsFieldDefinitions">; key: string; code?: string; fieldType?: "STRING" | "BOOLEAN" | "SELECT" | "MEASUREMENT" }>,
  values: Map<Id<"cotsFieldDefinitions">, string>,
  excludeId?: Id<"cotsItems">,
) {
  const parts = [codeSegment(type.code ?? type.slug, "COTS")];
  for (const definition of definitions) {
    const raw = values.get(definition._id) ?? "";
    const answer = (definition.fieldType ?? "STRING") === "BOOLEAN" ? (raw === "true" ? "Y" : "N") : codeSegment(raw);
    parts.push(`${codeSegment(definition.code ?? definition.key, "Q")}${answer}`);
  }
  const base = parts.join("-").slice(0, 150).replace(/-+$/g, "");
  const existing = await ctx.db.query("cotsItems").withIndex("by_cotsTypeId", (q) => q.eq("cotsTypeId", type._id)).take(500);
  const occupied = new Set(existing.filter((item) => item._id !== excludeId).map((item) => item.name));
  if (!occupied.has(base)) return base;
  for (let suffix = 2; suffix <= 9999; suffix += 1) {
    const suffixText = String(suffix);
    const candidate = `${base.slice(0, 150 - suffixText.length - 1)}-${suffixText}`;
    if (!occupied.has(candidate)) return candidate;
  }
  throw new Error("Could not generate a unique COTS code.");
}

export const catalog = query({
  args: {}, returns: v.array(typeSummaryValidator),
  handler: async (ctx) => {
    await requireUser(ctx);
    const types = await ctx.db.query("cotsTypes").withIndex("by_active_and_sortOrder", (q) => q.eq("active", true)).take(100);
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
    type: v.object({ id: v.id("cotsTypes"), name: v.string(), slug: v.string(), code: v.string(), icon: v.string() }),
    fields: v.array(fieldValidator), statuses: v.array(statusValidator), items: v.array(itemValidator),
  })),
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const type = await ctx.db.get("cotsTypes", args.cotsTypeId);
    if (!type?.active) return null;
    const [definitions, statuses, items] = await Promise.all([
      ctx.db.query("cotsFieldDefinitions").withIndex("by_cotsTypeId_and_sortOrder", (q) => q.eq("cotsTypeId", type._id)).take(100),
      ctx.db.query("cotsStatuses").withIndex("by_active_and_sortOrder", (q) => q.eq("active", true)).take(100),
      ctx.db.query("cotsItems").withIndex("by_cotsTypeId", (q) => q.eq("cotsTypeId", type._id)).order("desc").take(500),
    ]);
    const fields = [];
    for (const definition of definitions.filter((row) => row.active)) {
      const options = await ctx.db.query("cotsFieldOptions")
        .withIndex("by_fieldDefinitionId_and_sortOrder", (q) => q.eq("fieldDefinitionId", definition._id)).take(100);
      fields.push({ id: definition._id, key: definition.key, code: definition.code ?? codeSegment(definition.key, "Q"),
        label: definition.label, fieldType: definition.fieldType ?? "STRING" as const, sortOrder: definition.sortOrder,
        options: options.filter((option) => option.active).map((option) => ({ id: option._id, label: option.label, value: option.value, sortOrder: option.sortOrder })) });
    }
    const itemOutput = [];
    for (const item of items) {
      const [values, quantities] = await Promise.all([
        ctx.db.query("cotsItemFieldValues").withIndex("by_cotsItemId_and_fieldDefinitionId", (q) => q.eq("cotsItemId", item._id)).take(100),
        ctx.db.query("cotsItemQuantities").withIndex("by_cotsItemId_and_statusId", (q) => q.eq("cotsItemId", item._id)).take(100),
      ]);
      itemOutput.push({ id: item._id, code: item.name,
        values: values.map((row) => ({ fieldDefinitionId: row.fieldDefinitionId, value: row.value })),
        quantities: quantities.map((row) => ({ statusId: row.statusId, quantity: row.quantity })) });
    }
    return { type: { id: type._id, name: type.name, slug: type.slug, code: type.code ?? codeSegment(type.slug, "COTS"), icon: type.icon },
      fields, statuses: statuses.map((row) => ({ id: row._id, code: row.code, name: row.name, sortOrder: row.sortOrder })), items: itemOutput };
  },
});

async function formContext(ctx: MutationCtx, cotsTypeId: Id<"cotsTypes">) {
  const type = await ctx.db.get("cotsTypes", cotsTypeId);
  if (!type?.active) throw new Error("This COTS type is not active.");
  const [allDefinitions, statuses] = await Promise.all([
    ctx.db.query("cotsFieldDefinitions").withIndex("by_cotsTypeId_and_sortOrder", (q) => q.eq("cotsTypeId", type._id)).take(100),
    ctx.db.query("cotsStatuses").withIndex("by_active_and_sortOrder", (q) => q.eq("active", true)).take(100),
  ]);
  return { type, definitions: allDefinitions.filter((row) => row.active), statuses };
}

export const createItem = mutation({
  args: { cotsTypeId: v.id("cotsTypes"), values: itemValuesValidator, quantities: itemQuantitiesValidator },
  returns: v.id("cotsItems"),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const { type, definitions, statuses } = await formContext(ctx, args.cotsTypeId);
    const values = await validateAnswers(ctx, definitions, args.values);
    const quantities = validateQuantities(statuses, args.quantities);
    const code = await generatedCode(ctx, type, definitions, values);
    const now = Date.now();
    const itemId = await ctx.db.insert("cotsItems", { cotsTypeId: type._id, name: code, createdBy: user._id, createdAt: now, updatedAt: now });
    for (const definition of definitions) await ctx.db.insert("cotsItemFieldValues", { cotsItemId: itemId, fieldDefinitionId: definition._id, value: values.get(definition._id)! });
    for (const status of statuses) await ctx.db.insert("cotsItemQuantities", { cotsItemId: itemId, statusId: status._id, quantity: quantities.get(status._id) ?? 0 });
    await ctx.db.insert("auditEvents", { actorUserId: user._id, action: "COTS_ITEM_CREATED", targetType: "cotsItem",
      targetId: itemId, summary: `${code} added to ${type.name}.`, createdAt: now });
    return itemId;
  },
});

export const updateItem = mutation({
  args: { itemId: v.id("cotsItems"), values: itemValuesValidator, quantities: itemQuantitiesValidator }, returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const item = await ctx.db.get("cotsItems", args.itemId);
    if (!item) throw new Error("COTS item not found.");
    const { type, definitions, statuses } = await formContext(ctx, item.cotsTypeId);
    const values = await validateAnswers(ctx, definitions, args.values);
    const quantities = validateQuantities(statuses, args.quantities);
    const code = await generatedCode(ctx, type, definitions, values, item._id);
    for (const definition of definitions) {
      const existing = await ctx.db.query("cotsItemFieldValues")
        .withIndex("by_cotsItemId_and_fieldDefinitionId", (q) => q.eq("cotsItemId", item._id).eq("fieldDefinitionId", definition._id)).unique();
      if (existing) await ctx.db.patch("cotsItemFieldValues", existing._id, { value: values.get(definition._id)! });
      else await ctx.db.insert("cotsItemFieldValues", { cotsItemId: item._id, fieldDefinitionId: definition._id, value: values.get(definition._id)! });
    }
    for (const status of statuses) {
      const existing = await ctx.db.query("cotsItemQuantities")
        .withIndex("by_cotsItemId_and_statusId", (q) => q.eq("cotsItemId", item._id).eq("statusId", status._id)).unique();
      if (existing) await ctx.db.patch("cotsItemQuantities", existing._id, { quantity: quantities.get(status._id) ?? 0 });
      else await ctx.db.insert("cotsItemQuantities", { cotsItemId: item._id, statusId: status._id, quantity: quantities.get(status._id) ?? 0 });
    }
    await ctx.db.patch("cotsItems", item._id, { name: code, updatedAt: Date.now() });
    await ctx.db.insert("auditEvents", { actorUserId: user._id, action: "COTS_ITEM_UPDATED", targetType: "cotsItem",
      targetId: item._id, summary: `${code} was updated.`, createdAt: Date.now() });
    return null;
  },
});

export const deleteItem = mutation({
  args: { itemId: v.id("cotsItems") }, returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const item = await ctx.db.get("cotsItems", args.itemId);
    if (!item) throw new Error("COTS item not found.");
    const [values, quantities] = await Promise.all([
      ctx.db.query("cotsItemFieldValues").withIndex("by_cotsItemId_and_fieldDefinitionId", (q) => q.eq("cotsItemId", item._id)).take(200),
      ctx.db.query("cotsItemQuantities").withIndex("by_cotsItemId_and_statusId", (q) => q.eq("cotsItemId", item._id)).take(200),
    ]);
    for (const value of values) await ctx.db.delete("cotsItemFieldValues", value._id);
    for (const quantity of quantities) await ctx.db.delete("cotsItemQuantities", quantity._id);
    await ctx.db.delete("cotsItems", item._id);
    await ctx.db.insert("auditEvents", { actorUserId: admin._id, action: "COTS_ITEM_DELETED", targetType: "cotsItem",
      targetId: item._id, summary: `${item.name} was deleted.`, createdAt: Date.now() });
    return null;
  },
});
