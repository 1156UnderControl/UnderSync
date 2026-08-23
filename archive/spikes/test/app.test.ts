import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp, type SpikeConfig } from "../src/app.js";

const config: SpikeConfig = {
  port: 8000,
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "http://localhost:8000/oauth/callback",
  authorizationUrl: "https://oauth.onshape.com/oauth/authorize",
  tokenUrl: "https://oauth.onshape.com/oauth/token",
  apiBaseUrl: "https://cad.onshape.com",
  apiTestPath: "/api/users/sessioninfo",
};

let server: Server;
let baseUrl: string;

before(async () => {
  server = createApp(config).listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

test("health endpoint identifies the spike", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as { ok: boolean; spike: string };
  assert.equal(body.ok, true);
  assert.equal(body.spike, "onshape-selection");
});

test("panel is served with required UI sections", async () => {
  const response = await fetch(`${baseUrl}/panel`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Onshape context/);
  assert.match(html, /Current selection/);
  assert.match(html, /Event log/);
  assert.match(html, /Test Onshape API/);
  assert.match(html, /Resolve Selected Body/);
  assert.match(html, /Copy Raw API Evidence/);
  assert.match(html, /API budget and memory/);
  assert.match(html, /Rename selected Part/);
  assert.doesNotMatch(html, /Translate ID to Current Workspace/);
});

test("rename route requires server-side authentication", async () => {
  const response = await fetch(`${baseUrl}/api/onshape/rename-part`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentId: "adc5d879e22ce46bcfa595d0",
      workspaceId: "3358632a4ca58e6a9214f838",
      elementId: "12e78a49aa41929453188533",
      microversionId: "ca497703a732ba476f374ed9",
      selectionId: "RoMD",
      selectionType: "BODY",
      newName: "Part 1 | UDS-TEST",
    }),
  });
  assert.equal(response.status, 401);
  assert.match(await response.text(), /Authenticate first/);
});

test("diagnostics start without making an Onshape API call", async () => {
  const response = await fetch(`${baseUrl}/api/onshape/diagnostics`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as { apiCallsThisSession: number; cacheHits: number; failedRequests: number };
  assert.equal(body.apiCallsThisSession, 0);
  assert.equal(body.cacheHits, 0);
  assert.equal(body.failedRequests, 0);
});

test("selection resolver requires server-side authentication", async () => {
  const response = await fetch(`${baseUrl}/api/onshape/resolve-selection`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentId: "adc5d879e22ce46bcfa595d0",
      workspaceId: "3358632a4ca58e6a9214f838",
      elementId: "12e78a49aa41929453188533",
      microversionId: "ca497703a732ba476f374ed9",
      selectionId: "RoMD",
      selectionType: "BODY",
    }),
  });
  assert.equal(response.status, 401);
  assert.match(await response.text(), /Authenticate first/);
});

test("OAuth login constructs the official authorization redirect without exposing the secret", async () => {
  const response = await fetch(`${baseUrl}/oauth/login`, { redirect: "manual" });
  assert.equal(response.status, 302);
  const location = response.headers.get("location");
  assert.ok(location);
  const target = new URL(location);
  assert.equal(target.origin + target.pathname, config.authorizationUrl);
  assert.equal(target.searchParams.get("response_type"), "code");
  assert.equal(target.searchParams.get("client_id"), config.clientId);
  assert.equal(target.searchParams.get("redirect_uri"), config.redirectUri);
  assert.ok(target.searchParams.get("state"));
  assert.equal(location.includes(config.clientSecret ?? ""), false);
});

test("OAuth callback rejects an unknown state before any token request", async () => {
  const response = await fetch(`${baseUrl}/oauth/callback?code=fake&state=unknown`);
  assert.equal(response.status, 400);
  assert.match(await response.text(), /invalid\/expired OAuth state/);
});

test("API test reports that authentication is required when no token exists", async () => {
  const response = await fetch(`${baseUrl}/api/onshape/test`, { method: "POST" });
  assert.equal(response.status, 401);
  const body = (await response.json()) as { ok: boolean; endpoint: string; error: string };
  assert.equal(body.ok, false);
  assert.equal(body.endpoint, "https://cad.onshape.com/api/users/sessioninfo");
  assert.match(body.error, /Authenticate first/);
});
