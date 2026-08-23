# UnderSync Onshape Part Resolution Spike

## Result

**PASS — minimum-call BODY, FACE, EDGE, caching, and memory behavior are proven live.**

The original live BODY experiment proved that a Right Panel BODY selection resolves to a Part ID and name. The resolver has now been reduced from three automatic API calls to one for a first BODY lookup and zero for repeated BODY lookups in the same immutable context. Metadata and ID translation are no longer called automatically.

## Proven live input and result

- Document: `adc5d879e22ce46bcfa595d0`
- Workspace: `3358632a4ca58e6a9214f838`
- Element: `12e78a49aa41929453188533`
- Microversion: `ca497703a732ba476f374ed9`
- Selection ID / resolved Part ID: `RdDD`
- Selection type: `BODY`
- Name: `Part 1`
- Part number: `null` (not assigned in Onshape)

The optimized rerun resolved this BODY with one Parts call. A repeated selection required zero calls.

Additional live results from the same cached context:

- Different BODY `RoMD` resolved to Part ID `RoMD`, name `Part 31`, with zero additional calls.
- FACE `RVUe` resolved to owning Part ID `R2ND`, name `Part 38`, using one body-details call because the Parts list was already cached.
- Repeating FACE `RVUe` required zero additional calls.
- EDGE `RCON` resolved to owning Part ID `RdDD`, name `Part 1`, using zero additional calls from the warm Parts and ownership caches.

## Minimum resolution chains

### BODY

```text
SELECTION
  -> cached Parts list for server/document/workspace/element/microversion/configuration
  -> on cache miss: GET Parts once
  -> exact selectionId == returned partId
  -> return partId, name, and partNumber from that same response
  -> stop
```

### FACE / EDGE

```text
SELECTION
  -> cached Parts list (GET once only when missing)
  -> cached normalized body-ownership index
  -> on ownership-cache miss: GET body details once, build bounded ID -> Part ID index, discard raw body
  -> exact selected geometry ID -> one owning Part ID -> cached Part name/number
  -> stop
```

No name, display-name, feature-name, index, or ordering fallback exists.

## Normal and diagnostic modes

Normal mode returns only:

```json
{
  "partId": "...",
  "name": "...",
  "partNumber": null,
  "documentId": "...",
  "workspaceId": "...",
  "elementId": "...",
  "microversionId": "...",
  "selectionId": "...",
  "selectionType": "BODY"
}
```

Diagnostic mode is opt-in per user action and adds request URLs, HTTP statuses, durations, response bodies, and cache outcomes. Normal mode does not retain raw remote bodies. The browser retains only the latest resolution response and a maximum of 200 selection-log entries.

## API endpoints and necessity

### Parts list — required for identity and name

- Method: `GET`
- Endpoint: `/api/v9/parts/d/{did}/m/{mid}/e/{eid}`
- Query: `withThumbnails=false`, `includePropertyDefaults=false`, and configuration only when actually supplied
- Fields retained: `partId`, `name`, `partNumber`
- Cost: one call per uncached immutable context; zero for later BODY selections in that context
- Part number: already included, so no extra request is justified. The live response returned `null` because the property was not assigned.

### Part Studio body details — required only for FACE/EDGE ownership

- Method: `GET`
- Endpoint: `/api/v9/partstudios/d/{did}/m/{mid}/e/{eid}/bodydetails`
- Cost: one call per uncached immutable context when a non-BODY ownership lookup is requested
- Storage: raw response is discarded after building a bounded ownership index; raw evidence is returned transiently only in diagnostic mode

### Metadata — removed from automatic resolution

Metadata is not necessary to identify a Part. Obtaining it would cost one additional API call per uncached Part and requires explicit future approval.

### ID translation — deferred

Microversion translation is not part of this optimized resolver and no translation route/button is active.

Official sources: [Part Studio APIs](https://onshape-public.github.io/docs/api-adv/partstudios/), [Parts-list example](https://onshape-public.github.io/docs/api-adv/assemblies/), and [extension parameters](https://onshape-public.github.io/docs/app-dev/extensions/#action-url-parameters).

## Cache and deduplication policy

Cache key:

```text
server + documentId + workspaceId + elementId + microversionId + configuration
```

- TTL: 15 minutes
- Parts contexts: maximum 32, LRU
- Body-detail ownership contexts: maximum 4, LRU
- Geometry IDs per ownership context: maximum 20,000
- Failed responses are not cached
- Concurrent identical misses await one shared in-flight request
- Raw API responses are never stored in the caches

## API diagnostics

The panel exposes local, non-polling diagnostics:

- API calls this process session
- calls grouped by endpoint
- cache hits and misses
- in-flight joins
- failed requests
- average request duration
- current and peak-observed RSS
- cache entry counts/policy
- estimated remaining quota when `ONSHAPE_ANNUAL_QUOTA` is configured

The quota estimate is explicitly session-only: configured annual quota minus calls made by this process. It cannot know usage made before the process started.

## Automated call-count evidence

All automated scenarios pass:

| Scenario | Onshape calls |
|---|---:|
| First BODY in context | 1 Parts call |
| Same BODY again | 0 |
| Different BODY, same context | 0 |
| First FACE in cold context | 2 total: Parts + body details |
| EDGE after FACE, same context | 0 |
| Two simultaneous identical BODY requests | 1 shared Parts call |

Automated suite: **17 passed, 0 failed**.

## Optimized live call-count evidence

| Scenario | Additional Onshape calls | Result |
|---|---:|---|
| First BODY `RdDD` | 1 Parts | `RdDD`, `Part 1` |
| Same BODY `RdDD` again | 0 | Cache hit |
| Different BODY `RoMD`, same context | 0 | `RoMD`, `Part 31` |
| FACE `RVUe` with Parts cached | 1 body details | Owner `R2ND`, `Part 38` |
| Same FACE `RVUe` again | 0 | Parts and ownership cache hits |
| EDGE `RCON` after FACE, same context | 0 | Owner `RdDD`, `Part 1` |

Final session diagnostics: 2 total remote calls (`parts: 1`, `bodydetails: 1`), 13 cache hits, 2 cache misses, 0 failed requests, and an 86.7% resource-cache hit rate. The average remote request duration was approximately 1,962.6 ms; the body-details call took approximately 3,052.5 ms. The additional cache hits include the user's panel repetitions during the live test.

## Memory behavior

The restarted optimized server began at approximately **55.4 MB RSS** with empty caches. Immediately before the first authenticated BODY test it was approximately **65.8 MB RSS**. After BODY caching it was approximately **67.1 MB RSS**. Building the normalized ownership index from the live body-details response produced a peak-observed RSS of approximately **128.2 MB**. At the end of BODY/FACE/EDGE testing, RSS had settled to approximately **66.9 MB**, showing that the large raw body-details payload was not retained.

Memory is bounded by cache context counts, geometry-index size, TTL, and the 200-entry browser event log. Parts responses are normalized to three fields. Body-details responses are converted to a compact ownership index and then released. Diagnostic response bodies are transient and are not inserted into caches.

## Live validation outcome

All requested selection cases are complete. EDGE `RCON` resolved to Part `RdDD` / `Part 1` without increasing the remote-call count. No polling or background Onshape requests occurred.

## Durable identity

`selectionId` alone remains insufficient as a durable external identity. Future design should preserve server, document, workspace/version context, element, configuration, captured microversion, and the geometry/Part ID observed at that immutable context. Translation/change detection remains deliberately outside this task.

## Conclusion

1. A Right Panel BODY selection can identify an Onshape Part.
2. A BODY requires one Parts-list call on a cold immutable context and zero calls thereafter until eviction/expiry.
3. Part ID, name, and Part number are all available in the Parts response; a missing Part number is represented by `null` without another request.
4. FACE and EDGE ownership are proven live. The first ownership lookup required one body-details call; subsequent FACE/EDGE selections used the normalized cache with zero remote calls.
5. Metadata is not necessary for Part identification and is no longer fetched.
6. No polling, translation, fingerprinting, webhook reconciliation, or Spike 3 work was added.
