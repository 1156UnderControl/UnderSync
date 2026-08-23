import assert from "node:assert/strict";
import test from "node:test";
import {
  createOnshapeResolver,
  ResolutionError,
  validateSelectionInput,
  type SelectionResolutionInput,
} from "../src/onshape-resolution.js";

const bodyInput: SelectionResolutionInput = {
  documentId: "adc5d879e22ce46bcfa595d0",
  workspaceId: "3358632a4ca58e6a9214f838",
  elementId: "12e78a49aa41929453188533",
  microversionId: "ca497703a732ba476f374ed9",
  selectionId: "RoMD",
  selectionType: "BODY",
};

function fixtureFetch(counter: { calls: number }, delayMs = 0): typeof fetch {
  return (async (request: string | URL | Request) => {
    counter.calls += 1;
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const url = String(request);
    const body = url.includes("/bodydetails")
      ? { bodies: { RoMD: { partId: "RoMD", faces: [{ id: "RVUe" }], edges: [{ id: "EDGE-1" }] } } }
      : [
          { partId: "RoMD", name: "Camera mount", partNumber: "1156-001" },
          { partId: "SECOND", name: "Second part", partNumber: null },
        ];
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

test("BODY resolution uses one Parts call, returns its part number, and then stays cached", async () => {
  const counter = { calls: 0 };
  const resolver = createOnshapeResolver({ apiBaseUrl: "https://cad.onshape.com", fetchImpl: fixtureFetch(counter) });
  const first = await resolver.resolve(bodyInput, "server-only");
  assert.equal(first.partId, "RoMD");
  assert.equal(first.name, "Camera mount");
  assert.equal(first.partNumber, "1156-001");
  assert.equal(counter.calls, 1);
  assert.equal("diagnostic" in first, false);

  const repeated = await resolver.resolve(bodyInput, "server-only");
  assert.equal(repeated.partId, "RoMD");
  assert.equal(counter.calls, 1);

  const differentBody = await resolver.resolve({ ...bodyInput, selectionId: "SECOND" }, "server-only");
  assert.equal(differentBody.name, "Second part");
  assert.equal(counter.calls, 1);
  assert.equal(resolver.diagnostics().cacheHits, 2);
});

test("FACE and EDGE ownership share one normalized body-details cache", async () => {
  const counter = { calls: 0 };
  const resolver = createOnshapeResolver({ apiBaseUrl: "https://cad.onshape.com", fetchImpl: fixtureFetch(counter) });
  const face = await resolver.resolve({ ...bodyInput, selectionId: "RVUe", selectionType: "ENTITY", entityType: "FACE" }, "server-only");
  assert.equal(face.partId, "RoMD");
  assert.equal(counter.calls, 2);

  const edge = await resolver.resolve({ ...bodyInput, selectionId: "EDGE-1", selectionType: "ENTITY", entityType: "EDGE" }, "server-only");
  assert.equal(edge.partId, "RoMD");
  assert.equal(counter.calls, 2);
  assert.deepEqual(resolver.diagnostics().apiCallsByEndpoint, { parts: 1, bodydetails: 1 });
});

test("simultaneous identical BODY resolutions join one in-flight request", async () => {
  const counter = { calls: 0 };
  const resolver = createOnshapeResolver({ apiBaseUrl: "https://cad.onshape.com", fetchImpl: fixtureFetch(counter, 20) });
  const [first, second] = await Promise.all([
    resolver.resolve(bodyInput, "server-only"),
    resolver.resolve(bodyInput, "server-only"),
  ]);
  assert.equal(first.partId, second.partId);
  assert.equal(counter.calls, 1);
  assert.equal(resolver.diagnostics().inFlightJoins, 1);
});

test("diagnostic mode includes raw response evidence only for a cache miss", async () => {
  const counter = { calls: 0 };
  const resolver = createOnshapeResolver({ apiBaseUrl: "https://cad.onshape.com", fetchImpl: fixtureFetch(counter) });
  const result = await resolver.resolve(bodyInput, "server-only", true);
  assert.ok("diagnostic" in result);
  if ("diagnostic" in result) {
    assert.equal(result.diagnostic.requests.length, 1);
    assert.equal(result.diagnostic.requests[0].httpStatus, 200);
    assert.ok(result.diagnostic.requests[0].response);
  }
});

test("does not fall back to matching a name", async () => {
  const resolver = createOnshapeResolver({ apiBaseUrl: "https://cad.onshape.com", fetchImpl: fixtureFetch({ calls: 0 }) });
  await assert.rejects(
    resolver.resolve({ ...bodyInput, selectionId: "Camera mount" }, "server-only"),
    (error) => error instanceof ResolutionError && error.kind === "NOT_FOUND",
  );
});

test("omits an unresolved Onshape configuration action parameter", () => {
  const input = validateSelectionInput({ ...bodyInput, configuration: "{$configuration}" });
  assert.equal(input.configuration, undefined);
});

test("renames a cached Part with one metadata POST, no verification read, and updates cache", async () => {
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  const fetchImpl = (async (request: string | URL | Request, init?: RequestInit) => {
    const url = String(request);
    const method = init?.method ?? "GET";
    const requestBody = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    requests.push({ url, method, body: requestBody });
    const responseBody = method === "POST"
      ? { changed: true }
      : [{ partId: "RoMD", name: "Part 1", partNumber: null }];
    return new Response(JSON.stringify(responseBody), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const resolver = createOnshapeResolver({ apiBaseUrl: "https://cad.onshape.com", fetchImpl });

  await resolver.resolve(bodyInput, "server-only");
  const renamed = await resolver.renamePart(bodyInput, "server-only", "Part 1 | UDS-TEST");
  assert.equal(renamed.status, "RENAMED");
  assert.equal(renamed.apiCallsUsedForResolution, 0);
  assert.equal(renamed.apiCallsUsedForRename, 1);
  assert.equal(renamed.apiCallsUsedForVerification, 0);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].method, "POST");
  assert.match(requests[1].url, /\/api\/v10\/metadata\/d\/.+\/w\/.+\/e\/.+\/p\/RoMD$/);
  assert.deepEqual(requests[1].body, {
    jsonType: "metadata-part",
    partId: "RoMD",
    properties: [{ value: "Part 1 | UDS-TEST", propertyId: "57f3fb8efa3416c06701d60d" }],
  });

  const cached = await resolver.resolve(bodyInput, "server-only");
  assert.equal(cached.name, "Part 1 | UDS-TEST");
  assert.equal(requests.length, 2);
});

test("skips the write when the requested Part name is unchanged", async () => {
  const counter = { calls: 0 };
  const resolver = createOnshapeResolver({ apiBaseUrl: "https://cad.onshape.com", fetchImpl: fixtureFetch(counter) });
  await resolver.resolve(bodyInput, "server-only");
  const result = await resolver.renamePart(bodyInput, "server-only", "Camera mount");
  assert.equal(result.status, "UNCHANGED");
  assert.equal(result.apiCallsUsedForRename, 0);
  assert.equal(counter.calls, 1);
});
