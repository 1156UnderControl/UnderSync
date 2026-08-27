import { getAuthUserId, invalidateSessions, modifyAccountCredentials } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { action, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { integrationSummaryValidator, userSummaryValidator } from "./validators";
import { requireUser, userSummary } from "./lib/auth";

const resolvedAccountValidator = v.union(
  v.null(),
  v.object({
    email: v.string(),
    username: v.string(),
    displayName: v.string(),
    teamRole: v.string(),
    appRole: v.union(v.literal("ADMIN"), v.literal("MEMBER")),
    status: v.union(v.literal("ACTIVE"), v.literal("DISABLED"), v.literal("DELETED")),
  }),
);

export const resolveIdentifier = internalQuery({
  args: { identifier: v.string() },
  returns: resolvedAccountValidator,
  handler: async (ctx, args) => {
    const normalized = args.identifier.trim().toLowerCase();
    const byUsername = await ctx.db
      .query("users")
      .withIndex("by_appUsername", (q) => q.eq("appUsername", normalized))
      .unique();
    const user = byUsername ?? await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", normalized))
      .unique();
    if (user === null || !user.email) return null;
    return {
      email: user.email,
      username: user.appUsername ?? user.email,
      displayName: user.displayName ?? user.name ?? user.email,
      teamRole: user.teamRole ?? "Team member",
      appRole: user.appRole ?? "MEMBER",
      status: user.status ?? "ACTIVE",
    };
  },
});

export const registrationAvailability = internalQuery({
  args: { email: v.string(), username: v.string() },
  returns: v.object({ available: v.boolean(), reason: v.union(v.string(), v.null()) }),
  handler: async (ctx, args) => {
    const byEmail = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", args.email)).unique();
    if (byEmail !== null) return { available: false, reason: "That email is already registered." };
    const byUsername = await ctx.db
      .query("users")
      .withIndex("by_appUsername", (q) => q.eq("appUsername", args.username))
      .unique();
    return byUsername === null
      ? { available: true, reason: null }
      : { available: false, reason: "That name is already registered." };
  },
});

const defaultSubsystems = [
  ["CH", "Chassis"],
] as const;
const defaultMethods = [
  ["MAN", "Manual"],
] as const;
const defaultMaterials = [
  ["PLA", "PLA"],
] as const;

async function seedDefaults(ctx: MutationCtx) {
  const setting = await ctx.db.query("appSettings").withIndex("by_key", (q) => q.eq("key", "seasonCode")).unique();
  if (setting === null) {
    const settings = [
      ["seasonCode", "26"], ["partsFormTitle", "Registrar peça"], ["partsNameLabel", "Nome da peça"],
      ["partsQuantityLabel", "Quantidade"], ["partsSubsystemLabel", "Subsistema"],
      ["partsDesignerLabel", "Designer"], ["partsMethodLabel", "Método de fabricação"],
      ["partsMaterialLabel", "Material"], ["partsSubmitLabel", "Registrar peça"],
    ] as const;
    for (const [key, value] of settings) await ctx.db.insert("appSettings", { key, value });
  }

  for (const [code, name] of defaultSubsystems) {
    if (await ctx.db.query("subsystems").withIndex("by_code", (q) => q.eq("code", code)).unique() === null) {
      await ctx.db.insert("subsystems", { code, name, active: true });
    }
  }
  const methodIds = new Map<string, Id<"manufacturingMethods">>();
  for (const [code, name] of defaultMethods) {
    let method = await ctx.db.query("manufacturingMethods").withIndex("by_code", (q) => q.eq("code", code)).unique();
    if (method === null) {
      const id = await ctx.db.insert("manufacturingMethods", { code, name, active: true });
      method = await ctx.db.get("manufacturingMethods", id);
    }
    if (method !== null) methodIds.set(code, method._id);
  }
  const materialIds = new Map<string, Id<"materials">>();
  for (const [code, name] of defaultMaterials) {
    let material = await ctx.db.query("materials").withIndex("by_code", (q) => q.eq("code", code)).unique();
    if (material === null) {
      const id = await ctx.db.insert("materials", { code, name, active: true });
      material = await ctx.db.get("materials", id);
    }
    if (material !== null) materialIds.set(code, material._id);
  }
  const compatibility: Record<string, readonly string[]> = {
   MCNC: ["AL", "ACO", "PC"], MTOR: ["AL", "ACO"], CFL: ["ACO"],
    LCNC: ["AL", "MAD", "PC"], LLAS: ["MAD", "PC"], IMP: ["PLA", "PETG", "ABS"],
    MAN: ["AL", "ACO", "MAD", "PC"], RCL: ["MAD", "PC"],
  };
  for (const [methodCode, materialCodes] of Object.entries(compatibility)) {
    const methodId = methodIds.get(methodCode);
    if (!methodId) continue;
    for (const materialCode of materialCodes) {
      const materialId = materialIds.get(materialCode);
      if (!materialId) continue;
      const existing = await ctx.db.query("manufacturingMethodMaterials")
        .withIndex("by_manufacturingMethodId_and_materialId", (q) =>
          q.eq("manufacturingMethodId", methodId).eq("materialId", materialId))
        .unique();
      if (existing === null) await ctx.db.insert("manufacturingMethodMaterials", { manufacturingMethodId: methodId, materialId });
    }
  }
}

export const ensureCurrent = mutation({
  args: {},
  returns: userSummaryValidator,
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Authentication required.");
    const user = await ctx.db.get("users", userId);
    if (user === null) throw new Error("Account not found.");
    if (user.status !== undefined && user.status !== "ACTIVE") throw new Error("This account is not active.");
    const activeAdmin = await ctx.db.query("users")
      .withIndex("by_appRole_and_status", (q) => q.eq("appRole", "ADMIN").eq("status", "ACTIVE"))
      .first();
    const bootstrapAdmin = activeAdmin === null;
    const patch = {
      appUsername: user.appUsername ?? user.email?.split("@")[0] ?? `user-${userId}`,
      displayName: user.displayName ?? user.name ?? user.email ?? "UnderSync user",
      teamRole: user.teamRole ?? "Team member",
      appRole: bootstrapAdmin ? "ADMIN" as const : user.appRole ?? "MEMBER" as const,
      status: user.status ?? "ACTIVE" as const,
    };
    await ctx.db.patch("users", userId, patch);
    if (bootstrapAdmin) {
      await ctx.db.insert("auditEvents", { actorUserId: userId, action: "INITIAL_ADMIN_BOOTSTRAPPED", targetType: "user",
        targetId: userId, summary: "Promoted the first active administrator.", createdAt: Date.now() });
    }
    await seedDefaults(ctx);
    const updated = await ctx.db.get("users", userId);
    if (updated === null) throw new Error("Account not found.");
    return userSummary(updated);
  },
});

export const current = query({
  args: {},
  returns: v.union(v.null(), v.object({ user: userSummaryValidator, integrations: v.array(integrationSummaryValidator) })),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const user = await ctx.db.get("users", userId);
    if (user === null) return null;
    const linked = await ctx.db.query("integrationAccounts")
      .withIndex("by_userId_and_provider", (q) => q.eq("userId", userId))
      .take(10);
    const integrations = (["ONSHAPE", "NOTION"] as const).map((provider) => {
      const account = linked.find((item) => item.provider === provider);
      return {
        provider,
        status: account?.status ?? "NOT_CONNECTED" as const,
        externalDisplayName: account?.externalDisplayName ?? null,
        externalEmail: account?.externalEmail ?? null,
      };
    });
    return { user: userSummary(user), integrations };
  },
});

export const updateCurrent = mutation({
  args: { username: v.string(), displayName: v.string(), teamRole: v.string() },
  returns: userSummaryValidator,
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const username = args.username.trim().toLowerCase();
    const displayName = args.displayName.trim();
    const teamRole = args.teamRole.trim();
    if (!/^[a-z0-9._-]{2,80}$/.test(username)) throw new Error("Choose a valid account name.");
    if (displayName.length < 2 || displayName.length > 100 || teamRole.length < 2 || teamRole.length > 100) {
      throw new Error("Check the display name and team role.");
    }
    const existing = await ctx.db.query("users").withIndex("by_appUsername", (q) => q.eq("appUsername", username)).unique();
    if (existing !== null && existing._id !== user._id) throw new Error("That account name is already in use.");
    await ctx.db.patch("users", user._id, { appUsername: username, displayName, name: displayName, teamRole });
    const updated = await ctx.db.get("users", user._id);
    if (updated === null) throw new Error("Account not found.");
    return userSummary(updated);
  },
});

export const passwordChangeContext = internalQuery({
  args: {}, returns: v.object({ userId: v.id("users"), email: v.string() }),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    if (!user.email) throw new Error("This account has no password email.");
    return { userId: user._id, email: user.email };
  },
});

export const changePassword = action({
  args: { newPassword: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    if (args.newPassword.length < 4 || args.newPassword.length > 254) {
      throw new Error("The new password must contain 4 to 254 characters.");
    }
    const account = await ctx.runQuery(internal.profiles.passwordChangeContext, {});
    await modifyAccountCredentials(ctx, { provider: "password", account: { id: account.email, secret: args.newPassword } });
    await invalidateSessions(ctx, { userId: account.userId });
    return null;
  },
});
