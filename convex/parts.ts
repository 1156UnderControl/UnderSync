import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./lib/auth";

const partValidator = v.object({
  id: v.id("parts"), trackingCode: v.string(), name: v.string(), quantity: v.number(), status: v.string(),
  subsystem: v.string(), designer: v.string(), method: v.string(), material: v.string(), createdAt: v.number(),
});

export const listRecent = query({
  args: {}, returns: v.array(partValidator),
  handler: async (ctx) => {
    await requireUser(ctx);
    const parts = await ctx.db.query("parts").order("desc").take(100);
    return await Promise.all(parts.map(async (part) => {
      const [subsystem, designer, method, material] = await Promise.all([
        ctx.db.get("subsystems", part.subsystemId), ctx.db.get("users", part.designerId),
        ctx.db.get("manufacturingMethods", part.manufacturingMethodId), ctx.db.get("materials", part.materialId),
      ]);
      return { id: part._id, trackingCode: part.trackingCode, name: part.name, quantity: part.quantity, status: part.status,
        subsystem: subsystem?.name ?? "Unknown", designer: designer?.displayName ?? designer?.name ?? "Unknown",
        method: method?.name ?? "Unknown", material: material?.name ?? "Unknown", createdAt: part.createdAt };
    }));
  },
});

export const create = mutation({
  args: {
    name: v.string(), quantity: v.number(), subsystemId: v.id("subsystems"), designerId: v.id("users"),
    manufacturingMethodId: v.id("manufacturingMethods"), materialId: v.id("materials"),
    onshapeDocumentId: v.optional(v.string()), onshapeElementId: v.optional(v.string()), onshapePartId: v.optional(v.string()),
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
          .eq("onshapeDocumentId", args.onshapeDocumentId)
          .eq("onshapeElementId", args.onshapeElementId)
          .eq("onshapePartId", args.onshapePartId))
        .unique();
      if (existing) throw new Error(`This Onshape part is already registered as ${existing.trackingCode}.`);
    }
    const season = await ctx.db.query("appSettings").withIndex("by_key", (q) => q.eq("key", "seasonCode")).unique();
    const seasonCode = season?.value ?? "26"; const counterKey = `parts:${seasonCode}`;
    let counter = await ctx.db.query("counters").withIndex("by_key", (q) => q.eq("key", counterKey)).unique();
    const sequenceValue = (counter?.value ?? 0) + 1;
    if (counter) await ctx.db.patch("counters", counter._id, { value: sequenceValue });
    else await ctx.db.insert("counters", { key: counterKey, value: sequenceValue });
    const trackingCode = `1156-${seasonCode}-${subsystem.code}-${String(sequenceValue).padStart(2, "0")}`;
    const id = await ctx.db.insert("parts", { trackingCode, sequenceValue, name, quantity: args.quantity, subsystemId: subsystem._id,
      designerId: designer._id, manufacturingMethodId: method._id, materialId: material._id, status: "IN_DEVELOPMENT",
      createdBy: user._id, createdAt: Date.now(),
      ...(args.onshapeDocumentId ? { onshapeDocumentId: args.onshapeDocumentId } : {}),
      ...(args.onshapeElementId ? { onshapeElementId: args.onshapeElementId } : {}),
      ...(args.onshapePartId ? { onshapePartId: args.onshapePartId } : {}),
    });
    await ctx.db.insert("auditEvents", { actorUserId: user._id, action: "PART_REGISTERED", targetType: "part", targetId: id,
      summary: `${name} registered as ${trackingCode}.`, createdAt: Date.now() });
    return { id, trackingCode, onshapeName: `${name} | ${trackingCode}` };
  },
});
