import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./lib/auth";

/** Infrastructure-only connectivity probe. It reads and writes no product data. */
export const status = query({
  args: {},
  returns: v.object({ service: v.string(), architecture: v.string() }),
  handler: async () => ({
    service: "undersync",
    architecture: "vercel-convex",
  }),
});

export const branding = query({
  args: {},
  returns: v.object({ appName: v.string(), organizationName: v.string() }),
  handler: async (ctx) => {
    await requireUser(ctx);
    const [appName, organizationName] = await Promise.all([
      ctx.db.query("appSettings").withIndex("by_key", (q) => q.eq("key", "appName")).unique(),
      ctx.db.query("appSettings").withIndex("by_key", (q) => q.eq("key", "organizationName")).unique(),
    ]);
    return { appName: appName?.value ?? "UnderSync", organizationName: organizationName?.value ?? "FRC 1156 · Under Control" };
  },
});
