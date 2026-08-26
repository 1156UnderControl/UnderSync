import { query } from "./_generated/server";
import { v } from "convex/values";

/** Infrastructure-only connectivity probe. It reads and writes no product data. */
export const status = query({
  args: {},
  returns: v.object({ service: v.string(), architecture: v.string() }),
  handler: async () => ({
    service: "undersync",
    architecture: "vercel-convex",
  }),
});
