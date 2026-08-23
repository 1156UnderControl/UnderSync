import crypto from "node:crypto";
import path from "node:path";
import express, { type Express, type Request, type Response } from "express";
import {
  createOnshapeResolver,
  ResolutionError,
  validateSelectionInput,
} from "./onshape-resolution.js";

const publicDirectory = path.resolve(process.cwd(), "public");

export interface SpikeConfig {
  port: number;
  clientId?: string;
  clientSecret?: string;
  redirectUri: string;
  authorizationUrl: string;
  tokenUrl: string;
  apiBaseUrl: string;
  apiTestPath: string;
  annualQuota?: number;
}

interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresAt?: number;
  receivedAt: string;
}

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  [key: string]: unknown;
}

export interface SpikeState {
  pendingOAuthStates: Map<string, number>;
  token?: TokenSet;
  lastOAuthError?: string;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): SpikeConfig {
  const parsedPort = Number.parseInt(environment.PORT ?? "8000", 10);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  const apiTestPath = environment.ONSHAPE_API_TEST_PATH ?? "/api/users/sessioninfo";
  if (!apiTestPath.startsWith("/api/")) {
    throw new Error("ONSHAPE_API_TEST_PATH must start with /api/.");
  }

  const annualQuota = environment.ONSHAPE_ANNUAL_QUOTA
    ? Number.parseInt(environment.ONSHAPE_ANNUAL_QUOTA, 10)
    : undefined;
  if (annualQuota !== undefined && (!Number.isInteger(annualQuota) || annualQuota < 1)) {
    throw new Error("ONSHAPE_ANNUAL_QUOTA must be a positive integer when set.");
  }

  return {
    port: parsedPort,
    clientId: environment.ONSHAPE_CLIENT_ID,
    clientSecret: environment.ONSHAPE_CLIENT_SECRET,
    redirectUri: environment.ONSHAPE_REDIRECT_URI ?? "http://localhost:8000/oauth/callback",
    authorizationUrl:
      environment.ONSHAPE_AUTHORIZATION_URL ?? "https://oauth.onshape.com/oauth/authorize",
    tokenUrl: environment.ONSHAPE_TOKEN_URL ?? "https://oauth.onshape.com/oauth/token",
    apiBaseUrl: environment.ONSHAPE_API_BASE_URL ?? "https://cad.onshape.com",
    apiTestPath,
    annualQuota,
  };
}

function requireOAuthConfig(config: SpikeConfig): asserts config is SpikeConfig & {
  clientId: string;
  clientSecret: string;
} {
  if (!config.clientId || !config.clientSecret) {
    throw new Error(
      "OAuth is not configured. Set ONSHAPE_CLIENT_ID and ONSHAPE_CLIENT_SECRET in the environment.",
    );
  }
}

function pruneOAuthStates(state: SpikeState): void {
  const oldestAllowed = Date.now() - 10 * 60 * 1000;
  for (const [key, createdAt] of state.pendingOAuthStates) {
    if (createdAt < oldestAllowed) state.pendingOAuthStates.delete(key);
  }
}

function parseTokenResponse(payload: TokenResponse): TokenSet {
  if (typeof payload.access_token !== "string" || payload.access_token.length === 0) {
    throw new Error("Onshape token response did not contain an access_token.");
  }

  const expiresIn =
    typeof payload.expires_in === "number"
      ? payload.expires_in
      : typeof payload.expires_in === "string"
        ? Number.parseInt(payload.expires_in, 10)
        : undefined;

  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : undefined,
    tokenType: typeof payload.token_type === "string" ? payload.token_type : undefined,
    expiresAt: Number.isFinite(expiresIn) ? Date.now() + Number(expiresIn) * 1000 : undefined,
    receivedAt: new Date().toISOString(),
  };
}

async function requestToken(config: SpikeConfig, parameters: URLSearchParams): Promise<TokenSet> {
  requireOAuthConfig(config);
  parameters.set("client_id", config.clientId);
  parameters.set("client_secret", config.clientSecret);

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: parameters,
  });
  const responseText = await response.text();

  let payload: TokenResponse;
  try {
    payload = JSON.parse(responseText) as TokenResponse;
  } catch {
    throw new Error(`Token endpoint returned HTTP ${response.status} with a non-JSON response.`);
  }

  if (!response.ok) {
    const description = payload.error_description ?? payload.error ?? "Token exchange failed";
    throw new Error(`Token endpoint returned HTTP ${response.status}: ${String(description)}`);
  }

  return parseTokenResponse(payload);
}

async function getUsableToken(config: SpikeConfig, state: SpikeState): Promise<TokenSet> {
  if (!state.token) throw new Error("No local OAuth token is available. Authenticate first.");

  const expiresSoon = state.token.expiresAt !== undefined && state.token.expiresAt <= Date.now() + 60_000;
  if (!expiresSoon) return state.token;
  if (!state.token.refreshToken) throw new Error("The local access token expired and has no refresh token.");

  const refreshed = await requestToken(
    config,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: state.token.refreshToken,
    }),
  );
  state.token = refreshed;
  return refreshed;
}

function sendOAuthResultPage(response: Response, successful: boolean, message: string): void {
  response.status(successful ? 200 : 400).type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>UnderSync OAuth result</title><link rel="stylesheet" href="/styles.css"></head>
<body><main class="page"><section class="card"><h1>Onshape OAuth</h1>
<p class="status ${successful ? "ok" : "error"}">${successful ? "Authentication succeeded." : "Authentication failed."}</p>
<pre>${escapeHtml(message)}</pre><p><a class="button-link" href="/">Return to spike status</a></p>
</section></main></body></html>`);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function createApp(config: SpikeConfig, state: SpikeState = { pendingOAuthStates: new Map() }): Express {
  const app = express();
  const resolver = createOnshapeResolver({ apiBaseUrl: config.apiBaseUrl, annualQuota: config.annualQuota });
  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "32kb" }));
  app.use(express.static(publicDirectory));

  app.get("/health", (_request, response) => {
    response.json({ ok: true, spike: "onshape-selection", time: new Date().toISOString() });
  });

  app.get("/panel", (_request, response) => {
    response.sendFile(path.join(publicDirectory, "panel.html"));
  });

  app.get("/api/auth/status", (_request, response) => {
    response.json({
      oauthConfigured: Boolean(config.clientId && config.clientSecret),
      authenticated: Boolean(state.token),
      tokenReceivedAt: state.token?.receivedAt ?? null,
      expiresAt: state.token?.expiresAt ? new Date(state.token.expiresAt).toISOString() : null,
      lastError: state.lastOAuthError ?? null,
      apiBaseUrl: config.apiBaseUrl,
    });
  });

  app.get("/oauth/login", (_request, response) => {
    try {
      requireOAuthConfig(config);
      pruneOAuthStates(state);
      const oauthState = crypto.randomBytes(24).toString("base64url");
      state.pendingOAuthStates.set(oauthState, Date.now());
      const authorizationUrl = new URL(config.authorizationUrl);
      authorizationUrl.searchParams.set("response_type", "code");
      authorizationUrl.searchParams.set("client_id", config.clientId);
      authorizationUrl.searchParams.set("redirect_uri", config.redirectUri);
      authorizationUrl.searchParams.set("state", oauthState);
      response.redirect(authorizationUrl.toString());
    } catch (error) {
      state.lastOAuthError = error instanceof Error ? error.message : String(error);
      sendOAuthResultPage(response, false, state.lastOAuthError);
    }
  });

  app.get("/oauth/callback", async (request: Request, response: Response) => {
    const oauthError = typeof request.query.error === "string" ? request.query.error : undefined;
    const errorDescription =
      typeof request.query.error_description === "string" ? request.query.error_description : undefined;
    if (oauthError) {
      state.lastOAuthError = `${oauthError}${errorDescription ? `: ${errorDescription}` : ""}`;
      sendOAuthResultPage(response, false, state.lastOAuthError);
      return;
    }

    const code = typeof request.query.code === "string" ? request.query.code : undefined;
    const returnedState = typeof request.query.state === "string" ? request.query.state : undefined;
    pruneOAuthStates(state);

    if (!code || !returnedState || !state.pendingOAuthStates.delete(returnedState)) {
      state.lastOAuthError = "Missing authorization code or invalid/expired OAuth state.";
      sendOAuthResultPage(response, false, state.lastOAuthError);
      return;
    }

    try {
      state.token = await requestToken(
        config,
        new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: config.redirectUri,
        }),
      );
      state.lastOAuthError = undefined;
      sendOAuthResultPage(response, true, "The access token is held only in this Node process memory.");
    } catch (error) {
      state.lastOAuthError = error instanceof Error ? error.message : String(error);
      sendOAuthResultPage(response, false, state.lastOAuthError);
    }
  });

  app.post("/api/onshape/test", async (_request, response) => {
    const endpoint = new URL(config.apiTestPath, config.apiBaseUrl).toString();
    try {
      const token = await getUsableToken(config, state);
      const apiResponse = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          Accept: "application/json;charset=UTF-8",
        },
        redirect: "follow",
      });
      const responseText = await apiResponse.text();
      let body: unknown = responseText;
      try {
        body = JSON.parse(responseText);
      } catch {
        // Preserve unexpected non-JSON text as evidence without exposing the OAuth token.
      }
      response.status(apiResponse.ok ? 200 : 502).json({
        ok: apiResponse.ok,
        httpStatus: apiResponse.status,
        endpoint,
        response: body,
      });
    } catch (error) {
      response.status(401).json({
        ok: false,
        httpStatus: null,
        endpoint,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/api/onshape/resolve-selection", async (request, response) => {
    try {
      const input = validateSelectionInput(request.body);
      const token = await getUsableToken(config, state);
      const result = await resolver.resolve(input, token.accessToken, request.body?.diagnostic === true);
      response.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof ResolutionError) {
        response.status(error.kind === "API_ERROR" ? 502 : 404).json({
          status: error.kind,
          error: message,
          ...(request.body?.diagnostic === true ? { diagnostic: { requests: error.evidence } } : {}),
        });
        return;
      }
      response.status(message.includes("Authenticate first") ? 401 : 400).json({ status: "ERROR", error: message });
    }
  });

  app.get("/api/onshape/diagnostics", (_request, response) => {
    response.json(resolver.diagnostics());
  });

  app.post("/api/onshape/rename-part", async (request, response) => {
    try {
      const input = validateSelectionInput(request.body);
      if (typeof request.body?.newName !== "string") throw new Error("newName is required.");
      const token = await getUsableToken(config, state);
      response.json(await resolver.renamePart(input, token.accessToken, request.body.newName));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof ResolutionError) {
        response.status(error.kind === "API_ERROR" ? 502 : 404).json({
          status: error.kind,
          error: message,
          evidence: error.evidence,
        });
        return;
      }
      response.status(message.includes("Authenticate first") ? 401 : 400).json({ status: "ERROR", error: message });
    }
  });

  return app;
}
