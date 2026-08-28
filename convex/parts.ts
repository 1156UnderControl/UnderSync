import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireAdmin, requireUser } from "./lib/auth";

type DatabaseCtx = QueryCtx | MutationCtx;

const partValidator = v.object({
  id: v.id("parts"), trackingCode: v.string(), name: v.string(), quantity: v.number(),
  status: v.union(v.literal("IN_DEVELOPMENT"), v.literal("ARCHIVED")),
  subsystemId: v.id("subsystems"), subsystem: v.string(), designerId: v.id("users"), designer: v.string(),
  manufacturingMethodId: v.id("manufacturingMethods"), method: v.string(),
  materialId: v.id("materials"), material: v.string(), createdAt: v.number(), hasOnshapeSource: v.boolean(),
});

async function expandedPart(ctx: DatabaseCtx, part: Doc<"parts">) {
  const [subsystem, designer, method, material] = await Promise.all([
    ctx.db.get("subsystems", part.subsystemId), ctx.db.get("users", part.designerId),
    ctx.db.get("manufacturingMethods", part.manufacturingMethodId), ctx.db.get("materials", part.materialId),
  ]);
  return {
    id: part._id, trackingCode: part.trackingCode, name: part.name, quantity: part.quantity, status: part.status,
    subsystemId: part.subsystemId, subsystem: subsystem?.name ?? "Unknown",
    designerId: part.designerId, designer: designer?.displayName ?? designer?.name ?? "Unknown",
    manufacturingMethodId: part.manufacturingMethodId, method: method?.name ?? "Unknown",
    materialId: part.materialId, material: material?.name ?? "Unknown", createdAt: part.createdAt,
    hasOnshapeSource: Boolean(part.onshapeDocumentId && part.onshapeWorkspaceId && part.onshapeElementId && part.onshapePartId),
  };
}

export const catalog = query({
  args: {},
  returns: v.array(v.object({ id: v.id("subsystems"), code: v.string(), name: v.string(), partCount: v.number() })),
  handler: async (ctx) => {
    await requireUser(ctx);
    const subsystems = await ctx.db.query("subsystems").order("asc").take(100);
    const output = [];
    for (const subsystem of subsystems.filter((row) => row.active)) {
      const parts = await ctx.db.query("parts").withIndex("by_subsystemId", (q) => q.eq("subsystemId", subsystem._id)).take(500);
      output.push({ id: subsystem._id, code: subsystem.code, name: subsystem.name, partCount: parts.filter((part) => part.status === "IN_DEVELOPMENT").length });
    }
    return output;
  },
});

export const listBySubsystem = query({
  args: { subsystemId: v.id("subsystems") }, returns: v.array(partValidator),
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const parts = await ctx.db.query("parts").withIndex("by_subsystemId", (q) => q.eq("subsystemId", args.subsystemId)).order("desc").take(500);
    return await Promise.all(parts.filter((part) => part.status === "IN_DEVELOPMENT").map((part) => expandedPart(ctx, part)));
  },
});

export const listRecent = query({
  args: {}, returns: v.array(partValidator),
  handler: async (ctx) => {
    await requireUser(ctx);
    const parts = await ctx.db.query("parts").order("desc").take(100);
    return await Promise.all(parts.filter((part) => part.status === "IN_DEVELOPMENT").map((part) => expandedPart(ctx, part)));
  },
});

async function setting(ctx: DatabaseCtx, key: string, fallback: string) {
  return (await ctx.db.query("appSettings").withIndex("by_key", (q) => q.eq("key", key)).unique())?.value ?? fallback;
}

export const create = mutation({
  args: {
    name: v.string(), quantity: v.number(), subsystemId: v.id("subsystems"), designerId: v.id("users"),
    manufacturingMethodId: v.id("manufacturingMethods"), materialId: v.id("materials"),
    onshapeDocumentId: v.optional(v.string()), onshapeWorkspaceId: v.optional(v.string()),
    onshapeElementId: v.optional(v.string()), onshapePartId: v.optional(v.string()),
    onshapeConfiguration: v.optional(v.string()), onshapeMicroversionId: v.optional(v.string()),
  },
  returns: v.object({ id: v.id("parts"), trackingCode: v.string(), onshapeName: v.string() }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx); const name = args.name.trim();
    if (name.length < 2 || name.length > 160) throw new Error("Part name must contain 2 to 160 characters.");
    if (!Number.isInteger(args.quantity) || args.quantity < 1 || args.quantity > 10_000) throw new Error("Quantity must be from 1 to 10,000.");
    const [subsystem, designer, method, material] = await Promise.all([
      ctx.db.get("subsystems", args.subsystemId), ctx.db.get("users", args.designerId),
      ctx.db.get("manufacturingMethods", args.manufacturingMethodId), ctx.db.get("materials", args.materialId),
    ]);
    if (!subsystem?.active || designer?.status !== "ACTIVE" || !method?.active || !material?.active) throw new Error("A selected option is no longer active.");
    const compatible = await ctx.db.query("manufacturingMethodMaterials")
      .withIndex("by_manufacturingMethodId_and_materialId", (q) => q.eq("manufacturingMethodId", method._id).eq("materialId", material._id)).unique();
    if (!compatible) throw new Error("That material is not accepted by the fabrication method.");
    if (args.onshapeDocumentId && args.onshapeElementId && args.onshapePartId) {
      const existing = await ctx.db.query("parts")
        .withIndex("by_onshapeDocumentId_and_onshapeElementId_and_onshapePartId", (q) => q
          .eq("onshapeDocumentId", args.onshapeDocumentId).eq("onshapeElementId", args.onshapeElementId).eq("onshapePartId", args.onshapePartId)).unique();
      if (existing) throw new Error(`This Onshape part is already registered as ${existing.trackingCode}.`);
    }
    const [teamNumber, seasonCode, separator, digitsText] = await Promise.all([
      setting(ctx, "teamNumber", "1156"), setting(ctx, "seasonCode", "26"),
      setting(ctx, "partCodeSeparator", "-"), setting(ctx, "partSequenceDigits", "2"),
    ]);
    const counterKey = `parts:${teamNumber}:${seasonCode}`;
    const counter = await ctx.db.query("counters").withIndex("by_key", (q) => q.eq("key", counterKey)).unique();
    const sequenceValue = (counter?.value ?? 0) + 1;
    if (counter) await ctx.db.patch("counters", counter._id, { value: sequenceValue });
    else await ctx.db.insert("counters", { key: counterKey, value: sequenceValue });
    const digits = Math.min(8, Math.max(2, Number.parseInt(digitsText, 10) || 2));
    const trackingCode = [teamNumber, seasonCode, subsystem.code, String(sequenceValue).padStart(digits, "0")].join(separator);
    const id = await ctx.db.insert("parts", {
      trackingCode, sequenceValue, name, quantity: args.quantity, subsystemId: subsystem._id,
      designerId: designer._id, manufacturingMethodId: method._id, materialId: material._id,
      status: "IN_DEVELOPMENT", createdBy: user._id, createdAt: Date.now(),
      ...(args.onshapeDocumentId ? { onshapeDocumentId: args.onshapeDocumentId } : {}),
      ...(args.onshapeWorkspaceId ? { onshapeWorkspaceId: args.onshapeWorkspaceId } : {}),
      ...(args.onshapeElementId ? { onshapeElementId: args.onshapeElementId } : {}),
      ...(args.onshapePartId ? { onshapePartId: args.onshapePartId } : {}),
      ...(args.onshapeConfiguration ? { onshapeConfiguration: args.onshapeConfiguration } : {}),
      ...(args.onshapeMicroversionId ? { onshapeMicroversionId: args.onshapeMicroversionId } : {}),
    });
    await ctx.db.insert("auditEvents", { actorUserId: user._id, action: "PART_REGISTERED", targetType: "part", targetId: id, summary: `${name} registered as ${trackingCode}.`, createdAt: Date.now() });
    return { id, trackingCode, onshapeName: `${name} | ${trackingCode}` };
  },
});

export const update = mutation({
  args: {
    partId: v.id("parts"), name: v.string(), quantity: v.number(), subsystemId: v.id("subsystems"),
    designerId: v.id("users"), manufacturingMethodId: v.id("manufacturingMethods"), materialId: v.id("materials"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx); const part = await ctx.db.get("parts", args.partId); const name = args.name.trim();
    if (!part || part.status !== "IN_DEVELOPMENT") throw new Error("Part not found.");
    if (name.length < 2 || name.length > 160 || !Number.isInteger(args.quantity) || args.quantity < 1 || args.quantity > 10_000) throw new Error("Check the part name and quantity.");
    const [subsystem, designer, method, material] = await Promise.all([
      ctx.db.get("subsystems", args.subsystemId), ctx.db.get("users", args.designerId),
      ctx.db.get("manufacturingMethods", args.manufacturingMethodId), ctx.db.get("materials", args.materialId),
    ]);
    if (!subsystem?.active || designer?.status !== "ACTIVE" || !method?.active || !material?.active) throw new Error("A selected option is no longer active.");
    const compatible = await ctx.db.query("manufacturingMethodMaterials").withIndex("by_manufacturingMethodId_and_materialId", (q) => q.eq("manufacturingMethodId", method._id).eq("materialId", material._id)).unique();
    if (!compatible) throw new Error("That material is not accepted by the fabrication method.");
    await ctx.db.patch("parts", part._id, { name, quantity: args.quantity, subsystemId: subsystem._id, designerId: designer._id, manufacturingMethodId: method._id, materialId: material._id });
    await ctx.db.insert("auditEvents", { actorUserId: user._id, action: "PART_UPDATED", targetType: "part", targetId: part._id, summary: `${part.trackingCode} was updated.`, createdAt: Date.now() });
    return null;
  },
});

export const deletePart = mutation({
  args: { partId: v.id("parts") }, returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx); const part = await ctx.db.get("parts", args.partId);
    if (!part) throw new Error("Part not found.");
    const exports = await ctx.db.query("partExports").withIndex("by_partId", (q) => q.eq("partId", part._id)).take(100);
    for (const file of exports) { await ctx.storage.delete(file.storageId); await ctx.db.delete("partExports", file._id); }
    await ctx.db.delete("parts", part._id);
    await ctx.db.insert("auditEvents", { actorUserId: admin._id, action: "PART_DELETED", targetType: "part", targetId: part._id, summary: `${part.trackingCode} was permanently deleted.`, createdAt: Date.now() });
    return null;
  },
});

export const exportContext = internalQuery({
  args: { partId: v.id("parts") },
  returns: v.object({
    userId: v.id("users"), trackingCode: v.string(), name: v.string(), documentId: v.string(),
    workspaceId: v.string(), elementId: v.string(), onshapePartId: v.string(), configuration: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx); const part = await ctx.db.get("parts", args.partId);
    if (!part?.onshapeDocumentId || !part.onshapeWorkspaceId || !part.onshapeElementId || !part.onshapePartId) throw new Error("This part does not have a complete Onshape source for export.");
    return { userId: user._id, trackingCode: part.trackingCode, name: part.name, documentId: part.onshapeDocumentId, workspaceId: part.onshapeWorkspaceId, elementId: part.onshapeElementId, onshapePartId: part.onshapePartId, configuration: part.onshapeConfiguration ?? null };
  },
});

export const recordExport = internalMutation({
  args: { partId: v.id("parts"), storageId: v.id("_storage"), format: v.union(v.literal("STL"), v.literal("PARASOLID")) }, returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (!await ctx.db.get("parts", args.partId)) throw new Error("Part not found.");
    await ctx.db.insert("partExports", { partId: args.partId, storageId: args.storageId, format: args.format, createdBy: user._id, createdAt: Date.now() });
    return null;
  },
});
