import { useAction, useMutation } from "convex/react";
import { useMemo, useState, type FormEvent } from "react";
import { api } from "../../../convex/_generated/api";
import { Notice, PageHeader } from "../components/AppLayout";

type Profile = { user: { id: string; username: string; displayName: string; email: string; teamRole: string; appRole: string; status: string };
  integrations: Array<{ provider: "ONSHAPE" | "NOTION"; status: string; externalDisplayName: string | null; externalEmail: string | null }> };

export function AccountPage({ profile }: { profile: Profile }) {
  const update = useMutation(api.profiles.updateCurrent); const changePassword = useAction(api.profiles.changePassword);
  const beginOnshape = useAction(api.onshapeOAuth.begin); const disconnectOnshape = useAction(api.onshapeOAuth.disconnect);
  const callbackMessage = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("onshape") === "connected") return { kind: "success" as const, text: "Onshape account linked successfully." };
    if (params.get("onshape") === "error") {
      const reason = params.get("reason");
      const messages: Record<string, string> = {
        authorization_denied: "Onshape authorization was cancelled or denied.",
        invalid_state: "The OAuth request expired or was already used. Start the connection again.",
        token_exchange: "Onshape rejected the token exchange. Check the client secret and registered Redirect URL.",
        profile_request: "The account was authorized, but Onshape did not allow its profile to be read.",
        callback_failed: "The Onshape callback could not be completed. Try again or contact an administrator.",
      };
      return { kind: "error" as const, text: messages[reason ?? ""] ?? "The Onshape account could not be linked." };
    }
    return null;
  }, []);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(callbackMessage); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setMessage(null); const form = new FormData(event.currentTarget);
    try { await update({ username: String(form.get("username")), displayName: String(form.get("displayName")), teamRole: String(form.get("teamRole")) }); setMessage({ kind: "success", text: "Account updated." }); }
    catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : "Unable to update account." }); } finally { setBusy(false); } }
  return <><PageHeader eyebrow="Personal settings" title="Account" description="Manage your UnderSync identity and external account links." />
    <section className="account-grid"><article className="panel"><div className="panel-heading"><div><p className="eyebrow">Profile</p><h2>Your information</h2></div><span className="role-badge">{profile.user.appRole}</span></div>
      <form className="form-stack" onSubmit={submit}><label>Account ID<input value={profile.user.id} disabled /></label>
        <label>Account name<input name="username" defaultValue={profile.user.username} required /></label>
        <label>Display name<input name="displayName" defaultValue={profile.user.displayName} required /></label>
        <label>Email<input value={profile.user.email} disabled /><small>Email changes will be enabled with verified email delivery.</small></label>
        <label>Role in the team<input name="teamRole" defaultValue={profile.user.teamRole} required /></label>
        {message && <Notice kind={message.kind}>{message.text}</Notice>}<button className="button button-primary" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button></form>
      <form className="form-stack password-form" onSubmit={(event) => {
        event.preventDefault(); const form = new FormData(event.currentTarget); const password = String(form.get("newPassword"));
        if (password !== String(form.get("confirmation"))) { setMessage({ kind: "error", text: "Password confirmation does not match." }); return; }
        setBusy(true); setMessage(null); void changePassword({ newPassword: password })
          .then(() => setMessage({ kind: "success", text: "Password changed. Sign in again with the new password." }))
          .catch((error: unknown) => setMessage({ kind: "error", text: error instanceof Error ? error.message : "Unable to change password." }))
          .finally(() => setBusy(false));
      }}><h3>Change password</h3><label>New password<input name="newPassword" type="password" minLength={8} required autoComplete="new-password" /></label>
        <label>Confirm new password<input name="confirmation" type="password" minLength={8} required autoComplete="new-password" /></label>
        <button className="button" disabled={busy}>Change password</button></form>
    </article><article className="panel"><div className="panel-heading"><div><p className="eyebrow">Connections</p><h2>Linked accounts</h2></div></div>
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      <div className="integration-list">{profile.integrations.map((integration) => <article key={integration.provider}><div className="integration-icon">{integration.provider === "ONSHAPE" ? "O" : "N"}</div>
        <div><h3>{integration.provider === "ONSHAPE" ? "Onshape" : "Notion"}</h3><p>{integration.externalDisplayName ?? integration.externalEmail ?? "No account linked"}</p></div>
        <div className="row-actions"><span className={integration.status === "CONNECTED" ? "connection connected" : "connection"}>{integration.status === "CONNECTED" ? "Connected" : "Not connected"}</span>
          {integration.provider === "ONSHAPE" ? <button className="button" disabled={busy} onClick={() => {
            setBusy(true); setMessage(null);
            if (integration.status === "CONNECTED") {
              if (!window.confirm("Disconnect Onshape and remove its stored tokens?")) { setBusy(false); return; }
              void disconnectOnshape({}).then(() => setMessage({ kind: "success", text: "Onshape account disconnected." }))
                .catch((error: unknown) => setMessage({ kind: "error", text: error instanceof Error ? error.message : "Unable to disconnect Onshape." }))
                .finally(() => setBusy(false));
            } else {
              void beginOnshape({}).then(({ authorizationUrl }) => window.location.assign(authorizationUrl))
                .catch((error: unknown) => { setMessage({ kind: "error", text: error instanceof Error ? error.message : "Unable to start Onshape authorization." }); setBusy(false); });
            }
          }}>{integration.status === "CONNECTED" ? "Disconnect" : "Connect Onshape"}</button>
            : <button className="button" disabled title="Notion linking will be added later.">Coming soon</button>}
        </div></article>)}</div>
      <Notice>OAuth tokens are encrypted and stored only in Convex. They are never sent to the browser.</Notice>
    </article></section>
  </>;
}
