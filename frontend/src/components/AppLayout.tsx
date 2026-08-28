import { useAuthActions } from "@convex-dev/auth/react";
import type { ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import logo from "../assets/undersync-logo.png";

export type PageKey = "dashboard" | "parts" | "buy" | "cots" | "account" | "admin";
type User = { id: string; displayName: string; username: string; appRole: "ADMIN" | "MEMBER" };
const navigation: Array<{ key: PageKey; label: string; icon: string }> = [
  { key: "dashboard", label: "Dashboard", icon: "⌂" }, { key: "parts", label: "Parts Tracking", icon: "◇" },
  { key: "buy", label: "Buy List", icon: "+" },
  { key: "cots", label: "COTS", icon: "▦" },
  { key: "account", label: "Account", icon: "○" }, { key: "admin", label: "Admin", icon: "⚙" },
];

export function AppLayout({ user, page, onNavigate, children }: { user: User; page: PageKey; onNavigate: (page: PageKey) => void; children: ReactNode }) {
  const { signOut } = useAuthActions();
  const branding = useQuery(api.system.branding);
  return <div className="app-frame">
    <header className="topbar">
      <button className="brand" onClick={() => onNavigate("dashboard")} aria-label="UnderSync dashboard">
        <img src={logo} alt={branding?.appName ?? "UnderSync"} /><span><strong>{branding?.appName ?? "UnderSync"}</strong><small>{branding?.organizationName ?? "FRC 1156 · Under Control"}</small></span>
      </button>
      <div className="topbar-user"><span className="avatar">{user.displayName.slice(0, 1).toUpperCase()}</span>
        <span className="user-copy"><strong>{user.displayName}</strong><small>@{user.username}</small></span>
        <button className="button button-quiet" onClick={() => void signOut()}>Sign out</button></div>
    </header>
    <aside className="sidebar" aria-label="Main navigation"><nav>
      {navigation.filter((item) => item.key !== "admin" || user.appRole === "ADMIN").map((item) =>
        <button key={item.key} className={page === item.key ? "nav-item active" : "nav-item"} onClick={() => onNavigate(item.key)}>
          <span aria-hidden="true">{item.icon}</span>{item.label}</button>)}
    </nav><div className="team-chip"><span>1156</span><p>One team<br /><strong>Under Control</strong></p></div></aside>
    <main className="main-content">{children}</main>
  </div>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <header className="page-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{actions && <div className="header-actions">{actions}</div>}</header>;
}
export function Notice({ children, kind = "info" }: { children: ReactNode; kind?: "info" | "success" | "error" }) {
  return <div className={`notice notice-${kind}`} role={kind === "error" ? "alert" : "status"}>{children}</div>;
}
