import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "./lib/onshapeCrypto";
import { onshapeConfig } from "./lib/onshapeConfig";

const formatValidator = v.union(v.literal("STL"), v.literal("PARASOLID"));
type ExportContext = {
  userId: Id<"users">; trackingCode: string; name: string; documentId: string; workspaceId: string;
  elementId: string; onshapePartId: string; configuration: string | null;
};

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function activeAccessToken(ctx: ActionCtx) {
  const config = onshapeConfig();
  const grant = await ctx.runQuery(internal.onshapeOAuthData.currentGrant, {});
  let accessToken = await decryptIntegrationSecret(grant.accessTokenEncrypted, config.encryptionKey);
  if (grant.expiresAt > Date.now() + 60_000) return { accessToken, config };
  if (!grant.refreshTokenEncrypted) throw new Error("The Onshape authorization expired. Link the account again.");
  const refreshToken = await decryptIntegrationSecret(grant.refreshTokenEncrypted, config.encryptionKey);
  const response = await fetch(config.tokenUrl, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: config.clientId, client_secret: config.clientSecret }),
  });
  const value: unknown = await response.json();
  if (!response.ok || typeof value !== "object" || value === null) throw new Error("Onshape token refresh failed.");
  const record = value as Record<string, unknown>;
  accessToken = text(record.access_token) ?? "";
  if (!accessToken) throw new Error("Onshape token refresh did not return an access token.");
  const nextRefresh = text(record.refresh_token) ?? refreshToken;
  const expiresIn = typeof record.expires_in === "number" ? Math.max(60, record.expires_in) : 3600;
  await ctx.runMutation(internal.onshapeOAuthData.replaceGrantTokens, {
    grantId: grant.grantId, accessTokenEncrypted: await encryptIntegrationSecret(accessToken, config.encryptionKey),
    refreshTokenEncrypted: await encryptIntegrationSecret(nextRefresh, config.encryptionKey),
    tokenType: text(record.token_type) ?? "Bearer", ...(text(record.scope) ? { scope: text(record.scope)! } : {}),
    expiresAt: Date.now() + expiresIn * 1000,
  });
  return { accessToken, config };
}

async function downloadWithRedirects(url: string, accessToken: string): Promise<Response> {
  let current = url;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(current, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/octet-stream" }, redirect: "manual",
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Onshape export redirected without a download location.");
      current = new URL(location, current).toString();
      continue;
    }
    return response;
  }
  throw new Error("Onshape export redirected too many times.");
}

export const exportPart = action({
  args: { partId: v.id("parts"), format: formatValidator },
  returns: v.object({ fileName: v.string(), url: v.string() }),
  handler: async (ctx, args): Promise<{ fileName: string; url: string }> => {
    const part: ExportContext = await ctx.runQuery(internal.parts.exportContext, { partId: args.partId });
    const { accessToken, config } = await activeAccessToken(ctx);
    const base = config.apiBaseUrl.replace(/\/$/u, "");
    const path = `${base}/api/v6/parts/d/${encodeURIComponent(part.documentId)}/w/${encodeURIComponent(part.workspaceId)}/e/${encodeURIComponent(part.elementId)}/partid/${encodeURIComponent(part.onshapePartId)}`;
    const url = new URL(args.format === "STL" ? `${path}/stl` : `${path}/parasolid`);
    if (args.format === "STL") {
      url.searchParams.set("mode", "binary"); url.searchParams.set("units", "millimeter");
    } else url.searchParams.set("version", "0");
    if (part.configuration) url.searchParams.set("configuration", part.configuration);
    const response = await downloadWithRedirects(url.toString(), accessToken);
    if (!response.ok) throw new Error(`Onshape ${args.format} export returned HTTP ${response.status}.`);
    const blob = await response.blob();
    if (blob.size === 0) throw new Error("Onshape returned an empty export.");
    const storageId: Id<"_storage"> = await ctx.storage.store(blob);
    await ctx.runMutation(internal.parts.recordExport, { partId: args.partId, storageId, format: args.format });
    const storageUrl = await ctx.storage.getUrl(storageId);
    if (!storageUrl) throw new Error("The exported file could not be opened.");
    const safeCode: string = part.trackingCode.replace(/[^A-Za-z0-9._-]/g, "_");
    return { fileName: `${safeCode}.${args.format === "STL" ? "stl" : "x_t"}`, url: storageUrl };
  },
});
