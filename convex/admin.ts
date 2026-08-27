import { invalidateSessions, modifyAccountCredentials } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalQuery, mutation, query } from "./_generated/server";
import { appRoleValidator, userStatusValidator, userSummaryValidator } from "./validators";
import { requireAdmin, userSummary } from "./lib/auth";

export const listUsers = query({
  args: {}, returns: v.array(userSummaryValidator),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return (await ctx.db.query("users").order("asc").take(100)).map(userSummary);
  },
});

export const databaseSnapshot = query({
  args: {},
  returns: v.array(v.object({ name: v.string(), rows: v.array(v.string()) })),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const tables = await Promise.all([
      ctx.db.query("users").take(100), ctx.db.query("integrationAccounts").take(100),
      ctx.db.query("appSettings").take(100), ctx.db.query("counters").take(100),
      ctx.db.query("subsystems").take(100), ctx.db.query("manufacturingMethods").take(100),
      ctx.db.query("materials").take(100), ctx.db.query("manufacturingMethodMaterials").take(100),
      ctx.db.query("parts").take(100), ctx.db.query("cotsTypes").take(100),
      ctx.db.query("cotsStatuses").take(100), ctx.db.query("cotsFieldDefinitions").take(100),
      ctx.db.query("cotsItems").take(100), ctx.db.query("cotsItemFieldValues").take(100),
      ctx.db.query("cotsItemQuantities").take(100), ctx.db.query("auditEvents").take(100),
    ]);
    const names = ["users", "integrationAccounts", "appSettings", "counters", "subsystems", "manufacturingMethods",
      "materials", "manufacturingMethodMaterials", "parts", "cotsTypes", "cotsStatuses", "cotsFieldDefinitions",
      "cotsItems", "cotsItemFieldValues", "cotsItemQuantities", "auditEvents"];
    return tables.map((rows, index) => ({ name: names[index], rows: rows.map((row) => JSON.stringify(row)) }));
  },
});

export const setRole = mutation({
  args: { userId: v.id("users"), role: appRoleValidator }, returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx); const target = await ctx.db.get("users", args.userId);
    if (!target) throw new Error("User not found.");
    if (target._id === admin._id && args.role !== "ADMIN") throw new Error("You cannot demote your current administrator account.");
    await ctx.db.patch("users", target._id, { appRole: args.role });
    await ctx.db.insert("auditEvents", { actorUserId: admin._id, action: "USER_ROLE_CHANGED", targetType: "user",
      targetId: target._id, summary: `Role changed to ${args.role}.`, createdAt: Date.now() });
    return null;
  },
});

export const setStatus = mutation({
  args: { userId: v.id("users"), status: userStatusValidator }, returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx); const target = await ctx.db.get("users", args.userId);
    if (!target) throw new Error("User not found.");
    if (target._id === admin._id && args.status !== "ACTIVE") throw new Error("You cannot disable your current account.");
    if (args.status === "DELETED") {
      await ctx.db.patch("users", target._id, {
        status: "DELETED", appRole: "MEMBER", appUsername: `deleted-${target._id}`,
        displayName: "Deleted user", name: "Deleted user", teamRole: "Former member",
      });
    } else await ctx.db.patch("users", target._id, { status: args.status });
    await ctx.db.insert("auditEvents", { actorUserId: admin._id, action: "USER_STATUS_CHANGED", targetType: "user",
      targetId: target._id, summary: `Status changed to ${args.status}.`, createdAt: Date.now() });
    return null;
  },
});

export const passwordResetContext = internalQuery({
  args: { targetUserId: v.id("users") },
  returns: v.object({ userId: v.id("users"), email: v.string() }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx); const target = await ctx.db.get("users", args.targetUserId);
    if (!target?.email) throw new Error("The user does not have a password email account.");
    return { userId: target._id, email: target.email };
  },
});

export const resetPassword = action({
  args: { targetUserId: v.id("users") }, returns: v.null(),
  handler: async (ctx, args) => {
    const target = await ctx.runQuery(internal.admin.passwordResetContext, args);
    await modifyAccountCredentials(ctx, { provider: "password", account: { id: target.email, secret: "Senha1156" } });
    await invalidateSessions(ctx, { userId: target.userId });
    return null;
  },
});
