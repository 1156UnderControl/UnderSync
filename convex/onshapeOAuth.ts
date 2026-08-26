import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { hashOAuthState, randomOAuthState } from "./lib/onshapeCrypto";
import { onshapeConfig } from "./lib/onshapeConfig";

export const begin = action({
  args: {},
  returns: v.object({ authorizationUrl: v.string() }),
  handler: async (ctx) => {
    const config = onshapeConfig();
    const { userId } = await ctx.runQuery(internal.onshapeOAuthData.currentUser, {});
    const state = randomOAuthState();
    await ctx.runMutation(internal.onshapeOAuthData.storeState, {
      userId,
      stateHash: await hashOAuthState(state),
      redirectUri: config.redirectUri,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    const url = new URL(config.authorizationUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("state", state);
    return { authorizationUrl: url.toString() };
  },
});

export const disconnect = action({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const { userId } = await ctx.runQuery(internal.onshapeOAuthData.currentUser, {});
    await ctx.runMutation(internal.onshapeOAuthData.disconnect, { userId });
    return null;
  },
});
