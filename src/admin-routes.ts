import type { Express, Request, Response } from "express";
import type { PoolClient } from "pg";
import type { AppConfig } from "./app.js";
import { loadAuthContext, validAuthenticatedCsrf, type AuthContext } from "./auth.js";
import type { DatabasePool } from "./db.js";
import { adminOverviewPage, adminPartsTrackingPage, errorPage, type AdminManufacturingMethod, type AdminMaterial } from "./pages.js";
import { loadPartsTrackingFormSettings } from "./parts-tracking-config.js";
import { CSRF_COOKIE, ensureCsrfCookie, hashToken, parseCookies } from "./security.js";

export function registerAdminRoutes(app: Express, config: AppConfig, database: DatabasePool): void {
  app.get("/admin", async (request, response) => {
    const admin = await requireAdmin(database, request, response, config.cookieSecure);
    if (!admin) return;
    if (typeof request.query.table === "string") return response.redirect(`/admin/database?${new URLSearchParams(request.query as Record<string, string>)}`);
    const result = await database.query(`SELECT
      (SELECT count(*)::int FROM users) AS users,
      (SELECT count(*)::int FROM parts) AS parts,
      (SELECT count(*)::int FROM manufacturing_methods WHERE active = true) AS active_methods`);
    const row = result.rows[0];
    response.send(adminOverviewPage(admin.context.user, admin.csrf, { users: row.users, parts: row.parts, activeMethods: row.active_methods }));
  });

  app.get("/admin/parts-tracking", async (request, response) => {
    const admin = await requireAdmin(database, request, response, config.cookieSecure);
    if (!admin) return;
    const [settings, methodsResult, materialsResult] = await Promise.all([
      loadPartsTrackingFormSettings(database),
      database.query(`SELECT m.id, m.code, m.name, m.active, count(p.id)::int AS used_by_parts
        FROM manufacturing_methods m LEFT JOIN parts p ON p.manufacturing_method_id = m.id
        GROUP BY m.id ORDER BY m.active DESC, m.name`),
      database.query(`SELECT mat.id, mat.code, mat.name, mat.active, count(DISTINCT p.id)::int AS used_by_parts,
        COALESCE(array_agg(DISTINCT mm.manufacturing_method_id::text) FILTER (WHERE mm.manufacturing_method_id IS NOT NULL), '{}') AS method_ids
        FROM materials mat
        LEFT JOIN parts p ON p.material_id = mat.id
        LEFT JOIN manufacturing_method_materials mm ON mm.material_id = mat.id
        GROUP BY mat.id ORDER BY mat.active DESC, mat.name`),
    ]);
    const methods: AdminManufacturingMethod[] = methodsResult.rows.map((row) => ({
      id: row.id, code: row.code, name: row.name, active: row.active, usedByParts: row.used_by_parts,
    }));
    const materials: AdminMaterial[] = materialsResult.rows.map((row) => ({
      id: row.id, code: row.code, name: row.name, active: row.active,
      usedByParts: row.used_by_parts, methodIds: row.method_ids,
    }));
    const message = typeof request.query.message === "string" ? request.query.message.slice(0, 300) : undefined;
    const isError = request.query.error === "1";
    response.send(adminPartsTrackingPage(admin.context.user, admin.csrf, settings, methods, materials, message, isError));
  });

  app.post("/admin/parts-tracking/settings", async (request, response) => {
    const admin = await requireAdmin(database, request, response, config.cookieSecure);
    if (!admin) return;
    if (!await validAuthenticatedCsrf(database, request, admin.context)) return response.status(403).send(errorPage("Forbidden", "The form expired. Please try again.", 403, admin.context.user, admin.csrf));
    try {
      const values = [
        text(request, "form_title", 120), text(request, "name_label", 80), text(request, "name_placeholder", 160),
        text(request, "quantity_label", 80), text(request, "subsystem_label", 80), text(request, "designer_label", 80),
        text(request, "fabrication_method_label", 80), text(request, "material_label", 80), text(request, "submit_label", 100),
      ];
      await database.query(
        `INSERT INTO parts_tracking_form_settings (id, form_title, name_label, name_placeholder, quantity_label, subsystem_label, designer_label, fabrication_method_label, material_label, submit_label)
         VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET form_title = EXCLUDED.form_title, name_label = EXCLUDED.name_label,
           name_placeholder = EXCLUDED.name_placeholder, quantity_label = EXCLUDED.quantity_label,
           subsystem_label = EXCLUDED.subsystem_label, designer_label = EXCLUDED.designer_label,
           fabrication_method_label = EXCLUDED.fabrication_method_label, material_label = EXCLUDED.material_label,
           submit_label = EXCLUDED.submit_label`,
        values,
      );
      response.redirect("/admin/parts-tracking?message=Form+wording+saved.");
    } catch (error) { redirectError(response, error); }
  });

  app.post("/admin/parts-tracking/methods", async (request, response) => {
    const admin = await requireAdmin(database, request, response, config.cookieSecure);
    if (!admin) return;
    if (!await validAuthenticatedCsrf(database, request, admin.context)) return response.status(403).send(errorPage("Forbidden", "The form expired. Please try again.", 403, admin.context.user, admin.csrf));
    try {
      const code = text(request, "code", 12).toUpperCase();
      const name = text(request, "name", 100);
      if (!/^[A-Z0-9]+$/.test(code)) throw new Error("Method code may contain only A-Z and 0-9.");
      await database.query("INSERT INTO manufacturing_methods (code, name, active) VALUES ($1, $2, true)", [code, name]);
      response.redirect(`/admin/parts-tracking?message=${encodeURIComponent(`${name} added.`)}`);
    } catch (error) { redirectError(response, error); }
  });

  app.post("/admin/parts-tracking/methods/:methodId", async (request, response) => {
    const admin = await requireAdmin(database, request, response, config.cookieSecure);
    if (!admin) return;
    if (!await validAuthenticatedCsrf(database, request, admin.context)) return response.status(403).send(errorPage("Forbidden", "The form expired. Please try again.", 403, admin.context.user, admin.csrf));
    try {
      const methodId = request.params.methodId;
      if (!/^[0-9a-f-]{36}$/i.test(methodId)) throw new Error("Invalid fabrication method ID.");
      const name = text(request, "name", 100);
      const active = request.body?.active === "true";
      const updated = await database.query("UPDATE manufacturing_methods SET name = $1, active = $2 WHERE id = $3 RETURNING name", [name, active, methodId]);
      if (updated.rowCount !== 1) throw new Error("Fabrication method not found.");
      response.redirect(`/admin/parts-tracking?message=${encodeURIComponent(`${name} saved.`)}`);
    } catch (error) { redirectError(response, error); }
  });

  app.post("/admin/parts-tracking/methods/:methodId/delete", async (request, response) => {
    const admin = await requireAdmin(database, request, response, config.cookieSecure);
    if (!admin) return;
    if (!await validAuthenticatedCsrf(database, request, admin.context)) return response.status(403).send(errorPage("Forbidden", "The form expired. Please try again.", 403, admin.context.user, admin.csrf));
    try {
      const methodId = validUuid(request.params.methodId, "fabrication method");
      const removed = await database.query("DELETE FROM manufacturing_methods WHERE id = $1 RETURNING name", [methodId]);
      if (removed.rowCount !== 1) throw new Error("Fabrication method not found.");
      response.redirect(`/admin/parts-tracking?message=${encodeURIComponent(`${removed.rows[0].name} permanently deleted.`)}`);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") return redirectMessage(response, "This fabrication method is used by historical parts and cannot be deleted. Disable it instead.", true);
      redirectError(response, error);
    }
  });

  app.post("/admin/parts-tracking/materials", async (request, response) => {
    const admin = await requireAdmin(database, request, response, config.cookieSecure);
    if (!admin) return;
    if (!await validAuthenticatedCsrf(database, request, admin.context)) return response.status(403).send(errorPage("Forbidden", "The form expired. Please try again.", 403, admin.context.user, admin.csrf));
    try {
      const code = text(request, "code", 12).toUpperCase();
      const name = text(request, "name", 100);
      if (!/^[A-Z0-9]+$/.test(code)) throw new Error("Material code may contain only A-Z and 0-9.");
      const methodIds = selectedMethodIds(request);
      if (methodIds.length === 0) throw new Error("Choose at least one accepted fabrication method.");
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        const material = await client.query("INSERT INTO materials (code, name, active) VALUES ($1, $2, true) RETURNING id", [code, name]);
        await insertMaterialMethods(client, material.rows[0].id, methodIds);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
      response.redirect(`/admin/parts-tracking?message=${encodeURIComponent(`${name} added.`)}`);
    } catch (error) { redirectError(response, error); }
  });

  app.post("/admin/parts-tracking/materials/:materialId", async (request, response) => {
    const admin = await requireAdmin(database, request, response, config.cookieSecure);
    if (!admin) return;
    if (!await validAuthenticatedCsrf(database, request, admin.context)) return response.status(403).send(errorPage("Forbidden", "The form expired. Please try again.", 403, admin.context.user, admin.csrf));
    try {
      const materialId = validUuid(request.params.materialId, "material");
      const name = text(request, "name", 100);
      const active = request.body?.active === "true";
      const methodIds = selectedMethodIds(request);
      if (active && methodIds.length === 0) throw new Error("An active material must accept at least one fabrication method.");
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        const updated = await client.query("UPDATE materials SET name = $1, active = $2 WHERE id = $3 RETURNING name", [name, active, materialId]);
        if (updated.rowCount !== 1) throw new Error("Material not found.");
        await client.query("DELETE FROM manufacturing_method_materials WHERE material_id = $1", [materialId]);
        await insertMaterialMethods(client, materialId, methodIds);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
      response.redirect(`/admin/parts-tracking?message=${encodeURIComponent(`${name} saved.`)}`);
    } catch (error) { redirectError(response, error); }
  });

  app.post("/admin/parts-tracking/materials/:materialId/delete", async (request, response) => {
    const admin = await requireAdmin(database, request, response, config.cookieSecure);
    if (!admin) return;
    if (!await validAuthenticatedCsrf(database, request, admin.context)) return response.status(403).send(errorPage("Forbidden", "The form expired. Please try again.", 403, admin.context.user, admin.csrf));
    try {
      const materialId = validUuid(request.params.materialId, "material");
      const removed = await database.query("DELETE FROM materials WHERE id = $1 RETURNING name", [materialId]);
      if (removed.rowCount !== 1) throw new Error("Material not found.");
      response.redirect(`/admin/parts-tracking?message=${encodeURIComponent(`${removed.rows[0].name} permanently deleted.`)}`);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") return redirectMessage(response, "This material is used by historical parts and cannot be deleted. Disable it instead.", true);
      redirectError(response, error);
    }
  });
}

async function requireAdmin(database: DatabasePool, request: Request, response: Response, secure: boolean): Promise<{ context: AuthContext; csrf: string } | undefined> {
  const context = await loadAuthContext(database, request);
  if (!context) { response.redirect("/login"); return undefined; }
  const existing = parseCookies(request)[CSRF_COOKIE];
  const csrf = existing ?? ensureCsrfCookie(request, response, secure);
  if (!existing) await database.query("UPDATE sessions SET csrf_token_hash = $1 WHERE id = $2", [hashToken(csrf), context.sessionId]);
  if (context.user.role !== "ADMIN") { response.status(403).send(errorPage("Forbidden", "Administrator access is required.", 403, context.user, csrf)); return undefined; }
  return { context, csrf };
}

function text(request: Request, key: string, maximum: number): string {
  const value = typeof request.body?.[key] === "string" ? request.body[key].trim() : "";
  if (!value || value.length > maximum) throw new Error(`${key.replaceAll("_", " ")} must contain 1 to ${maximum} characters.`);
  return value;
}
function redirectError(response: Response, error: unknown): void {
  const duplicate = (error as { code?: string }).code === "23505";
  const message = duplicate ? "That code already exists." : error instanceof Error ? error.message : String(error);
  redirectMessage(response, message, true);
}
function redirectMessage(response: Response, message: string, error = false): void {
  response.redirect(`/admin/parts-tracking?${error ? "error=1&" : ""}message=${encodeURIComponent(message.slice(0, 300))}`);
}
function validUuid(value: string, label: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error(`Invalid ${label} ID.`);
  return value;
}
function selectedMethodIds(request: Request): string[] {
  const raw = request.body?.method_ids;
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  return [...new Set(values.map((value) => validUuid(String(value), "fabrication method")))];
}
async function insertMaterialMethods(client: PoolClient, materialId: string, methodIds: string[]): Promise<void> {
  if (methodIds.length === 0) return;
  const inserted = await client.query(
    `INSERT INTO manufacturing_method_materials (manufacturing_method_id, material_id)
     SELECT id, $1 FROM manufacturing_methods WHERE id = ANY($2::uuid[])`,
    [materialId, methodIds],
  );
  if (inserted.rowCount !== methodIds.length) throw new Error("One or more selected fabrication methods no longer exist.");
}
