import type { Request } from "express";
import type { DatabasePool } from "./db.js";
import { CSRF_COOKIE, SESSION_COOKIE, hashToken, parseCookies, randomToken, safeEqual } from "./security.js";

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  displayName: string;
  role: "ADMIN" | "MEMBER";
  status: "ACTIVE" | "DISABLED";
}

export interface AuthContext {
  sessionId: string;
  user: AuthenticatedUser;
}

export async function createSession(
  database: DatabasePool,
  userId: string,
  ttlHours: number,
): Promise<{ sessionToken: string; csrfToken: string; maxAgeMs: number }> {
  const sessionToken = randomToken();
  const csrfToken = randomToken();
  const maxAgeMs = ttlHours * 60 * 60 * 1000;
  await database.query(
    `INSERT INTO sessions (user_id, token_hash, csrf_token_hash, expires_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP + ($4 * INTERVAL '1 hour'))`,
    [userId, hashToken(sessionToken), hashToken(csrfToken), ttlHours],
  );
  return { sessionToken, csrfToken, maxAgeMs };
}

export async function loadAuthContext(
  database: DatabasePool,
  request: Request,
): Promise<AuthContext | undefined> {
  const sessionToken = parseCookies(request)[SESSION_COOKIE];
  if (!sessionToken) return undefined;
  const result = await database.query(
    `SELECT s.id AS session_id, u.id, u.name, u.email,
            u.display_name, u.role, u.status
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > CURRENT_TIMESTAMP
        AND u.status = 'ACTIVE'`,
    [hashToken(sessionToken)],
  );
  if (result.rowCount !== 1) return undefined;
  const row = result.rows[0];
  await database.query("UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = $1", [row.session_id]);
  return {
    sessionId: row.session_id,
    user: {
      id: row.id,
      name: row.name,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      status: row.status,
    },
  };
}

export function validCsrf(request: Request, context?: AuthContext): boolean {
  const cookies = parseCookies(request);
  const submitted = typeof request.body?._csrf === "string" ? request.body._csrf : undefined;
  if (!safeEqual(cookies[CSRF_COOKIE], submitted)) return false;
  return context !== undefined || Boolean(submitted);
}

export async function validAuthenticatedCsrf(
  database: DatabasePool,
  request: Request,
  context: AuthContext,
): Promise<boolean> {
  if (!validCsrf(request, context)) return false;
  const csrfToken = parseCookies(request)[CSRF_COOKIE];
  const result = await database.query(
    "SELECT 1 FROM sessions WHERE id = $1 AND csrf_token_hash = $2 AND revoked_at IS NULL",
    [context.sessionId, hashToken(csrfToken)],
  );
  return result.rowCount === 1;
}
