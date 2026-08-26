import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { encryptIntegrationSecret, hashOAuthState } from "./lib/onshapeCrypto";
import { onshapeConfig } from "./lib/onshapeConfig";

type TokenResponse = {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  scope?: string;
  expiresIn: number;
};

function redirectToAccount(siteUrl: string, result: "connected" | "error", reason?: string): Response {
  const url = new URL("/account", siteUrl);
  url.searchParams.set("onshape", result);
  if (reason) url.searchParams.set("reason", reason);
  return Response.redirect(url.toString(), 302);
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readTokenResponse(value: unknown): TokenResponse {
  if (typeof value !== "object" || value === null) throw new Error("Onshape returned an invalid token response.");
  const record = value as Record<string, unknown>;
  const accessToken = stringField(record.access_token);
  if (!accessToken) throw new Error("Onshape did not return an access token.");
  return {
    accessToken,
    refreshToken: stringField(record.refresh_token),
    tokenType: stringField(record.token_type) ?? "Bearer",
    scope: stringField(record.scope),
    expiresIn: typeof record.expires_in === "number" && Number.isFinite(record.expires_in)
      ? Math.max(60, record.expires_in)
      : 3600,
  };
}

function readProfile(value: unknown): { id: string; displayName?: string; email?: string } {
  if (typeof value !== "object" || value === null) throw new Error("Onshape returned an invalid user profile.");
  const record = value as Record<string, unknown>;
  const nested = typeof record.user === "object" && record.user !== null
    ? record.user as Record<string, unknown>
    : undefined;
  const id = stringField(record.id) ?? stringField(record.userId) ?? stringField(nested?.id);
  if (!id) throw new Error("Onshape did not return a stable user ID.");
  return {
    id,
    displayName: stringField(record.name) ?? stringField(record.displayName) ?? stringField(nested?.name),
    email: stringField(record.email) ?? stringField(nested?.email),
  };
}

export const onshapeCallback = httpAction(async (ctx, request) => {
  let siteUrl = "https://under-sync.vercel.app";
  try {
    const config = onshapeConfig();
    siteUrl = config.siteUrl;
    const callbackUrl = new URL(request.url);
    const code = callbackUrl.searchParams.get("code");
    const state = callbackUrl.searchParams.get("state");
    if (callbackUrl.searchParams.has("error") || !code || !state) {
      return redirectToAccount(siteUrl, "error", "authorization_denied");
    }

    const stateRecord = await ctx.runMutation(internal.onshapeOAuthData.consumeState, {
      stateHash: await hashOAuthState(state),
      now: Date.now(),
    });
    if (stateRecord === null || stateRecord.redirectUri !== config.redirectUri) {
      return redirectToAccount(siteUrl, "error", "invalid_state");
    }

    const tokenResponse = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: config.redirectUri,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
    });
    if (!tokenResponse.ok) {
      console.error("Onshape token exchange failed", tokenResponse.status, (await tokenResponse.text()).slice(0, 500));
      return redirectToAccount(siteUrl, "error", "token_exchange");
    }
    const tokens = readTokenResponse(await tokenResponse.json());

    const profileResponse = await fetch(`${config.apiBaseUrl.replace(/\/$/u, "")}/api/users/sessioninfo`, {
      headers: { Authorization: `${tokens.tokenType} ${tokens.accessToken}`, Accept: "application/json" },
    });
    if (!profileResponse.ok) {
      console.error("Onshape profile request failed", profileResponse.status, (await profileResponse.text()).slice(0, 500));
      return redirectToAccount(siteUrl, "error", "profile_request");
    }
    const profile = readProfile(await profileResponse.json());
    await ctx.runMutation(internal.onshapeOAuthData.saveGrant, {
      userId: stateRecord.userId,
      externalUserId: profile.id,
      externalDisplayName: profile.displayName,
      externalEmail: profile.email,
      accessTokenEncrypted: await encryptIntegrationSecret(tokens.accessToken, config.encryptionKey),
      refreshTokenEncrypted: tokens.refreshToken
        ? await encryptIntegrationSecret(tokens.refreshToken, config.encryptionKey)
        : undefined,
      tokenType: tokens.tokenType,
      scope: tokens.scope,
      expiresAt: Date.now() + tokens.expiresIn * 1000,
    });
    return redirectToAccount(siteUrl, "connected");
  } catch (error) {
    console.error("Onshape OAuth callback failed", error instanceof Error ? error.message : error);
    return redirectToAccount(siteUrl, "error", "callback_failed");
  }
});
