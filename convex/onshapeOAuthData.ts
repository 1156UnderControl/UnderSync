import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { requireUser } from "./lib/auth";

export const currentUser = internalQuery({
  args: {},
  returns: v.object({ userId: v.id("users") }),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return { userId: user._id };
  },
});

export const currentGrant = internalQuery({
  args: {},
  returns: v.object({
    grantId: v.id("onshapeOAuthGrants"),
    accessTokenEncrypted: v.string(),
    refreshTokenEncrypted: v.union(v.string(), v.null()),
    tokenType: v.string(),
    scope: v.union(v.string(), v.null()),
    expiresAt: v.number(),
  }),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const account = await ctx.db.query("integrationAccounts")
      .withIndex("by_userId_and_provider", (q) => q.eq("userId", user._id).eq("provider", "ONSHAPE"))
      .unique();
    if (!account || account.status !== "CONNECTED") throw new Error("Link your Onshape account before registering a selected part.");
    const grant = await ctx.db.query("onshapeOAuthGrants")
      .withIndex("by_integrationAccountId", (q) => q.eq("integrationAccountId", account._id))
      .unique();
    if (!grant) throw new Error("The linked Onshape account has no OAuth grant. Link it again.");
    return {
      grantId: grant._id,
      accessTokenEncrypted: grant.accessTokenEncrypted,
      refreshTokenEncrypted: grant.refreshTokenEncrypted ?? null,
      tokenType: grant.tokenType,
      scope: grant.scope ?? null,
      expiresAt: grant.expiresAt,
    };
  },
});

export const replaceGrantTokens = internalMutation({
  args: {
    grantId: v.id("onshapeOAuthGrants"), accessTokenEncrypted: v.string(), refreshTokenEncrypted: v.string(),
    tokenType: v.string(), scope: v.optional(v.string()), expiresAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const grant = await ctx.db.get("onshapeOAuthGrants", args.grantId);
    if (!grant) throw new Error("The Onshape OAuth grant no longer exists.");
    await ctx.db.patch("onshapeOAuthGrants", grant._id, {
      accessTokenEncrypted: args.accessTokenEncrypted,
      refreshTokenEncrypted: args.refreshTokenEncrypted,
      tokenType: args.tokenType,
      ...(args.scope ? { scope: args.scope } : {}),
      expiresAt: args.expiresAt,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const storeState = internalMutation({
  args: {
    userId: v.id("users"),
    stateHash: v.string(),
    redirectUri: v.string(),
    expiresAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const oldStates = await ctx.db
      .query("onshapeOAuthStates")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .take(20);
    for (const state of oldStates) await ctx.db.delete("onshapeOAuthStates", state._id);

    await ctx.db.insert("onshapeOAuthStates", {
      ...args,
      createdAt: Date.now(),
    });
    return null;
  },
});

export const consumeState = internalMutation({
  args: { stateHash: v.string(), now: v.number() },
  returns: v.union(
    v.null(),
    v.object({ userId: v.id("users"), redirectUri: v.string() }),
  ),
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("onshapeOAuthStates")
      .withIndex("by_stateHash", (q) => q.eq("stateHash", args.stateHash))
      .unique();
    if (state === null || state.consumedAt !== undefined || state.expiresAt < args.now) return null;
    await ctx.db.patch("onshapeOAuthStates", state._id, { consumedAt: args.now });
    return { userId: state.userId, redirectUri: state.redirectUri };
  },
});

export const saveGrant = internalMutation({
  args: {
    userId: v.id("users"),
    externalUserId: v.string(),
    externalDisplayName: v.optional(v.string()),
    externalEmail: v.optional(v.string()),
    accessTokenEncrypted: v.string(),
    refreshTokenEncrypted: v.optional(v.string()),
    tokenType: v.string(),
    scope: v.optional(v.string()),
    expiresAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const conflictingAccount = await ctx.db
      .query("integrationAccounts")
      .withIndex("by_provider_and_externalUserId", (q) =>
        q.eq("provider", "ONSHAPE").eq("externalUserId", args.externalUserId),
      )
      .unique();
    if (conflictingAccount !== null && conflictingAccount.userId !== args.userId) {
      throw new Error("This Onshape account is already linked to another UnderSync account.");
    }

    const now = Date.now();
    const existingAccount = await ctx.db
      .query("integrationAccounts")
      .withIndex("by_userId_and_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", "ONSHAPE"),
      )
      .unique();
    const accountId = existingAccount?._id ?? await ctx.db.insert("integrationAccounts", {
      userId: args.userId,
      provider: "ONSHAPE",
      status: "CONNECTED",
      externalUserId: args.externalUserId,
      ...(args.externalDisplayName ? { externalDisplayName: args.externalDisplayName } : {}),
      ...(args.externalEmail ? { externalEmail: args.externalEmail } : {}),
      updatedAt: now,
    });
    if (existingAccount !== null) {
      await ctx.db.patch("integrationAccounts", existingAccount._id, {
        status: "CONNECTED",
        externalUserId: args.externalUserId,
        ...(args.externalDisplayName ? { externalDisplayName: args.externalDisplayName } : {}),
        ...(args.externalEmail ? { externalEmail: args.externalEmail } : {}),
        lastError: undefined,
        updatedAt: now,
      });
    }

    const existingGrant = await ctx.db
      .query("onshapeOAuthGrants")
      .withIndex("by_integrationAccountId", (q) => q.eq("integrationAccountId", accountId))
      .unique();
    const grant = {
      integrationAccountId: accountId,
      accessTokenEncrypted: args.accessTokenEncrypted,
      ...(args.refreshTokenEncrypted ? { refreshTokenEncrypted: args.refreshTokenEncrypted } : {}),
      tokenType: args.tokenType,
      ...(args.scope ? { scope: args.scope } : {}),
      expiresAt: args.expiresAt,
      updatedAt: now,
    };
    if (existingGrant === null) await ctx.db.insert("onshapeOAuthGrants", grant);
    else await ctx.db.replace("onshapeOAuthGrants", existingGrant._id, grant);

    await ctx.db.insert("auditEvents", {
      actorUserId: args.userId,
      action: "ONSHAPE_ACCOUNT_LINKED",
      targetType: "integrationAccount",
      targetId: accountId,
      summary: "Linked an Onshape account.",
      createdAt: now,
    });
    return null;
  },
});

export const disconnect = internalMutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("integrationAccounts")
      .withIndex("by_userId_and_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", "ONSHAPE"),
      )
      .unique();
    if (account === null) return null;
    const grant = await ctx.db
      .query("onshapeOAuthGrants")
      .withIndex("by_integrationAccountId", (q) => q.eq("integrationAccountId", account._id))
      .unique();
    if (grant !== null) await ctx.db.delete("onshapeOAuthGrants", grant._id);
    await ctx.db.delete("integrationAccounts", account._id);
    await ctx.db.insert("auditEvents", {
      actorUserId: args.userId,
      action: "ONSHAPE_ACCOUNT_DISCONNECTED",
      targetType: "integrationAccount",
      targetId: account._id,
      summary: "Disconnected an Onshape account and removed its stored tokens.",
      createdAt: Date.now(),
    });
    return null;
  },
});
