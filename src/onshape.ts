import type { DatabasePool } from "./db.js";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "./integration-crypto.js";

export interface OnshapeConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizationUrl: string;
  tokenUrl: string;
  apiBaseUrl: string;
  encryptionKey: string;
}

export interface OnshapeTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
}

export interface SelectionInput {
  documentId: string;
  workspaceId: string;
  elementId: string;
  microversionId: string;
  selectionId: string;
  selectionType: string;
  entityType?: string;
  configuration?: string;
}

export interface ResolvedPart extends SelectionInput {
  partId: string;
  name: string | null;
  partNumber: string | null;
}

type FetchLike = typeof fetch;

export function onshapeConfigured(config: OnshapeConfig): boolean {
  return Boolean(config.clientId && config.clientSecret && config.redirectUri && config.encryptionKey);
}

export async function exchangeOnshapeToken(config: OnshapeConfig, parameters: Record<string, string>, fetchImpl: FetchLike = fetch): Promise<OnshapeTokenResponse> {
  const body = new URLSearchParams({ ...parameters, client_id: config.clientId, client_secret: config.clientSecret });
  const response = await fetchImpl(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  const raw = await response.text();
  let parsed: unknown;
  try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = { message: raw }; }
  if (!response.ok) throw new Error(`Onshape token endpoint returned HTTP ${response.status}: ${responseMessage(parsed)}`);
  const token = parsed as Partial<OnshapeTokenResponse>;
  if (!token.access_token) throw new Error("Onshape token response did not contain an access token.");
  return token as OnshapeTokenResponse;
}

export async function fetchOnshapeProfile(config: OnshapeConfig, accessToken: string, fetchImpl: FetchLike = fetch) {
  const response = await fetchImpl(new URL("/api/users/sessioninfo", config.apiBaseUrl), {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`Onshape profile returned HTTP ${response.status}: ${responseMessage(body)}`);
  const externalUserId = stringValue(body.id) ?? stringValue(body.userId) ?? stringValue((body.user as Record<string, unknown> | undefined)?.id);
  if (!externalUserId) throw new Error("Onshape profile did not contain a user ID.");
  return {
    externalUserId,
    displayName: stringValue(body.name) ?? stringValue(body.displayName),
    email: stringValue(body.email),
    metadata: body,
  };
}

export async function usableOnshapeAccessToken(database: DatabasePool, userId: string, config: OnshapeConfig, fetchImpl: FetchLike = fetch): Promise<string> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT e.id, g.access_token_encrypted, g.refresh_token_encrypted, g.expires_at
         FROM external_identities e
         JOIN integration_connections c ON c.id = e.connection_id AND c.provider = 'ONSHAPE'
         JOIN onshape_oauth_grants g ON g.external_identity_id = e.id
        WHERE e.user_id = $1 AND e.status = 'VERIFIED'
        ORDER BY e.verified_at DESC LIMIT 1 FOR UPDATE OF g`,
      [userId],
    );
    if (result.rowCount !== 1) throw new Error("Link your Onshape account before using Parts Tracking.");
    const grant = result.rows[0];
    const expiresAt = grant.expires_at ? new Date(grant.expires_at).getTime() : 0;
    if (!expiresAt || expiresAt > Date.now() + 60_000) {
      const accessToken = decryptIntegrationSecret(grant.access_token_encrypted, config.encryptionKey);
      await client.query("COMMIT");
      return accessToken;
    }
    if (!grant.refresh_token_encrypted) throw new Error("The Onshape grant expired and has no refresh token. Link the account again.");

    const refreshToken = decryptIntegrationSecret(grant.refresh_token_encrypted, config.encryptionKey);
    const refreshed = await exchangeOnshapeToken(config, { grant_type: "refresh_token", refresh_token: refreshToken }, fetchImpl);
    const nextRefresh = refreshed.refresh_token ?? refreshToken;
    const nextExpiry = new Date(Date.now() + Math.max(60, refreshed.expires_in ?? 3600) * 1000);
    await client.query(
      `UPDATE onshape_oauth_grants SET access_token_encrypted = $1, refresh_token_encrypted = $2,
         token_type = $3, scope = COALESCE($4, scope), expires_at = $5 WHERE external_identity_id = $6`,
      [encryptIntegrationSecret(refreshed.access_token, config.encryptionKey), encryptIntegrationSecret(nextRefresh, config.encryptionKey), refreshed.token_type ?? "Bearer", refreshed.scope ?? null, nextExpiry, grant.id],
    );
    await client.query("COMMIT");
    return refreshed.access_token;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

function unresolvedExtensionValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return !trimmed || /^\{\$[A-Za-z][A-Za-z0-9]*\}$/.test(trimmed) ? undefined : trimmed;
}

export function parseSelectionInput(value: unknown): SelectionInput {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const required = ["documentId", "workspaceId", "elementId", "microversionId", "selectionId", "selectionType"] as const;
  for (const field of required) if (!unresolvedExtensionValue(data[field])) throw new Error(`Selection is missing ${field}.`);
  return {
    documentId: unresolvedExtensionValue(data.documentId)!, workspaceId: unresolvedExtensionValue(data.workspaceId)!,
    elementId: unresolvedExtensionValue(data.elementId)!, microversionId: unresolvedExtensionValue(data.microversionId)!,
    selectionId: unresolvedExtensionValue(data.selectionId)!, selectionType: unresolvedExtensionValue(data.selectionType)!,
    ...(unresolvedExtensionValue(data.entityType) ? { entityType: unresolvedExtensionValue(data.entityType) } : {}),
    ...(unresolvedExtensionValue(data.configuration) ? { configuration: unresolvedExtensionValue(data.configuration) } : {}),
  };
}

export async function resolveOnshapePart(config: OnshapeConfig, input: SelectionInput, accessToken: string, fetchImpl: FetchLike = fetch): Promise<ResolvedPart> {
  const partsUrl = new URL(`/api/v9/parts/d/${encodeURIComponent(input.documentId)}/m/${encodeURIComponent(input.microversionId)}/e/${encodeURIComponent(input.elementId)}`, config.apiBaseUrl);
  partsUrl.searchParams.set("withThumbnails", "false");
  partsUrl.searchParams.set("includePropertyDefaults", "false");
  if (input.configuration) partsUrl.searchParams.set("configuration", input.configuration);
  const partsBody = await getJson(partsUrl, accessToken, fetchImpl);
  const parts = normalizeParts(partsBody);
  let part = parts.find((candidate) => candidate.partId === input.selectionId);
  if (!part && input.selectionType !== "BODY") {
    const detailsUrl = new URL(`/api/v9/partstudios/d/${encodeURIComponent(input.documentId)}/m/${encodeURIComponent(input.microversionId)}/e/${encodeURIComponent(input.elementId)}/bodydetails`, config.apiBaseUrl);
    if (input.configuration) detailsUrl.searchParams.set("configuration", input.configuration);
    const details = await getJson(detailsUrl, accessToken, fetchImpl);
    const owners = geometryOwners(details, input.selectionId, new Set(parts.map((item) => item.partId)));
    if (owners.size > 1) throw new Error("The selected geometry maps to more than one Onshape part.");
    if (owners.size === 1) part = parts.find((candidate) => candidate.partId === [...owners][0]);
  }
  if (!part) throw new Error("No exact Onshape Part ID or unique structural owner was found for this selection.");
  return { ...input, ...part };
}

export function trackedOnshapeName(formName: string, trackingCode: string): string {
  const name = formName.trim();
  if (!name) return trackingCode;
  if (name === trackingCode || name.endsWith(` | ${trackingCode}`)) return name;
  return `${name} | ${trackingCode}`;
}

export async function renameOnshapePart(config: OnshapeConfig, part: ResolvedPart, newName: string, accessToken: string, fetchImpl: FetchLike = fetch): Promise<void> {
  if (part.name === newName) return;
  const url = new URL(`/api/v10/metadata/d/${encodeURIComponent(part.documentId)}/w/${encodeURIComponent(part.workspaceId)}/e/${encodeURIComponent(part.elementId)}/p/${encodeURIComponent(part.partId)}`, config.apiBaseUrl);
  if (part.configuration) url.searchParams.set("configuration", part.configuration);
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json;charset=UTF-8", "Content-Type": "application/json;charset=UTF-8" },
    body: JSON.stringify({ jsonType: "metadata-part", partId: part.partId, properties: [{ value: newName, propertyId: "57f3fb8efa3416c06701d60d" }] }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Onshape rename returned HTTP ${response.status}: ${body.slice(0, 500)}`);
  }
}

function stringValue(value: unknown): string | undefined { return typeof value === "string" && value ? value : undefined; }
function responseMessage(value: unknown): string {
  if (value && typeof value === "object") return stringValue((value as Record<string, unknown>).message) ?? JSON.stringify(value);
  return String(value ?? "Unknown error");
}
async function getJson(url: URL, accessToken: string, fetchImpl: FetchLike): Promise<unknown> {
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json;charset=UTF-8" } });
  const raw = await response.text();
  let body: unknown = raw;
  try { body = raw ? JSON.parse(raw) : null; } catch { /* retain response text */ }
  if (!response.ok) throw new Error(`Onshape API returned HTTP ${response.status}: ${responseMessage(body)}`);
  return body;
}
function normalizeParts(value: unknown): Array<{ partId: string; name: string | null; partNumber: string | null }> {
  const found = new Map<string, { partId: string; name: string | null; partNumber: string | null }>();
  function visit(node: unknown): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return void node.forEach(visit);
    const record = node as Record<string, unknown>;
    if (typeof record.partId === "string" && !found.has(record.partId)) found.set(record.partId, { partId: record.partId, name: stringValue(record.name) ?? null, partNumber: stringValue(record.partNumber) ?? null });
    Object.values(record).forEach(visit);
  }
  visit(value);
  return [...found.values()];
}
function geometryOwners(value: unknown, selectedId: string, knownParts: Set<string>): Set<string> {
  const result = new Set<string>();
  function visit(node: unknown, inherited: Set<string>, key = ""): void {
    if (!node || typeof node !== "object") return;
    const owners = new Set(inherited);
    if (knownParts.has(key)) owners.add(key);
    if (!Array.isArray(node)) for (const child of Object.values(node as Record<string, unknown>)) if (typeof child === "string" && knownParts.has(child)) owners.add(child);
    const entries = Array.isArray(node) ? [...node.entries()] : Object.entries(node as Record<string, unknown>);
    for (const [childKey, child] of entries) {
      if (typeof child === "string" && child === selectedId && (String(childKey).toLowerCase() === "id" || String(childKey).toLowerCase().endsWith("id"))) owners.forEach((owner) => result.add(owner));
      if (child && typeof child === "object") visit(child, owners, String(childKey));
    }
  }
  visit(value, new Set());
  return result;
}
