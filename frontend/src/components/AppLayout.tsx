import { useAuthActions } from "@convex-dev/auth/react";
import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import logo from "../assets/undersync-logo.png";

export type PageKey = "dashboard" | "parts" | "buy" | "cots" | "account" | "admin";
type User = { id: string; displayName: string; username: string; appRole: "ADMIN" | "MEMBER"; measurementUnit: "MM" | "IN"; numberFormat: "DECIMAL" | "FRACTION" };
const navigation: Array<{ key: PageKey; label: string; icon: string }> = [
  { key: "dashboard", label: "Dashboard", icon: "⌂" }, { key: "parts", label: "Parts Tracking", icon: "◇" },
  { key: "buy", label: "Buy List", icon: "+" },
  { key: "cots", label: "COTS", icon: "▦" },
  { key: "account", label: "Account", icon: "○" }, { key: "admin", label: "Admin", icon: "⚙" },
];

export function AppLayout({ user, page, onNavigate, children }: { user: User; page: PageKey; onNavigate: (page: PageKey) => void; children: ReactNode }) {
  const { signOut } = useAuthActions();
  const branding = useQuery(api.system.branding);
  const updatePreferences = useMutation(api.profiles.updatePreferences);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setSettingsError("");
    const form = new FormData(event.currentTarget);
    try {
      await updatePreferences({ measurementUnit: String(form.get("measurementUnit")) as "MM" | "IN", numberFormat: String(form.get("numberFormat")) as "DECIMAL" | "FRACTION" });
      setSettingsOpen(false);
    } catch (error) { setSettingsError(error instanceof Error ? error.message : "Unable to save settings."); }
    finally { setSaving(false); }
  }
  return <div className="app-frame">
    <header className="topbar">
      <button className="brand" onClick={() => onNavigate("dashboard")} aria-label="UnderSync dashboard">
        <img src={logo} alt={branding?.appName ?? "UnderSync"} /><span><strong>{branding?.appName ?? "UnderSync"}</strong><small>{branding?.organizationName ?? "FRC 1156 · Under Control"}</small></span>
      </button>
      <div className="topbar-user"><span className="avatar">{user.displayName.slice(0, 1).toUpperCase()}</span>
        <span className="user-copy"><strong>{user.displayName}</strong><small>@{user.username}</small></span>
        <button className="settings-gear" aria-label="User settings" title="User settings" onClick={() => { setSettingsError(""); setSettingsOpen(true); }}>⚙</button>
        <button className="button button-quiet" onClick={() => void signOut()}>Sign out</button></div>
    </header>
    <aside className="sidebar" aria-label="Main navigation"><nav>
      {navigation.filter((item) => item.key !== "admin" || user.appRole === "ADMIN").map((item) =>
        <button key={item.key} className={page === item.key ? "nav-item active" : "nav-item"} onClick={() => onNavigate(item.key)}>
          <span aria-hidden="true">{item.icon}</span>{item.label}</button>)}
    </nav><div className="team-chip"><span>1156</span><p>One team<br /><strong>Under Control</strong></p></div></aside>
    <main className="main-content">{children}</main>
    {settingsOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !saving && setSettingsOpen(false)}>
      <section className="modal-card settings-modal" role="dialog" aria-modal="true" aria-labelledby="user-settings-title">
        <div className="panel-heading"><div><p className="eyebrow">Personal display</p><h2 id="user-settings-title">User settings</h2></div><button className="text-button" disabled={saving} onClick={() => setSettingsOpen(false)}>Close</button></div>
        <form className="form-stack" onSubmit={saveSettings}>
          <label>Measurement unit<select name="measurementUnit" defaultValue={user.measurementUnit}><option value="MM">Millimeters (mm)</option><option value="IN">Inches (in)</option></select></label>
          <label>Inch number format<select name="numberFormat" defaultValue={user.numberFormat}><option value="DECIMAL">Decimal (.25 in)</option><option value="FRACTION">Fraction (¼ in)</option></select></label>
          <p className="muted">UnderSync stores measurements in millimeters. Values converted to inches are marked with an asterisk (*).</p>
          {settingsError && <Notice kind="error">{settingsError}</Notice>}
          <div className="form-actions"><button type="button" className="button" disabled={saving} onClick={() => setSettingsOpen(false)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Saving…" : "Save settings"}</button></div>
        </form>
      </section>
    </div>}
  </div>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <header className="page-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{actions && <div className="header-actions">{actions}</div>}</header>;
}
export function Notice({ children, kind = "info" }: { children: ReactNode; kind?: "info" | "success" | "error" }) {
  return <div className={`notice notice-${kind}`} role={kind === "error" ? "alert" : "status"}>{children}</div>;
}
