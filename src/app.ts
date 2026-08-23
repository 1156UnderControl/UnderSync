import path from "node:path";
import argon2 from "argon2";
import express, { type Express, type Request, type Response } from "express";
import { createSession, loadAuthContext, validAuthenticatedCsrf, validCsrf, type AuthContext } from "./auth.js";
import { createDatabasePool, type DatabasePool } from "./db.js";
import { accountPage, adminPage, errorPage, homePage, loginPage, registerPage, type ExternalAccountSummary } from "./pages.js";
import { registerOnshapeRoutes } from "./onshape-routes.js";
import { registerAdminRoutes } from "./admin-routes.js";
import type { OnshapeConfig } from "./onshape.js";
import { CSRF_COOKIE, clearAuthCookies, ensureCsrfCookie, hashToken, isValidEmail, parseCookies, setAuthCookies, validatePassword } from "./security.js";

export interface AppConfig {
  port: number;
  databaseUrl: string;
  sessionTtlHours: number;
  cookieSecure: boolean;
  onshape: OnshapeConfig;
}

export interface AppDependencies {
  database?: DatabasePool;
  fetchImpl?: typeof fetch;
}

interface LoginAttempt {
  failures: number;
  blockedUntil: number;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number.parseInt(environment.PORT ?? "8000", 10);
  const sessionTtlHours = Number.parseInt(environment.SESSION_TTL_HOURS ?? "168", 10);
  if (!environment.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be between 1 and 65535.");
  if (!Number.isInteger(sessionTtlHours) || sessionTtlHours < 1) throw new Error("SESSION_TTL_HOURS must be positive.");
  return {
    port,
    databaseUrl: environment.DATABASE_URL,
    sessionTtlHours,
    cookieSecure: environment.COOKIE_SECURE === "true",
    onshape: {
      clientId: environment.ONSHAPE_CLIENT_ID ?? "",
      clientSecret: environment.ONSHAPE_CLIENT_SECRET ?? "",
      redirectUri: environment.ONSHAPE_REDIRECT_URI ?? "http://localhost:8000/oauth/callback",
      authorizationUrl: environment.ONSHAPE_AUTHORIZATION_URL ?? "https://oauth.onshape.com/oauth/authorize",
      tokenUrl: environment.ONSHAPE_TOKEN_URL ?? "https://oauth.onshape.com/oauth/token",
      apiBaseUrl: environment.ONSHAPE_API_BASE_URL ?? "https://cad.onshape.com",
      encryptionKey: environment.INTEGRATION_ENCRYPTION_KEY ?? "",
    },
  };
}

function textField(request: Request, name: string): string {
  return typeof request.body?.[name] === "string" ? request.body[name].trim() : "";
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function safeReturnTo(value: unknown): string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value.slice(0, 1000) : "/";
}

async function loadExternalAccounts(database: DatabasePool, userId: string): Promise<ExternalAccountSummary[]> {
  const result = await database.query(
    `SELECT c.provider, c.display_name AS connection_name, c.status AS connection_status,
            e.status AS identity_status, e.external_user_id, e.external_display_name,
            e.external_email, e.verified_at
       FROM integration_connections c
       LEFT JOIN external_identities e ON e.connection_id = c.id AND e.user_id = $1
      ORDER BY c.provider`,
    [userId],
  );
  return result.rows.map((row) => ({
    provider: row.provider,
    connectionName: row.connection_name,
    connectionStatus: row.connection_status,
    identityStatus: row.identity_status ?? undefined,
    externalUserId: row.external_user_id ?? undefined,
    externalDisplayName: row.external_display_name ?? undefined,
    externalEmail: row.external_email ?? undefined,
    verifiedAt: row.verified_at?.toISOString?.() ?? undefined,
  }));
}

async function csrfForPage(
  database: DatabasePool,
  request: Request,
  response: Response,
  secure: boolean,
  context?: AuthContext,
): Promise<string> {
  const before = parseCookies(request)[CSRF_COOKIE];
  const token = ensureCsrfCookie(request, response, secure);
  if (context && !before) {
    await database.query("UPDATE sessions SET csrf_token_hash = $1 WHERE id = $2", [hashToken(token), context.sessionId]);
  }
  return token;
}

export function createApp(config: AppConfig, dependencies: AppDependencies = {}): Express {
  const app = express();
  const database = dependencies.database ?? createDatabasePool(config.databaseUrl);
  const loginAttempts = new Map<string, LoginAttempt>();

  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: false, limit: "32kb" }));
  app.use(express.json({ limit: "64kb" }));
  app.use(express.static(path.resolve(process.cwd(), "public"), { index: false }));

  registerOnshapeRoutes(app, config, database, dependencies);
  registerAdminRoutes(app, config, database);

  app.get("/health", async (_request, response) => {
    try {
      await database.query("SELECT 1");
      response.json({ status: "ok", service: "undersync", database: "connected" });
    } catch {
      response.status(503).json({ status: "unavailable", service: "undersync", database: "disconnected" });
    }
  });

  app.get("/", async (request, response) => {
    const context = await loadAuthContext(database, request);
    if (!context) return response.redirect("/login");
    const csrf = await csrfForPage(database, request, response, config.cookieSecure, context);
    response.send(homePage(context.user, csrf));
  });

  app.get("/login", async (request, response) => {
    const returnTo = safeReturnTo(request.query.return_to);
    if (await loadAuthContext(database, request)) return response.redirect(returnTo);
    const csrf = ensureCsrfCookie(request, response, config.cookieSecure);
    const message = request.query.disabled === "1" ? "Your account has been disabled." : undefined;
    response.send(loginPage(csrf, message, "", returnTo));
  });

  app.post("/login", async (request, response) => {
    const csrf = ensureCsrfCookie(request, response, config.cookieSecure);
    const identifier = textField(request, "identifier");
    const returnTo = safeReturnTo(request.body?.return_to);
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    if (!validCsrf(request) || !identifier || !password) {
      const message = !validCsrf(request)
        ? "The browser blocked the login security cookie. Open this login page outside the Onshape panel, then retry the panel."
        : "Enter a valid name/email and password.";
      return response.status(400).send(loginPage(csrf, message, identifier, returnTo));
    }

    const attemptKey = `${request.ip}|${identifier.toLowerCase()}`;
    const attempt = loginAttempts.get(attemptKey);
    if (attempt && attempt.blockedUntil > Date.now()) {
      return response.status(429).send(loginPage(csrf, "Too many attempts. Try again in a few minutes.", identifier, returnTo));
    }

    const result = await database.query(
      `SELECT id, password_hash, status FROM users
        WHERE lower(name) = lower($1) OR lower(email) = lower($1)
        LIMIT 1`,
      [identifier],
    );
    const row = result.rows[0];
    const valid = row?.password_hash ? await argon2.verify(row.password_hash, password) : false;
    if (!valid || row.status !== "ACTIVE") {
      const failures = (attempt?.failures ?? 0) + 1;
      loginAttempts.set(attemptKey, { failures, blockedUntil: failures >= 5 ? Date.now() + 5 * 60_000 : 0 });
      return response.status(401).send(loginPage(csrf, "The supplied credentials are not valid.", identifier, returnTo));
    }

    loginAttempts.delete(attemptKey);
    const session = await createSession(database, row.id, config.sessionTtlHours);
    setAuthCookies(response, session.sessionToken, session.csrfToken, config.cookieSecure, session.maxAgeMs);
    response.redirect(returnTo);
  });

  app.get("/register", async (request, response) => {
    if (await loadAuthContext(database, request)) return response.redirect("/");
    response.send(registerPage(ensureCsrfCookie(request, response, config.cookieSecure)));
  });

  app.post("/register", async (request, response) => {
    const csrf = ensureCsrfCookie(request, response, config.cookieSecure);
    const values = {
      name: textField(request, "name"),
      display_name: textField(request, "display_name"),
      email: textField(request, "email").toLowerCase(),
    };
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    const passwordError = validatePassword(password);
    if (!validCsrf(request)) return response.status(403).send(registerPage(csrf, "The form expired. Please try again.", values));
    if (values.name.length < 2 || values.name.length > 80 || values.display_name.length < 2 || values.display_name.length > 100) {
      return response.status(400).send(registerPage(csrf, "Name and display name must be between 2 and 100 characters.", values));
    }
    if (!isValidEmail(values.email)) return response.status(400).send(registerPage(csrf, "Enter a valid email address.", values));
    if (passwordError) return response.status(400).send(registerPage(csrf, passwordError, values));
    try {
      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
      const inserted = await database.query(
        `INSERT INTO users (name, email, display_name, password_hash, role, status)
         VALUES ($1, $2, $3, $4, 'MEMBER', 'ACTIVE') RETURNING id`,
        [values.name, values.email, values.display_name, passwordHash],
      );
      const session = await createSession(database, inserted.rows[0].id, config.sessionTtlHours);
      setAuthCookies(response, session.sessionToken, session.csrfToken, config.cookieSecure, session.maxAgeMs);
      response.redirect("/");
    } catch (error: unknown) {
      if ((error as { code?: string }).code === "23505") {
        return response.status(409).send(registerPage(csrf, "That name or email is already registered.", values));
      }
      throw error;
    }
  });

  app.post("/logout", async (request, response) => {
    const context = await loadAuthContext(database, request);
    if (context && await validAuthenticatedCsrf(database, request, context)) {
      await database.query("UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = $1", [context.sessionId]);
    }
    clearAuthCookies(response, config.cookieSecure);
    response.redirect("/login");
  });

  app.get("/account", async (request, response) => {
    const context = await loadAuthContext(database, request);
    if (!context) return response.redirect("/login");
    const csrf = await csrfForPage(database, request, response, config.cookieSecure, context);
    response.send(accountPage(context.user, csrf, undefined, false, await loadExternalAccounts(database, context.user.id)));
  });

  app.post("/account", async (request, response) => {
    const context = await loadAuthContext(database, request);
    if (!context) return response.redirect("/login");
    const csrf = await csrfForPage(database, request, response, config.cookieSecure, context);
    if (!await validAuthenticatedCsrf(database, request, context)) return response.status(403).send(accountPage(context.user, csrf, "The form expired. Please try again.", true));

    const name = textField(request, "name");
    const displayName = textField(request, "display_name");
    const email = textField(request, "email").toLowerCase();
    const currentPassword = typeof request.body?.current_password === "string" ? request.body.current_password : "";
    const newPassword = typeof request.body?.new_password === "string" ? request.body.new_password : "";
    if (name.length < 2 || name.length > 80 || displayName.length < 2 || displayName.length > 100 || !isValidEmail(email)) {
      return response.status(400).send(accountPage(context.user, csrf, "Check the supplied name and email values.", true));
    }
    let passwordHash: string | undefined;
    if (newPassword) {
      const passwordError = validatePassword(newPassword);
      if (passwordError) return response.status(400).send(accountPage(context.user, csrf, passwordError, true));
      const stored = await database.query("SELECT password_hash FROM users WHERE id = $1", [context.user.id]);
      if (!stored.rows[0]?.password_hash || !await argon2.verify(stored.rows[0].password_hash, currentPassword)) {
        return response.status(400).send(accountPage(context.user, csrf, "The current password is incorrect.", true));
      }
      passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    }

    try {
      await database.query(
        `UPDATE users SET name = $1, display_name = $2, email = $3,
          password_hash = COALESCE($4, password_hash) WHERE id = $5`,
        [name, displayName, email, passwordHash ?? null, context.user.id],
      );
      if (passwordHash) await database.query("UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND id <> $2", [context.user.id, context.sessionId]);
      const updated = { ...context.user, name, displayName, email };
      response.send(accountPage(updated, csrf, "Account updated.", false, await loadExternalAccounts(database, context.user.id)));
    } catch (error: unknown) {
      if ((error as { code?: string }).code === "23505") return response.status(409).send(accountPage(context.user, csrf, "That name or email is already in use.", true));
      throw error;
    }
  });

  app.post("/admin/users/:userId/toggle-status", async (request, response) => {
    const context = await loadAuthContext(database, request);
    if (!context) return response.redirect("/login");
    const csrf = await csrfForPage(database, request, response, config.cookieSecure, context);
    if (context.user.role !== "ADMIN") return response.status(403).send(errorPage("Forbidden", "Administrator access is required.", 403, context.user, csrf));
    if (!await validAuthenticatedCsrf(database, request, context)) return response.status(403).send(errorPage("Forbidden", "The form expired. Please try again.", 403, context.user, csrf));
    const userId = request.params.userId;
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return response.status(400).send(errorPage("Invalid user", "The supplied user ID is invalid.", 400, context.user, csrf));

    const target = await database.query("SELECT id, name, role, status FROM users WHERE id = $1", [userId]);
    if (target.rowCount !== 1) return response.status(404).send(errorPage("User not found", "The requested account does not exist.", 404, context.user, csrf));
    const user = target.rows[0];
    const nextStatus = user.status === "ACTIVE" ? "DISABLED" : "ACTIVE";
    if (user.id === context.user.id && nextStatus === "DISABLED") {
      return response.status(409).send(errorPage("Cannot disable this account", "You cannot disable the account currently administering UnderSync.", 409, context.user, csrf));
    }
    if (user.role === "ADMIN" && nextStatus === "DISABLED") {
      const admins = await database.query("SELECT count(*)::int AS count FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'");
      if (admins.rows[0].count <= 1) return response.status(409).send(errorPage("Cannot disable last administrator", "At least one active administrator is required.", 409, context.user, csrf));
    }

    const client = await database.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE users SET status = $1 WHERE id = $2", [nextStatus, userId]);
      if (nextStatus === "DISABLED") await client.query("UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = $1", [userId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    response.redirect(`/admin/database?table=users&message=${encodeURIComponent(`${user.name} is now ${nextStatus.toLowerCase()}.`)}`);
  });

  app.post("/admin/users/:userId/reset-password", async (request, response) => {
    const context = await loadAuthContext(database, request);
    if (!context) return response.redirect("/login");
    const csrf = await csrfForPage(database, request, response, config.cookieSecure, context);
    if (context.user.role !== "ADMIN") return response.status(403).send(errorPage("Forbidden", "Administrator access is required.", 403, context.user, csrf));
    if (!await validAuthenticatedCsrf(database, request, context)) return response.status(403).send(errorPage("Forbidden", "The form expired. Please try again.", 403, context.user, csrf));
    const userId = request.params.userId;
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return response.status(400).send(errorPage("Invalid user", "The supplied user ID is invalid.", 400, context.user, csrf));
    const target = await database.query("SELECT name FROM users WHERE id = $1", [userId]);
    if (target.rowCount !== 1) return response.status(404).send(errorPage("User not found", "The requested account does not exist.", 404, context.user, csrf));

    const passwordHash = await argon2.hash("Senha1156", { type: argon2.argon2id });
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, userId]);
      await client.query("UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = $1", [userId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    response.redirect(`/admin/database?table=users&message=${encodeURIComponent(`Password for ${target.rows[0].name} was reset to Senha1156.`)}`);
  });

  app.post("/admin/users/:userId/set-role", async (request, response) => {
    const context = await loadAuthContext(database, request);
    if (!context) return response.redirect("/login");
    const csrf = await csrfForPage(database, request, response, config.cookieSecure, context);
    if (context.user.role !== "ADMIN") return response.status(403).send(errorPage("Forbidden", "Administrator access is required.", 403, context.user, csrf));
    if (!await validAuthenticatedCsrf(database, request, context)) return response.status(403).send(errorPage("Forbidden", "The form expired. Please try again.", 403, context.user, csrf));
    const userId = request.params.userId;
    const role = textField(request, "role");
    if (!/^[0-9a-f-]{36}$/i.test(userId) || !(["ADMIN", "MEMBER"] as string[]).includes(role)) {
      return response.status(400).send(errorPage("Invalid role change", "The supplied user or role is invalid.", 400, context.user, csrf));
    }
    const target = await database.query("SELECT id, name, role, status FROM users WHERE id = $1", [userId]);
    if (target.rowCount !== 1) return response.status(404).send(errorPage("User not found", "The requested account does not exist.", 404, context.user, csrf));
    const user = target.rows[0];
    if (user.role === "ADMIN" && role === "MEMBER" && user.status === "ACTIVE") {
      const admins = await database.query("SELECT count(*)::int AS count FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'");
      if (admins.rows[0].count <= 1) return response.status(409).send(errorPage("Cannot demote last administrator", "At least one active administrator is required.", 409, context.user, csrf));
    }
    await database.query("UPDATE users SET role = $1 WHERE id = $2", [role, userId]);
    response.redirect(`/admin/database?table=users&message=${encodeURIComponent(`${user.name} is now ${role.toLowerCase()}.`)}`);
  });

  app.post("/admin/users/:userId/delete", async (request, response) => {
    const context = await loadAuthContext(database, request);
    if (!context) return response.redirect("/login");
    const csrf = await csrfForPage(database, request, response, config.cookieSecure, context);
    if (context.user.role !== "ADMIN") return response.status(403).send(errorPage("Forbidden", "Administrator access is required.", 403, context.user, csrf));
    if (!await validAuthenticatedCsrf(database, request, context)) return response.status(403).send(errorPage("Forbidden", "The form expired. Please try again.", 403, context.user, csrf));
    const userId = request.params.userId;
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return response.status(400).send(errorPage("Invalid user", "The supplied user ID is invalid.", 400, context.user, csrf));
    const target = await database.query("SELECT id, name, role, status FROM users WHERE id = $1", [userId]);
    if (target.rowCount !== 1) return response.status(404).send(errorPage("User not found", "The requested account does not exist.", 404, context.user, csrf));
    const user = target.rows[0];
    if (user.id === context.user.id) return response.status(409).send(errorPage("Cannot delete this account", "You cannot delete the account currently administering UnderSync.", 409, context.user, csrf));
    if (user.role === "ADMIN" && user.status === "ACTIVE") {
      const admins = await database.query("SELECT count(*)::int AS count FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'");
      if (admins.rows[0].count <= 1) return response.status(409).send(errorPage("Cannot delete last administrator", "At least one active administrator is required.", 409, context.user, csrf));
    }
    try {
      await database.query("DELETE FROM users WHERE id = $1", [userId]);
      response.redirect(`/admin/database?table=users&message=${encodeURIComponent(`${user.name} was permanently deleted.`)}`);
    } catch (error: unknown) {
      if ((error as { code?: string }).code === "23503") {
        return response.redirect(`/admin/database?table=users&message=${encodeURIComponent(`${user.name} owns protected history and cannot be deleted. Disable the account instead.`)}`);
      }
      throw error;
    }
  });

  app.get("/admin/database", async (request, response) => {
    const context = await loadAuthContext(database, request);
    if (!context) return response.redirect("/login");
    const csrf = await csrfForPage(database, request, response, config.cookieSecure, context);
    if (context.user.role !== "ADMIN") return response.status(403).send(errorPage("Forbidden", "Administrator access is required.", 403, context.user, csrf));

    const tableResult = await database.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
    const tables = tableResult.rows.map((row) => String(row.tablename));
    const requested = typeof request.query.table === "string" ? request.query.table : "";
    const selected = tables.includes(requested) ? requested : (tables.includes("users") ? "users" : tables[0]);
    const message = typeof request.query.message === "string" ? request.query.message.slice(0, 240) : undefined;
    if (!selected) return response.send(adminPage(context.user, csrf, [], "No tables", [], [], 1, false, message));
    const page = Math.max(1, Number.parseInt(typeof request.query.page === "string" ? request.query.page : "1", 10) || 1);
    const columnsResult = await database.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
      [selected],
    );
    const columns = columnsResult.rows.map((row) => String(row.column_name));
    const rowsResult = await database.query(`SELECT * FROM ${quoteIdentifier(selected)} LIMIT 51 OFFSET $1`, [(page - 1) * 50]);
    response.send(adminPage(context.user, csrf, tables, selected, columns, rowsResult.rows.slice(0, 50), page, rowsResult.rows.length > 50, message));
  });

  app.use(async (request, response) => {
    const context = await loadAuthContext(database, request);
    const csrf = context ? await csrfForPage(database, request, response, config.cookieSecure, context) : "";
    response.status(404).send(errorPage("Not found", "The requested page does not exist.", 404, context?.user, csrf));
  });

  app.use((error: unknown, _request: Request, response: Response, _next: (error?: unknown) => void) => {
    console.error(error);
    response.status(500).send(errorPage("Unexpected error", "UnderSync could not complete that request.", 500));
  });

  return app;
}
