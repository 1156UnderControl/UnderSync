import { useAuthActions } from "@convex-dev/auth/react";
import { useState, type FormEvent } from "react";
import logo from "../assets/undersync-logo.png";

export function AuthPage() {
  const { signIn } = useAuthActions();
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true); const data = new FormData(event.currentTarget);
    try { await signIn("password", { flow: mode, email: String(data.get("email") ?? "").trim().toLowerCase(),
      password: String(data.get("password") ?? ""), username: String(data.get("username") ?? "").trim(),
      displayName: String(data.get("displayName") ?? "").trim(), teamRole: String(data.get("teamRole") ?? "").trim() }); }
    catch (caught) { setError(caught instanceof Error ? caught.message.replace(/^.*Uncaught Error:\s*/, "") : "Authentication failed."); }
    finally { setBusy(false); }
  }
  return <main className="auth-shell">
    <section className="auth-brand-panel"><img src={logo} alt="UnderSync logo" /><p className="eyebrow">FRC 1156 · Under Control</p>
      <h1>Build together.<br />Stay in sync.</h1><p>Engineering operations, parts and team decisions in one place.</p></section>
    <section className="auth-card"><div className="auth-mobile-brand"><img src={logo} alt="" /><strong>UnderSync</strong></div>
      <p className="eyebrow">Welcome to UnderSync</p><h2>{mode === "signIn" ? "Sign in" : "Create your account"}</h2>
      <p className="muted">{mode === "signIn" ? "Use your team email and password." : "New accounts start as members. An admin controls permissions."}</p>
      <form onSubmit={submit} className="form-stack">
        {mode === "signUp" && <><label>Account name<input name="username" autoComplete="username" required minLength={2} placeholder="arthur" /></label>
          <label>Display name<input name="displayName" autoComplete="name" required minLength={2} placeholder="Arthur" /></label>
          <label>Role in the team<input name="teamRole" required minLength={2} placeholder="Mechanical designer" /></label></>}
        <label>Email<input name="email" type="email" autoComplete="email" required placeholder="you@team1156.org" /></label>
        <label>Password<input name="password" type="password" autoComplete={mode === "signIn" ? "current-password" : "new-password"} required minLength={8} placeholder="At least 8 characters" /></label>
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        <button className="button button-primary button-large" disabled={busy}>{busy ? "Please wait…" : mode === "signIn" ? "Sign in" : "Register"}</button>
      </form><button className="auth-switch" onClick={() => { setMode(mode === "signIn" ? "signUp" : "signIn"); setError(""); }}>
        {mode === "signIn" ? "Need an account? Register" : "Already registered? Sign in"}</button>
    </section>
  </main>;
}
