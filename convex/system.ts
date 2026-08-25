import { query } from "./_generated/server";

/** Infrastructure-only connectivity probe. It reads and writes no product data. */
export const status = query({
  args: {},
  handler: async () => ({
    service: "undersync",
    architecture: "vercel-convex",
  }),
});
