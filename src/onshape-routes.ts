import type { Express, Request, Response } from "express";
import type { AppConfig, AppDependencies } from "./app.js";
import { loadAuthContext, validAuthenticatedCsrf } from "./auth.js";
import type { DatabasePool } from "./db.js";
import { encryptIntegrationSecret } from "./integration-crypto.js";
import {
  exchangeOnshapeToken, fetchOnshapeProfile, onshapeConfigured, parseSelectionInput,
  renameOnshapePart, resolveOnshapePart, trackedOnshapeName, usableOnshapeAccessToken,
  type ResolvedPart,
} from "./onshape.js";
import { errorPage, oauthResultPage, panelLoginRequiredPage, partsTrackingPanelPage } from "./pages.js";
import { CSRF_COOKIE, ensureCsrfCookie, hashToken, parseCookies, randomToken } from "./security.js";
import { loadPartsTrackingFormSettings } from "./parts-tracking-config.js";

type FetchLike = typeof fetch;

export function registerOnshapeRoutes(app: Express, config: AppConfig, database: DatabasePool, dependencies: AppDependencies): void {
  const onshape = config.onshape;
  const fetchImpl: FetchLike = dependencies.fetchImpl ?? fetch;

  app.get("/integrations/onshape/connect", async (request, response) => {
    const context = await loadAuthContext(database, request);
    if (!context) return response.redirect(`/login?return_to=${encodeURIComponent(request.originalUrl)}`);
    if (!onshapeConfigured(onshape)) return response.status(503).send(errorPage("Onshape is not configured", "Set the Onshape OAuth variables and INTEGRATION_ENCRYPTION_KEY, then restart UnderSync.", 503, context.user));
    const connection = await database.query("SELECT id FROM integration_connections WHERE provider = 'ONSHAPE' AND key = 'default'");
    if (connection.rowCount !== 1) return response.status(503).send(errorPage("Onshape connection missing", "Run the database seed to create the default Onshape connection.", 503, context.user));
    const state = randomToken();
    await database.query("DELETE FROM oauth_authorization_states WHERE expires_at < CURRENT_TIMESTAMP OR consumed_at IS NOT NULL");
    await database.query(
      `INSERT INTO oauth_authorization_states (user_id, connection_id, state_hash, return_to, expires_at)
       VALUES ($1, $2, $3, '/account', CURRENT_TIMESTAMP + INTERVAL '10 minutes')`,
      [context.user.id, connection.rows[0].id, hashToken(state)],
    );
    const url = new URL(onshape.authorizationUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", onshape.clientId);
    url.searchParams.set("redirect_uri", onshape.redirectUri);
    url.searchParams.set("state", state);
    response.redirect(url.toString());
  });

  const oauthCallback = async (request: Request, response: Response) => {
    const context = await loadAuthContext(database, request);
    if (!context) return response.status(401).send(oauthResultPage(false, "Log in to UnderSync again, then restart the Onshape link."));
    const state = typeof request.query.state === "string" ? request.query.state : "";
    const code = typeof request.query.code === "string" ? request.query.code : "";
    const denied = typeof request.query.error === "string" ? request.query.error : "";
    if (denied) return response.status(400).send(oauthResultPage(false, `Onshape authorization was not granted: ${denied}.`, context.user));
    if (!state || !code) return response.status(400).send(oauthResultPage(false, "The callback did not include a valid authorization code and state.", context.user));
    const consumed = await database.query(
      `UPDATE oauth_authorization_states SET consumed_at = CURRENT_TIMESTAMP
        WHERE state_hash = $1 AND user_id = $2 AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP
        RETURNING connection_id, return_to`,
      [hashToken(state), context.user.id],
    );
    if (consumed.rowCount !== 1) return response.status(400).send(oauthResultPage(false, "This authorization attempt expired or was already used. Start again from Account.", context.user));
    try {
      const token = await exchangeOnshapeToken(onshape, { grant_type: "authorization_code", code, redirect_uri: onshape.redirectUri }, fetchImpl);
      const profile = await fetchOnshapeProfile(onshape, token.access_token, fetchImpl);
      const expiresAt = new Date(Date.now() + Math.max(60, token.expires_in ?? 3600) * 1000);
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        const existingOwner = await client.query("SELECT user_id FROM external_identities WHERE connection_id = $1 AND external_user_id = $2", [consumed.rows[0].connection_id, profile.externalUserId]);
        if (existingOwner.rowCount && existingOwner.rows[0].user_id !== context.user.id) throw new Error("That Onshape account is already linked to another UnderSync user.");
        const identity = await client.query(
          `INSERT INTO external_identities (user_id, connection_id, external_user_id, external_display_name, external_email, status, metadata, verified_at)
           VALUES ($1, $2, $3, $4, $5, 'VERIFIED', $6::jsonb, CURRENT_TIMESTAMP)
           ON CONFLICT (connection_id, user_id) DO UPDATE SET external_user_id = EXCLUDED.external_user_id,
             external_display_name = EXCLUDED.external_display_name, external_email = EXCLUDED.external_email,
             status = 'VERIFIED', metadata = EXCLUDED.metadata, verified_at = CURRENT_TIMESTAMP
           RETURNING id`,
          [context.user.id, consumed.rows[0].connection_id, profile.externalUserId, profile.displayName ?? null, profile.email ?? null, JSON.stringify(profile.metadata)],
        );
        await client.query(
          `INSERT INTO onshape_oauth_grants (external_identity_id, access_token_encrypted, refresh_token_encrypted, token_type, scope, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (external_identity_id) DO UPDATE SET access_token_encrypted = EXCLUDED.access_token_encrypted,
             refresh_token_encrypted = COALESCE(EXCLUDED.refresh_token_encrypted, onshape_oauth_grants.refresh_token_encrypted),
             token_type = EXCLUDED.token_type, scope = EXCLUDED.scope, expires_at = EXCLUDED.expires_at`,
          [identity.rows[0].id, encryptIntegrationSecret(token.access_token, onshape.encryptionKey), token.refresh_token ? encryptIntegrationSecret(token.refresh_token, onshape.encryptionKey) : null, token.token_type ?? "Bearer", token.scope ?? null, expiresAt],
        );
        await client.query("UPDATE integration_connections SET status = 'ACTIVE' WHERE id = $1", [consumed.rows[0].connection_id]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
      response.send(oauthResultPage(true, `Linked Onshape account ${profile.displayName ?? profile.email ?? profile.externalUserId}.`, context.user));
    } catch (error) {
      response.status(502).send(oauthResultPage(false, errorMessage(error), context.user));
    }
  };
  app.get("/integrations/onshape/callback", oauthCallback);
  app.get("/oauth/callback", oauthCallback);

  app.post("/integrations/onshape/disconnect", async (request, response) => {
    const context = await loadAuthContext(database, request);
    if (!context) return response.redirect("/login");
    if (!await validAuthenticatedCsrf(database, request, context)) return response.status(403).send(errorPage("Forbidden", "The form expired. Please try again.", 403, context.user));
    await database.query(
      `UPDATE external_identities e SET status = 'REVOKED'
        FROM integration_connections c WHERE e.connection_id = c.id AND c.provider = 'ONSHAPE' AND e.user_id = $1`,
      [context.user.id],
    );
    await database.query(
      `DELETE FROM onshape_oauth_grants g USING external_identities e, integration_connections c
        WHERE g.external_identity_id = e.id AND e.connection_id = c.id AND c.provider = 'ONSHAPE' AND e.user_id = $1`,
      [context.user.id],
    );
    response.redirect("/account");
  });

  app.get(["/parts-tracking", "/onshape/panel"], async (request, response) => {
    const context = await loadAuthContext(database, request);
    if (!context && request.path === "/onshape/panel") {
      return response.status(401).send(panelLoginRequiredPage(`/login?return_to=${encodeURIComponent("/parts-tracking")}`));
    }
    if (!context) return response.redirect(`/login?return_to=${encodeURIComponent(request.originalUrl)}`);
    const existingCsrf = parseCookies(request)[CSRF_COOKIE];
    const csrf = existingCsrf ?? ensureCsrfCookie(request, response, config.cookieSecure);
    if (!existingCsrf) await database.query("UPDATE sessions SET csrf_token_hash = $1 WHERE id = $2", [hashToken(csrf), context.sessionId]);
    const options = await loadFormOptions(database);
    response.send(partsTrackingPanelPage(context.user, csrf, options));
  });

  app.get("/api/parts-tracking/options", async (request, response) => {
    const context = await loadAuthContext(database, request);
    if (!context) return response.status(401).json({ error: "Log in to UnderSync." });
    response.json(await loadFormOptions(database));
  });

  app.post("/api/onshape/selection/resolve", async (request, response) => {
    const context = await loadAuthContext(database, request);
    if (!context) return response.status(401).json({ error: "Log in to UnderSync." });
    try {
      const token = await usableOnshapeAccessToken(database, context.user.id, onshape, fetchImpl);
      response.json(await resolveOnshapePart(onshape, parseSelectionInput(request.body), token, fetchImpl));
    } catch (error) { response.status(400).json({ error: errorMessage(error) }); }
  });

  app.post("/api/parts-tracking/register", async (request, response) => {
    const context = await loadAuthContext(database, request);
    if (!context) return response.status(401).json({ error: "Log in to UnderSync." });
    if (!await validAuthenticatedCsrf(database, request, context)) return response.status(403).json({ error: "The form expired. Reload the panel." });
    try {
      const input = parseSelectionInput(request.body.selection);
      const name = cleanText(request.body.name, 2, 160, "Name");
      const quantity = Number(request.body.quantity);
      const subsystemId = uuid(request.body.subsystemId, "subsystem");
      const designerId = uuid(request.body.designerId, "designer");
      const methodId = uuid(request.body.methodId, "fabrication method");
      const materialId = uuid(request.body.materialId, "material");
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10_000) throw new Error("Quantity must be a whole number from 1 to 10,000.");
      const token = await usableOnshapeAccessToken(database, context.user.id, onshape, fetchImpl);
      const resolved = await resolveOnshapePart(onshape, input, token, fetchImpl);
      const registered = await registerPart(database, resolved, { name, quantity, subsystemId, designerId, methodId, materialId });
      const onshapeName = trackedOnshapeName(name, registered.trackingCode);
      try {
        await renameOnshapePart(onshape, resolved, onshapeName, token, fetchImpl);
        await database.query("UPDATE cad_references SET onshape_name_after = $1, rename_status = 'SUCCEEDED', rename_error = NULL WHERE id = $2", [onshapeName, registered.cadReferenceId]);
        response.status(201).json({ status: "REGISTERED", ...registered, onshapeName, renameStatus: "SUCCEEDED" });
      } catch (error) {
        const message = errorMessage(error).slice(0, 1000);
        await database.query("UPDATE cad_references SET onshape_name_after = $1, rename_status = 'FAILED', rename_error = $2 WHERE id = $3", [onshapeName, message, registered.cadReferenceId]);
        response.status(207).json({ status: "REGISTERED_RENAME_FAILED", ...registered, onshapeName, renameStatus: "FAILED", warning: message });
      }
    } catch (error) {
      const code = (error as { code?: string }).code;
      response.status(code === "23505" ? 409 : 400).json({ error: code === "23505" ? "This Onshape part is already registered in UnderSync." : errorMessage(error) });
    }
  });
}

async function loadFormOptions(database: DatabasePool) {
  const [subsystems, users, methods, materials, settings] = await Promise.all([
    database.query("SELECT id, code, name FROM subsystems ORDER BY name"),
    database.query("SELECT id, display_name AS name FROM users WHERE status = 'ACTIVE' ORDER BY display_name"),
    database.query("SELECT id, code, name FROM manufacturing_methods WHERE active = true ORDER BY name"),
    database.query(`SELECT mat.id, mat.code, mat.name,
      COALESCE(array_agg(mm.manufacturing_method_id::text) FILTER (WHERE mm.manufacturing_method_id IS NOT NULL), '{}') AS method_ids
      FROM materials mat LEFT JOIN manufacturing_method_materials mm ON mm.material_id = mat.id
      WHERE mat.active = true GROUP BY mat.id ORDER BY mat.name`),
    loadPartsTrackingFormSettings(database),
  ]);
  return {
    subsystems: subsystems.rows, designers: users.rows, methods: methods.rows,
    materials: materials.rows.map((row) => ({ id: row.id, code: row.code, name: row.name, methodIds: row.method_ids })),
    settings,
  };
}

async function registerPart(database: DatabasePool, part: ResolvedPart, values: { name: string; quantity: number; subsystemId: string; designerId: string; methodId: string; materialId: string }) {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const references = await client.query(
      `SELECT (SELECT id FROM seasons ORDER BY code DESC LIMIT 1) AS season_id,
              EXISTS(SELECT 1 FROM subsystems WHERE id = $1) AS subsystem_ok,
              EXISTS(SELECT 1 FROM users WHERE id = $2 AND status = 'ACTIVE') AS designer_ok,
              EXISTS(SELECT 1 FROM manufacturing_methods WHERE id = $3 AND active = true) AS method_ok,
              EXISTS(SELECT 1 FROM manufacturing_method_materials mm
                JOIN materials mat ON mat.id = mm.material_id AND mat.active = true
                WHERE mm.manufacturing_method_id = $3 AND mm.material_id = $4) AS material_ok`,
      [values.subsystemId, values.designerId, values.methodId, values.materialId],
    );
    const refs = references.rows[0];
    if (!refs.season_id) throw new Error("No current season is configured.");
    if (!refs.subsystem_ok || !refs.designer_ok || !refs.method_ok) throw new Error("A selected form option is no longer available. Reload the panel.");
    if (!refs.material_ok) throw new Error("That material is not accepted by the selected fabrication method.");
    const inserted = await client.query(
      `INSERT INTO parts (season_id, subsystem_id, manufacturing_method_id, material_id, kind, name, status)
       VALUES ($1, $2, $3, $4, 'MANUFACTURED', $5, 'IN_DEVELOPMENT') RETURNING id, tracking_code`,
      [refs.season_id, values.subsystemId, values.methodId, values.materialId, values.name],
    );
    const created = inserted.rows[0];
    await client.query("INSERT INTO part_requirements (part_id, context, required_quantity) VALUES ($1, 'Initial registration', $2)", [created.id, values.quantity]);
    await client.query("INSERT INTO part_user_assignments (part_id, user_id, role) VALUES ($1, $2, 'OWNER')", [created.id, values.designerId]);
    const cad = await client.query(
      `INSERT INTO cad_references (part_id, server, document_id, context_kind, workspace_or_version_id, element_id,
        microversion_id, onshape_part_id, configuration, geometry_selection_id, onshape_name_before, rename_status)
       VALUES ($1, 'https://cad.onshape.com', $2, 'WORKSPACE', $3, $4, $5, $6, $7, $8, $9, 'PENDING') RETURNING id`,
      [created.id, part.documentId, part.workspaceId, part.elementId, part.microversionId, part.partId, part.configuration ?? "", part.selectionId, part.name],
    );
    await client.query("COMMIT");
    return { partId: created.id as string, trackingCode: created.tracking_code as string, cadReferenceId: cad.rows[0].id as string };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

function cleanText(value: unknown, minimum: number, maximum: number, label: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < minimum || text.length > maximum) throw new Error(`${label} must contain ${minimum} to ${maximum} characters.`);
  return text;
}
function uuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error(`Choose a valid ${label}.`);
  return value;
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
