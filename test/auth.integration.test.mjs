import assert from "node:assert/strict";
import test from "node:test";
import argon2 from "argon2";
import pg from "pg";
import { createApp } from "../dist/src/app.js";

const { Pool } = pg;

class CookieJar {
  values = new Map();

  absorb(response) {
    const headers = typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
    for (const header of headers) {
      const [pair, ...attributes] = header.split(";");
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (attributes.some((attribute) => attribute.trim().toLowerCase() === "max-age=0")) this.values.delete(name);
      else this.values.set(name, value);
    }
  }

  header() {
    return [...this.values].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  csrf() {
    return decodeURIComponent(this.values.get("undersync_csrf") ?? "");
  }
}

async function request(baseUrl, path, options, jar) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    ...options,
    headers: { ...(options?.headers ?? {}), ...(jar?.header() ? { cookie: jar.header() } : {}) },
  });
  jar?.absorb(response);
  return response;
}

test("registration, login, account editing, and admin authorization", async () => {
  assert.ok(process.env.DATABASE_URL);
  const database = new Pool({ connectionString: process.env.DATABASE_URL });
  await database.query(
    `INSERT INTO integration_connections (provider, key, display_name, auth_mode, status) VALUES
      ('ONSHAPE', 'auth-test', 'Onshape', 'OAUTH', 'NOT_CONFIGURED'),
      ('NOTION', 'auth-test', 'Notion workspace', 'INTERNAL_TOKEN', 'NOT_CONFIGURED')
     ON CONFLICT (provider, key) DO NOTHING`,
  );
  const app = createApp({
    port: 0,
    databaseUrl: process.env.DATABASE_URL,
    sessionTtlHours: 24,
    cookieSecure: false,
  }, { database });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const memberJar = new CookieJar();
    const registerPage = await request(baseUrl, "/register", {}, memberJar);
    assert.equal(registerPage.status, 200);
    assert.ok(memberJar.csrf());

    const registration = await request(baseUrl, "/register", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        _csrf: memberJar.csrf(),
        name: "integration-member",
        display_name: "Integration Member",
        email: "integration-member@example.test",
        password: "member-password",
        role: "ADMIN",
      }),
    }, memberJar);
    assert.equal(registration.status, 302);
    assert.equal(registration.headers.get("location"), "/");
    assert.equal((await database.query("SELECT role FROM users WHERE name = 'integration-member'")).rows[0].role, "MEMBER");

    const account = await request(baseUrl, "/account", {}, memberJar);
    assert.equal(account.status, 200);
    const accountBody = await account.text();
    assert.match(accountBody, /Integration Member/);
    assert.match(accountBody, /Connected accounts/);
    assert.match(accountBody, /Onshape/);
    assert.match(accountBody, /Notion workspace/);
    assert.doesNotMatch(accountBody, /name="status"/);
    assert.doesNotMatch(accountBody, /name="role"/);

    const update = await request(baseUrl, "/account", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        _csrf: memberJar.csrf(),
        name: "integration-member-updated",
        display_name: "Updated Member",
        email: "updated-member@example.test",
        role: "ADMIN",
        current_password: "member-password",
        new_password: "new-member-password",
      }),
    }, memberJar);
    assert.equal(update.status, 200);
    assert.match(await update.text(), /Account updated/);
    assert.equal((await database.query("SELECT role FROM users WHERE name = 'integration-member-updated'")).rows[0].role, "MEMBER");

    const forbidden = await request(baseUrl, "/admin", {}, memberJar);
    assert.equal(forbidden.status, 403);

    const adminHash = await argon2.hash("admin", { type: argon2.argon2id });
    await database.query(
      `INSERT INTO users (name, email, display_name, password_hash, role, status)
       VALUES ('admin-integration', 'admin-integration@example.test', 'Integration Admin', $1, 'ADMIN', 'ACTIVE')
       ON CONFLICT DO NOTHING`,
      [adminHash],
    );

    const adminJar = new CookieJar();
    await request(baseUrl, "/login", {}, adminJar);
    const login = await request(baseUrl, "/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _csrf: adminJar.csrf(), identifier: "admin-integration", password: "admin" }),
    }, adminJar);
    assert.equal(login.status, 302);

    const overview = await request(baseUrl, "/admin", {}, adminJar);
    assert.equal(overview.status, 200);
    assert.match(await overview.text(), /Parts Tracking form/);

    const trackingAdmin = await request(baseUrl, "/admin/parts-tracking", {}, adminJar);
    assert.equal(trackingAdmin.status, 200);
    assert.match(await trackingAdmin.text(), /Question wording/);

    const settingsUpdate = await request(baseUrl, "/admin/parts-tracking/settings", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        _csrf: adminJar.csrf(), form_title: "Register robot part", name_label: "Part name",
        name_placeholder: "Example: camera mount", quantity_label: "Required quantity",
        subsystem_label: "Robot subsystem", designer_label: "Designed by",
        fabrication_method_label: "How will this be fabricated?", material_label: "Choose material", submit_label: "Create tracking ID",
      }),
    }, adminJar);
    assert.equal(settingsUpdate.status, 302);
    const configuredForm = await request(baseUrl, "/parts-tracking", {}, adminJar);
    assert.match(await configuredForm.text(), /Register robot part/);

    const methodCreate = await request(baseUrl, "/admin/parts-tracking/methods", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _csrf: adminJar.csrf(), code: "WATERJET", name: "Waterjet" }),
    }, adminJar);
    assert.equal(methodCreate.status, 302);
    const createdMethod = (await database.query("SELECT id, active FROM manufacturing_methods WHERE code = 'WATERJET'")).rows[0];
    assert.equal(createdMethod.active, true);

    const materialCreate = await request(baseUrl, "/admin/parts-tracking/materials", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _csrf: adminJar.csrf(), code: "TESTMAT", name: "Test material", method_ids: createdMethod.id }),
    }, adminJar);
    assert.equal(materialCreate.status, 302);
    const createdMaterial = (await database.query("SELECT id FROM materials WHERE code = 'TESTMAT'")).rows[0];
    assert.equal((await database.query("SELECT count(*)::int AS count FROM manufacturing_method_materials WHERE material_id = $1 AND manufacturing_method_id = $2", [createdMaterial.id, createdMethod.id])).rows[0].count, 1);
    const materialForm = await request(baseUrl, "/parts-tracking", {}, adminJar);
    assert.match(await materialForm.text(), /id="material-field" hidden/);

    const materialDelete = await request(baseUrl, `/admin/parts-tracking/materials/${createdMaterial.id}/delete`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _csrf: adminJar.csrf() }),
    }, adminJar);
    assert.equal(materialDelete.status, 302);
    assert.equal((await database.query("SELECT 1 FROM materials WHERE id = $1", [createdMaterial.id])).rowCount, 0);

    const methodDelete = await request(baseUrl, `/admin/parts-tracking/methods/${createdMethod.id}/delete`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _csrf: adminJar.csrf() }),
    }, adminJar);
    assert.equal(methodDelete.status, 302);
    assert.equal((await database.query("SELECT 1 FROM manufacturing_methods WHERE id = $1", [createdMethod.id])).rowCount, 0);

    const admin = await request(baseUrl, "/admin/database?table=users", {}, adminJar);
    assert.equal(admin.status, 200);
    const adminBody = await admin.text();
    assert.match(adminBody, /Database explorer/);
    assert.match(adminBody, /Redacted/);
    assert.match(adminBody, /Reset password/);
    assert.match(adminBody, /Make admin/);
    assert.match(adminBody, /Delete/);
    assert.doesNotMatch(adminBody, /table=teams/);
    assert.doesNotMatch(adminBody, new RegExp(adminHash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const member = await database.query("SELECT id FROM users WHERE name = 'integration-member-updated'");
    const memberId = member.rows[0].id;
    const promote = await request(baseUrl, `/admin/users/${memberId}/set-role`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _csrf: adminJar.csrf(), role: "ADMIN" }),
    }, adminJar);
    assert.equal(promote.status, 302);
    assert.equal((await database.query("SELECT role FROM users WHERE id = $1", [memberId])).rows[0].role, "ADMIN");

    const demote = await request(baseUrl, `/admin/users/${memberId}/set-role`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _csrf: adminJar.csrf(), role: "MEMBER" }),
    }, adminJar);
    assert.equal(demote.status, 302);
    assert.equal((await database.query("SELECT role FROM users WHERE id = $1", [memberId])).rows[0].role, "MEMBER");

    const reset = await request(baseUrl, `/admin/users/${memberId}/reset-password`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _csrf: adminJar.csrf() }),
    }, adminJar);
    assert.equal(reset.status, 302);
    const resetHash = await database.query("SELECT password_hash FROM users WHERE id = $1", [memberId]);
    assert.equal(await argon2.verify(resetHash.rows[0].password_hash, "Senha1156"), true);

    const disable = await request(baseUrl, `/admin/users/${memberId}/toggle-status`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _csrf: adminJar.csrf() }),
    }, adminJar);
    assert.equal(disable.status, 302);
    assert.equal((await database.query("SELECT status FROM users WHERE id = $1", [memberId])).rows[0].status, "DISABLED");

    const enable = await request(baseUrl, `/admin/users/${memberId}/toggle-status`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _csrf: adminJar.csrf() }),
    }, adminJar);
    assert.equal(enable.status, 302);
    assert.equal((await database.query("SELECT status FROM users WHERE id = $1", [memberId])).rows[0].status, "ACTIVE");

    const resetLoginJar = new CookieJar();
    await request(baseUrl, "/login", {}, resetLoginJar);
    const resetLogin = await request(baseUrl, "/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _csrf: resetLoginJar.csrf(), identifier: "integration-member-updated", password: "Senha1156" }),
    }, resetLoginJar);
    assert.equal(resetLogin.status, 302);

    const disposableHash = await argon2.hash("disposable-password", { type: argon2.argon2id });
    const disposable = await database.query(
      `INSERT INTO users (name, email, display_name, password_hash, role, status)
       VALUES ('disposable-user', 'disposable-user@example.test', 'Disposable User', $1, 'MEMBER', 'ACTIVE') RETURNING id`,
      [disposableHash],
    );
    const deletion = await request(baseUrl, `/admin/users/${disposable.rows[0].id}/delete`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _csrf: adminJar.csrf() }),
    }, adminJar);
    assert.equal(deletion.status, 302);
    assert.equal((await database.query("SELECT count(*)::int AS count FROM users WHERE id = $1", [disposable.rows[0].id])).rows[0].count, 0);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await database.end();
  }
});
