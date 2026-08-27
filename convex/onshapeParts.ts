import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { action } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "./lib/onshapeCrypto";
import { onshapeConfig } from "./lib/onshapeConfig";

type PartSummary = { partId: string; name: string | null };

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeParts(value: unknown): PartSummary[] {
  const found = new Map<string, PartSummary>();
  function visit(node: unknown): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const record = node as Record<string, unknown>;
    if (typeof record.partId === "string" && !found.has(record.partId)) {
      found.set(record.partId, { partId: record.partId, name: text(record.name) ?? null });
    }
    Object.values(record).forEach(visit);
  }
  visit(value);
  return [...found.values()];
}

function geometryOwners(value: unknown, selectionId: string, knownPartIds: Set<string>): Set<string> {
  const result = new Set<string>();
  function visit(node: unknown, inherited: Set<string>, key = ""): void {
    if (!node || typeof node !== "object") return;
    const owners = new Set(inherited);
    if (knownPartIds.has(key)) owners.add(key);
    if (!Array.isArray(node)) {
      for (const child of Object.values(node as Record<string, unknown>)) {
        if (typeof child === "string" && knownPartIds.has(child)) owners.add(child);
      }
    }
    const entries = Array.isArray(node) ? [...node.entries()] : Object.entries(node as Record<string, unknown>);
    for (const [childKey, child] of entries) {
      const keyName = String(childKey).toLowerCase();
      if (typeof child === "string" && child === selectionId && (keyName === "id" || keyName.endsWith("id"))) {
        owners.forEach((owner) => result.add(owner));
      }
      if (child && typeof child === "object") visit(child, owners, String(childKey));
    }
  }
  visit(value, new Set());
  return result;
}

async function responseJson(response: Response, label: string): Promise<unknown> {
  const raw = await response.text();
  let value: unknown = raw;
  try { value = raw ? JSON.parse(raw) : null; } catch { /* keep text evidence */ }
  if (!response.ok) {
    const message = value && typeof value === "object" ? text((value as Record<string, unknown>).message) : text(value);
    throw new Error(`${label} returned HTTP ${response.status}: ${message ?? "Unknown Onshape error"}`);
  }
  return value;
}

export const register = action({
  args: {
    documentId: v.string(), workspaceId: v.string(), elementId: v.string(), microversionId: v.string(),
    selectionId: v.string(), selectionType: v.string(), entityType: v.optional(v.string()), configuration: v.optional(v.string()),
    name: v.string(), quantity: v.number(), subsystemId: v.id("subsystems"), designerId: v.id("users"),
    manufacturingMethodId: v.id("manufacturingMethods"), materialId: v.id("materials"),
  },
  returns: v.object({ trackingCode: v.string(), onshapeName: v.string(), renameStatus: v.union(v.literal("SUCCEEDED"), v.literal("FAILED")), warning: v.union(v.string(), v.null()) }),
  handler: async (ctx, args): Promise<{
    trackingCode: string;
    onshapeName: string;
    renameStatus: "SUCCEEDED" | "FAILED";
    warning: string | null;
  }> => {
    const config = onshapeConfig();
    const grant = await ctx.runQuery(internal.onshapeOAuthData.currentGrant, {});
    let accessToken = await decryptIntegrationSecret(grant.accessTokenEncrypted, config.encryptionKey);
    if (grant.expiresAt <= Date.now() + 60_000) {
      if (!grant.refreshTokenEncrypted) throw new Error("The Onshape authorization expired. Disconnect and link the account again.");
      const refreshToken = await decryptIntegrationSecret(grant.refreshTokenEncrypted, config.encryptionKey);
      const tokenResponse = await fetch(config.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: config.clientId, client_secret: config.clientSecret }),
      });
      const refreshed = await responseJson(tokenResponse, "Onshape token refresh") as Record<string, unknown>;
      accessToken = text(refreshed.access_token) ?? "";
      if (!accessToken) throw new Error("Onshape token refresh did not return an access token.");
      const nextRefresh = text(refreshed.refresh_token) ?? refreshToken;
      const expiresIn = typeof refreshed.expires_in === "number" ? Math.max(60, refreshed.expires_in) : 3600;
      await ctx.runMutation(internal.onshapeOAuthData.replaceGrantTokens, {
        grantId: grant.grantId,
        accessTokenEncrypted: await encryptIntegrationSecret(accessToken, config.encryptionKey),
        refreshTokenEncrypted: await encryptIntegrationSecret(nextRefresh, config.encryptionKey),
        tokenType: text(refreshed.token_type) ?? "Bearer",
        ...(text(refreshed.scope) ? { scope: text(refreshed.scope)! } : {}),
        expiresAt: Date.now() + expiresIn * 1000,
      });
    }

    const base = config.apiBaseUrl.replace(/\/$/u, "");
    const partsUrl = new URL(`${base}/api/v9/parts/d/${encodeURIComponent(args.documentId)}/m/${encodeURIComponent(args.microversionId)}/e/${encodeURIComponent(args.elementId)}`);
    partsUrl.searchParams.set("withThumbnails", "false");
    partsUrl.searchParams.set("includePropertyDefaults", "false");
    if (args.configuration) partsUrl.searchParams.set("configuration", args.configuration);
    const headers = { Authorization: `Bearer ${accessToken}`, Accept: "application/json;charset=UTF-8" };
    const parts = normalizeParts(await responseJson(await fetch(partsUrl, { headers }), "Onshape Parts API"));
    let part = parts.find((candidate) => candidate.partId === args.selectionId);
    if (!part && args.selectionType !== "BODY") {
      const detailsUrl = new URL(`${base}/api/v9/partstudios/d/${encodeURIComponent(args.documentId)}/m/${encodeURIComponent(args.microversionId)}/e/${encodeURIComponent(args.elementId)}/bodydetails`);
      if (args.configuration) detailsUrl.searchParams.set("configuration", args.configuration);
      const details = await responseJson(await fetch(detailsUrl, { headers }), "Onshape Body Details API");
      const owners = geometryOwners(details, args.selectionId, new Set(parts.map((candidate) => candidate.partId)));
      if (owners.size > 1) throw new Error("The selected geometry maps to more than one Onshape part.");
      if (owners.size === 1) part = parts.find((candidate) => candidate.partId === [...owners][0]);
    }
    if (!part) throw new Error("The selected geometry could not be resolved to one Onshape part.");

    const created: { id: Id<"parts">; trackingCode: string; onshapeName: string } = await ctx.runMutation(api.parts.create, {
      name: args.name, quantity: args.quantity, subsystemId: args.subsystemId, designerId: args.designerId,
      manufacturingMethodId: args.manufacturingMethodId, materialId: args.materialId,
      onshapeDocumentId: args.documentId, onshapeElementId: args.elementId, onshapePartId: part.partId,
    });
    const onshapeName = `${args.name.trim()} | ${created.trackingCode}`;
    const renameUrl = new URL(`${base}/api/v10/metadata/d/${encodeURIComponent(args.documentId)}/w/${encodeURIComponent(args.workspaceId)}/e/${encodeURIComponent(args.elementId)}/p/${encodeURIComponent(part.partId)}`);
    if (args.configuration) renameUrl.searchParams.set("configuration", args.configuration);
    const renameResponse = await fetch(renameUrl, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json;charset=UTF-8" },
      body: JSON.stringify({ jsonType: "metadata-part", partId: part.partId, properties: [{ value: onshapeName, propertyId: "57f3fb8efa3416c06701d60d" }] }),
    });
    if (!renameResponse.ok) {
      const warning = `Registered ${created.trackingCode}, but Onshape rename returned HTTP ${renameResponse.status}.`;
      return { trackingCode: created.trackingCode, onshapeName, renameStatus: "FAILED" as const, warning };
    }
    return { trackingCode: created.trackingCode, onshapeName, renameStatus: "SUCCEEDED" as const, warning: null };
  },
});
