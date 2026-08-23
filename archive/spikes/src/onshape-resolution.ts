export interface SelectionResolutionInput {
  documentId: string;
  workspaceId: string;
  elementId: string;
  microversionId: string;
  selectionId: string;
  selectionType: string;
  entityType?: string;
  configuration?: string;
}

export interface MinimalResolvedPart extends SelectionResolutionInput {
  partId: string;
  name: string | null;
  partNumber: string | null;
}

export interface ApiRequestEvidence {
  endpointName: "parts" | "bodydetails" | "renamePart";
  method: "GET" | "POST";
  endpoint: string;
  httpStatus: number | null;
  ok: boolean;
  durationMs: number;
  response?: unknown;
  requestBody?: unknown;
  error?: string;
}

export interface DiagnosticResolution extends MinimalResolvedPart {
  diagnostic: {
    requests: ApiRequestEvidence[];
    cache: Array<{ resource: "parts" | "bodydetails"; outcome: "HIT" | "MISS" | "IN_FLIGHT_JOIN" }>;
  };
}

export interface SessionDiagnostics {
  apiCallsThisSession: number;
  apiCallsByEndpoint: Record<string, number>;
  cacheHits: number;
  cacheMisses: number;
  inFlightJoins: number;
  failedRequests: number;
  averageRequestDurationMs: number;
  estimatedRemainingQuota: number | null;
  quotaEstimateBasis: string;
  currentRssBytes: number;
  peakObservedRssBytes: number;
  cacheEntries: { parts: number; bodydetails: number };
  cachePolicy: { ttlMs: number; maxPartContexts: number; maxBodyDetailContexts: number; maxGeometryIdsPerContext: number };
}

type FetchLike = typeof fetch;
type PartSummary = { partId: string; name: string | null; partNumber: string | null };
type BodyOwnership = { ownersByGeometryId: Map<string, string[]>; truncated: boolean };
type CacheOutcome = "HIT" | "MISS" | "IN_FLIGHT_JOIN";

const documentIdPattern = /^[0-9a-f]{24}$/i;
const geometryIdPattern = /^[A-Za-z0-9_.:+\-=]{1,512}$/;
const unresolvedActionParameterPattern = /^\{\$[A-Za-z][A-Za-z0-9]*\}$/;

export function isUnresolvedActionParameter(value: string): boolean {
  return unresolvedActionParameterPattern.test(value.trim());
}

function assertId(name: string, value: unknown, pattern: RegExp): asserts value is string {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`${name} has an invalid format.`);
}

export function validateSelectionInput(value: unknown): SelectionResolutionInput {
  if (!value || typeof value !== "object") throw new Error("A JSON selection object is required.");
  const input = value as Record<string, unknown>;
  assertId("documentId", input.documentId, documentIdPattern);
  assertId("workspaceId", input.workspaceId, documentIdPattern);
  assertId("elementId", input.elementId, documentIdPattern);
  assertId("microversionId", input.microversionId, documentIdPattern);
  assertId("selectionId", input.selectionId, geometryIdPattern);
  if (typeof input.selectionType !== "string" || input.selectionType.length === 0) throw new Error("selectionType is required.");
  if (input.configuration !== undefined && typeof input.configuration !== "string") throw new Error("configuration must be a string.");
  if (input.entityType !== undefined && typeof input.entityType !== "string") throw new Error("entityType must be a string.");
  const configuration =
    typeof input.configuration === "string" && input.configuration.trim() && !isUnresolvedActionParameter(input.configuration)
      ? input.configuration
      : undefined;
  return {
    documentId: input.documentId,
    workspaceId: input.workspaceId,
    elementId: input.elementId,
    microversionId: input.microversionId,
    selectionId: input.selectionId,
    selectionType: input.selectionType,
    entityType: typeof input.entityType === "string" ? input.entityType : undefined,
    configuration,
  };
}

export class ResolutionError extends Error {
  constructor(
    message: string,
    readonly kind: "NOT_FOUND" | "AMBIGUOUS" | "API_ERROR",
    readonly evidence: ApiRequestEvidence[] = [],
  ) {
    super(message);
  }
}

interface CacheEntry<T> {
  value?: T;
  expiresAt: number;
  inFlight?: Promise<{ value: T; evidence: ApiRequestEvidence[] }>;
}

class BoundedAsyncCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  constructor(private readonly maxEntries: number, private readonly ttlMs: number) {}
  get size(): number { return this.entries.size; }

  update(key: string, updater: (value: T) => void): boolean {
    const entry = this.entries.get(key);
    if (entry?.value === undefined || entry.expiresAt <= Date.now()) return false;
    updater(entry.value);
    return true;
  }

  async get(key: string, loader: () => Promise<{ value: T; evidence: ApiRequestEvidence[] }>) {
    const existing = this.entries.get(key);
    if (existing?.value !== undefined && existing.expiresAt > Date.now()) {
      this.entries.delete(key);
      this.entries.set(key, existing);
      return { value: existing.value, evidence: [] as ApiRequestEvidence[], outcome: "HIT" as CacheOutcome };
    }
    if (existing?.inFlight) {
      const loaded = await existing.inFlight;
      return { value: loaded.value, evidence: [] as ApiRequestEvidence[], outcome: "IN_FLIGHT_JOIN" as CacheOutcome };
    }
    if (existing) this.entries.delete(key);
    const entry: CacheEntry<T> = { expiresAt: Date.now() + this.ttlMs };
    entry.inFlight = loader();
    this.entries.set(key, entry);
    this.evictOverflow(key);
    try {
      const loaded = await entry.inFlight;
      entry.value = loaded.value;
      entry.inFlight = undefined;
      entry.expiresAt = Date.now() + this.ttlMs;
      this.evictOverflow(key);
      return { ...loaded, outcome: "MISS" as CacheOutcome };
    } catch (error) {
      this.entries.delete(key);
      throw error;
    }
  }

  private evictOverflow(protectedKey: string): void {
    while (this.entries.size > this.maxEntries) {
      const candidate = [...this.entries].find(([key, entry]) => key !== protectedKey && !entry.inFlight);
      if (!candidate) return;
      this.entries.delete(candidate[0]);
    }
  }
}

function findPartRecords(value: unknown, result: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (!value || typeof value !== "object") return result;
  if (Array.isArray(value)) value.forEach((child) => findPartRecords(child, result));
  else {
    const record = value as Record<string, unknown>;
    if (typeof record.partId === "string") result.push(record);
    Object.values(record).forEach((child) => findPartRecords(child, result));
  }
  return result;
}

function normalizeParts(value: unknown): PartSummary[] {
  const unique = new Map<string, PartSummary>();
  for (const record of findPartRecords(value)) {
    const partId = record.partId;
    if (typeof partId !== "string" || unique.has(partId)) continue;
    unique.set(partId, {
      partId,
      name: typeof record.name === "string" ? record.name : null,
      partNumber: typeof record.partNumber === "string" ? record.partNumber : null,
    });
  }
  return [...unique.values()];
}

function buildOwnershipIndex(value: unknown, knownPartIds: Set<string>, maxIds: number): BodyOwnership {
  const ownersByGeometryId = new Map<string, Set<string>>();
  let truncated = false;
  function visit(node: unknown, inheritedOwners: Set<string>, pathSegment?: string): void {
    if (!node || typeof node !== "object") return;
    const owners = new Set(inheritedOwners);
    if (pathSegment && knownPartIds.has(pathSegment)) owners.add(pathSegment);
    if (!Array.isArray(node)) {
      for (const candidate of Object.values(node as Record<string, unknown>)) {
        if (typeof candidate === "string" && knownPartIds.has(candidate)) owners.add(candidate);
      }
    }
    const entries = Array.isArray(node) ? [...node.entries()] : Object.entries(node as Record<string, unknown>);
    for (const [rawKey, child] of entries) {
      const key = String(rawKey);
      const lowerKey = key.toLowerCase();
      const isIdField = lowerKey === "id" || lowerKey.endsWith("id");
      const geometryId = typeof child === "string" && isIdField ? child : knownPartIds.has(key) ? key : null;
      if (geometryId && owners.size > 0) {
        if (ownersByGeometryId.size < maxIds || ownersByGeometryId.has(geometryId)) {
          const current = ownersByGeometryId.get(geometryId) ?? new Set<string>();
          owners.forEach((owner) => current.add(owner));
          ownersByGeometryId.set(geometryId, current);
        } else truncated = true;
      }
      if (child && typeof child === "object") visit(child, owners, key);
    }
  }
  visit(value, new Set());
  return {
    ownersByGeometryId: new Map([...ownersByGeometryId].map(([id, owners]) => [id, [...owners]])),
    truncated,
  };
}

export function createOnshapeResolver(options: {
  apiBaseUrl: string;
  fetchImpl?: FetchLike;
  ttlMs?: number;
  maxPartContexts?: number;
  maxBodyDetailContexts?: number;
  maxGeometryIdsPerContext?: number;
  annualQuota?: number;
}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const ttlMs = options.ttlMs ?? 15 * 60 * 1000;
  const maxPartContexts = options.maxPartContexts ?? 32;
  const maxBodyDetailContexts = options.maxBodyDetailContexts ?? 4;
  const maxGeometryIdsPerContext = options.maxGeometryIdsPerContext ?? 20_000;
  const partsCache = new BoundedAsyncCache<PartSummary[]>(maxPartContexts, ttlMs);
  const bodyCache = new BoundedAsyncCache<BodyOwnership>(maxBodyDetailContexts, ttlMs);
  const stats = {
    calls: 0, failures: 0, totalDurationMs: 0, cacheHits: 0, cacheMisses: 0, inFlightJoins: 0,
    byEndpoint: {} as Record<string, number>, peakRss: process.memoryUsage().rss,
  };
  function sampleMemory(): void { stats.peakRss = Math.max(stats.peakRss, process.memoryUsage().rss); }
  function contextKey(input: SelectionResolutionInput): string {
    return [options.apiBaseUrl, input.documentId, input.workspaceId, input.elementId, input.microversionId, input.configuration ?? ""].join("|");
  }
  function noteCache(outcome: CacheOutcome): void {
    if (outcome === "MISS") stats.cacheMisses += 1;
    else {
      stats.cacheHits += 1;
      if (outcome === "IN_FLIGHT_JOIN") stats.inFlightJoins += 1;
    }
  }

  async function requestJson(
    endpointName: "parts" | "bodydetails" | "renamePart",
    url: URL,
    accessToken: string,
    includeRawResponse: boolean,
    method: "GET" | "POST" = "GET",
    requestBody?: unknown,
  ) {
    const started = performance.now();
    stats.calls += 1;
    stats.byEndpoint[endpointName] = (stats.byEndpoint[endpointName] ?? 0) + 1;
    try {
      const response = await fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json;charset=UTF-8",
          ...(requestBody === undefined ? {} : { "Content-Type": "application/json;charset=UTF-8" }),
        },
        body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
        redirect: "follow",
      });
      const text = await response.text();
      let body: unknown = text;
      try { body = text ? JSON.parse(text) : null; } catch { /* Non-JSON remains ephemeral. */ }
      const durationMs = performance.now() - started;
      stats.totalDurationMs += durationMs;
      if (!response.ok) stats.failures += 1;
      sampleMemory();
      const evidence: ApiRequestEvidence = {
        endpointName, method, endpoint: url.toString(), httpStatus: response.status,
        ok: response.ok, durationMs,
        ...(includeRawResponse ? { requestBody, response: body } : {}),
      };
      return { body, evidence };
    } catch (error) {
      const durationMs = performance.now() - started;
      stats.totalDurationMs += durationMs;
      stats.failures += 1;
      sampleMemory();
      const evidence: ApiRequestEvidence = {
        endpointName, method, endpoint: url.toString(), httpStatus: null, ok: false,
        durationMs, error: error instanceof Error ? error.message : String(error),
        ...(includeRawResponse ? { requestBody } : {}),
      };
      return { body: null, evidence };
    }
  }

  async function loadParts(input: SelectionResolutionInput, accessToken: string, diagnostic: boolean) {
    const url = new URL(`/api/v9/parts/d/${input.documentId}/m/${input.microversionId}/e/${input.elementId}`, options.apiBaseUrl);
    url.searchParams.set("withThumbnails", "false");
    url.searchParams.set("includePropertyDefaults", "false");
    if (input.configuration) url.searchParams.set("configuration", input.configuration);
    const requested = await requestJson("parts", url, accessToken, diagnostic);
    if (!requested.evidence.ok) throw new ResolutionError("The Onshape Parts request failed.", "API_ERROR", [requested.evidence]);
    return { value: normalizeParts(requested.body), evidence: [requested.evidence] };
  }

  async function loadBodyOwnership(input: SelectionResolutionInput, accessToken: string, diagnostic: boolean, knownPartIds: Set<string>) {
    const url = new URL(`/api/v9/partstudios/d/${input.documentId}/m/${input.microversionId}/e/${input.elementId}/bodydetails`, options.apiBaseUrl);
    if (input.configuration) url.searchParams.set("configuration", input.configuration);
    const requested = await requestJson("bodydetails", url, accessToken, diagnostic);
    if (!requested.evidence.ok) throw new ResolutionError("The Onshape body-details request failed.", "API_ERROR", [requested.evidence]);
    return { value: buildOwnershipIndex(requested.body, knownPartIds, maxGeometryIdsPerContext), evidence: [requested.evidence] };
  }

  async function resolve(input: SelectionResolutionInput, accessToken: string, diagnostic = false): Promise<MinimalResolvedPart | DiagnosticResolution> {
    const cacheEvents: DiagnosticResolution["diagnostic"]["cache"] = [];
    const evidence: ApiRequestEvidence[] = [];
    const key = contextKey(input);
    const partsResult = await partsCache.get(key, () => loadParts(input, accessToken, diagnostic));
    noteCache(partsResult.outcome);
    cacheEvents.push({ resource: "parts", outcome: partsResult.outcome });
    evidence.push(...partsResult.evidence);

    let part = partsResult.value.find((candidate) => candidate.partId === input.selectionId);
    if (!part && input.selectionType !== "BODY") {
      const knownPartIds = new Set(partsResult.value.map((candidate) => candidate.partId));
      const bodyResult = await bodyCache.get(key, () => loadBodyOwnership(input, accessToken, diagnostic, knownPartIds));
      noteCache(bodyResult.outcome);
      cacheEvents.push({ resource: "bodydetails", outcome: bodyResult.outcome });
      evidence.push(...bodyResult.evidence);
      const owners = bodyResult.value.ownersByGeometryId.get(input.selectionId) ?? [];
      if (owners.length > 1) throw new ResolutionError("The selected geometry maps to more than one Part ID.", "AMBIGUOUS", evidence);
      if (owners.length === 1) part = partsResult.value.find((candidate) => candidate.partId === owners[0]);
      if (!part && bodyResult.value.truncated) {
        throw new ResolutionError("Ownership was not found in the bounded geometry index; the index was truncated.", "NOT_FOUND", evidence);
      }
    }
    if (!part) throw new ResolutionError("No exact Part ID or unique structural owner was found; no name fallback was used.", "NOT_FOUND", evidence);

    const minimal: MinimalResolvedPart = {
      partId: part.partId,
      name: part.name,
      partNumber: part.partNumber,
      documentId: input.documentId,
      workspaceId: input.workspaceId,
      elementId: input.elementId,
      microversionId: input.microversionId,
      selectionId: input.selectionId,
      selectionType: input.selectionType,
      ...(input.entityType ? { entityType: input.entityType } : {}),
      ...(input.configuration ? { configuration: input.configuration } : {}),
    };
    sampleMemory();
    return diagnostic ? { ...minimal, diagnostic: { requests: evidence, cache: cacheEvents } } : minimal;
  }

  async function renamePart(input: SelectionResolutionInput, accessToken: string, requestedName: string) {
    const newName = requestedName.trim();
    if (newName.length < 1 || newName.length > 256) throw new Error("Part name must contain 1 to 256 characters.");
    const callsBeforeRename = stats.calls;
    const hitsBeforeRename = stats.cacheHits;
    const missesBeforeRename = stats.cacheMisses;
    const resolved = await resolve(input, accessToken, false);
    const resolutionCalls = stats.calls - callsBeforeRename;
    const oldName = resolved.name;
    if (oldName === newName) {
      return {
        status: "UNCHANGED",
        partId: resolved.partId,
        oldName,
        newName,
        apiCallsBeforeRename: callsBeforeRename,
        apiCallsUsedForResolution: resolutionCalls,
        apiCallsUsedForRename: 0,
        apiCallsUsedForVerification: 0,
        totalApiCallsThisSession: stats.calls,
        cacheHitsDuringOperation: stats.cacheHits - hitsBeforeRename,
        cacheMissesDuringOperation: stats.cacheMisses - missesBeforeRename,
        evidence: [] as ApiRequestEvidence[],
      };
    }

    const endpoint = new URL(
      `/api/v10/metadata/d/${input.documentId}/w/${input.workspaceId}/e/${input.elementId}/p/${encodeURIComponent(resolved.partId)}`,
      options.apiBaseUrl,
    );
    if (input.configuration) endpoint.searchParams.set("configuration", input.configuration);
    const requestBody = {
      jsonType: "metadata-part",
      partId: resolved.partId,
      properties: [{ value: newName, propertyId: "57f3fb8efa3416c06701d60d" }],
    };
    const requested = await requestJson("renamePart", endpoint, accessToken, true, "POST", requestBody);
    if (!requested.evidence.ok) {
      throw new ResolutionError("The Onshape Part rename request failed.", "API_ERROR", [requested.evidence]);
    }
    partsCache.update(contextKey(input), (parts) => {
      const cachedPart = parts.find((part) => part.partId === resolved.partId);
      if (cachedPart) cachedPart.name = newName;
    });
    sampleMemory();
    return {
      status: "RENAMED",
      partId: resolved.partId,
      oldName,
      newName,
      apiCallsBeforeRename: callsBeforeRename,
      apiCallsUsedForResolution: resolutionCalls,
      apiCallsUsedForRename: 1,
      apiCallsUsedForVerification: 0,
      totalApiCallsThisSession: stats.calls,
      cacheHitsDuringOperation: stats.cacheHits - hitsBeforeRename,
      cacheMissesDuringOperation: stats.cacheMisses - missesBeforeRename,
      evidence: [requested.evidence],
    };
  }

  function diagnostics(): SessionDiagnostics {
    sampleMemory();
    return {
      apiCallsThisSession: stats.calls,
      apiCallsByEndpoint: { ...stats.byEndpoint },
      cacheHits: stats.cacheHits,
      cacheMisses: stats.cacheMisses,
      inFlightJoins: stats.inFlightJoins,
      failedRequests: stats.failures,
      averageRequestDurationMs: stats.calls ? stats.totalDurationMs / stats.calls : 0,
      estimatedRemainingQuota: options.annualQuota === undefined ? null : Math.max(0, options.annualQuota - stats.calls),
      quotaEstimateBasis: options.annualQuota === undefined
        ? "Unknown; set ONSHAPE_ANNUAL_QUOTA to show a session-only estimate."
        : "Configured annual quota minus calls made by this process; prior external usage is unknown.",
      currentRssBytes: process.memoryUsage().rss,
      peakObservedRssBytes: stats.peakRss,
      cacheEntries: { parts: partsCache.size, bodydetails: bodyCache.size },
      cachePolicy: { ttlMs, maxPartContexts, maxBodyDetailContexts, maxGeometryIdsPerContext },
    };
  }
  return { resolve, renamePart, diagnostics };
}
