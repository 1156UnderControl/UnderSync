import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type DatabaseCtx = QueryCtx | MutationCtx;

export async function requireUser(ctx: DatabaseCtx): Promise<Doc<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Authentication required.");
  const user = await ctx.db.get("users", userId);
  if (user === null || user.status !== "ACTIVE") throw new Error("This account is not active.");
  return user;
}

export async function requireAdmin(ctx: DatabaseCtx): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (user.appRole !== "ADMIN") throw new Error("Administrator access is required.");
  return user;
}

export function userSummary(user: Doc<"users">) {
  return {
    id: user._id,
    username: user.appUsername ?? user.email ?? "user",
    displayName: user.displayName ?? user.name ?? user.email ?? "UnderSync user",
    email: user.email ?? "",
    teamRole: user.teamRole ?? "Team member",
    appRole: user.appRole ?? ("MEMBER" as const),
    status: user.status ?? ("ACTIVE" as const),
  };
}
