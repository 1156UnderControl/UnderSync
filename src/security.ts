import crypto from "node:crypto";
import type { Request, Response } from "express";

export const SESSION_COOKIE = "undersync_session";
export const CSRF_COOKIE = "undersync_csrf";

function cookieSameSite(secure: boolean): "lax" | "none" {
  // Onshape loads UnderSync cross-site in an iframe. SameSite=None is required
  // there and modern browsers require it to be paired with Secure.
  return secure ? "none" : "lax";
}

export function hashToken(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function randomToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function parseCookies(request: Request): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of (request.headers.cookie ?? "").split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 1) continue;
    const key = entry.slice(0, separator).trim();
    const value = entry.slice(separator + 1).trim();
    try {
      result[key] = decodeURIComponent(value);
    } catch {
      // Ignore malformed cookies rather than failing the whole request.
    }
  }
  return result;
}

export function setAuthCookies(
  response: Response,
  sessionToken: string,
  csrfToken: string,
  secure: boolean,
  maxAgeMs: number,
): void {
  response.cookie(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: cookieSameSite(secure),
    secure,
    maxAge: maxAgeMs,
    path: "/",
  });
  response.cookie(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    sameSite: cookieSameSite(secure),
    secure,
    maxAge: maxAgeMs,
    path: "/",
  });
}

export function clearAuthCookies(response: Response, secure: boolean): void {
  const common = { sameSite: cookieSameSite(secure), secure, path: "/" };
  response.clearCookie(SESSION_COOKIE, { ...common, httpOnly: true });
  response.clearCookie(CSRF_COOKIE, { ...common, httpOnly: false });
}

export function ensureCsrfCookie(request: Request, response: Response, secure: boolean): string {
  const existing = parseCookies(request)[CSRF_COOKIE];
  if (existing) return existing;
  const token = randomToken();
  response.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    sameSite: cookieSameSite(secure),
    secure,
    maxAge: 24 * 60 * 60 * 1000,
    path: "/",
  });
  return token;
}

export function safeEqual(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

export function validatePassword(value: string): string | undefined {
  if (value.length < 8) return "Password must contain at least 8 characters.";
  if (value.length > 128) return "Password must contain at most 128 characters.";
  return undefined;
}
