import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireUser } from "./lib/auth";

export const summary = query({
  args: {},
  returns: v.object({ users: v.number(), parts: v.number(), activeMethods: v.number(), activeMaterials: v.number(), recentParts: v.array(v.object({ trackingCode: v.string(), name: v.string(), quantity: v.number() })) }),
  handler: async (ctx) => {
    await requireUser(ctx);
    const [users, parts, methods, materials, recentParts] = await Promise.all([
      ctx.db.query("users").withIndex("by_status", (q) => q.eq("status", "ACTIVE")).take(101),
      ctx.db.query("parts").withIndex("by_status", (q) => q.eq("status", "IN_DEVELOPMENT")).take(101),
      ctx.db.query("manufacturingMethods").order("asc").take(101),
      ctx.db.query("materials").order("asc").take(101),
      ctx.db.query("parts").order("desc").take(5),
    ]);
    return { users: users.length, parts: parts.length, activeMethods: methods.filter((item) => item.active).length,
      activeMaterials: materials.filter((item) => item.active).length,
      recentParts: recentParts.map((item) => ({ trackingCode: item.trackingCode, name: item.name, quantity: item.quantity })) };
  },
});
