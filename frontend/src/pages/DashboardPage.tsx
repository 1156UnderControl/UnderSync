import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { PageHeader, type PageKey } from "../components/AppLayout";

export function DashboardPage({ user, onNavigate }: { user: { displayName: string }; onNavigate: (page: PageKey) => void }) {
  const summary = useQuery(api.dashboard.summary);
  return <><PageHeader eyebrow="Team operations" title={`Hello, ${user.displayName}`} description="A live view of the UnderSync workspace." actions={
    <button className="button button-primary" onClick={() => onNavigate("parts")}>Register a part</button>} />
    <section className="metric-grid" aria-label="Workspace summary">
      <article className="metric-card"><span>Active members</span><strong>{summary?.users ?? "—"}</strong><small>Team accounts</small></article>
      <article className="metric-card"><span>Parts in development</span><strong>{summary?.parts ?? "—"}</strong><small>Tracked definitions</small></article>
      <article className="metric-card"><span>Fabrication methods</span><strong>{summary?.activeMethods ?? "—"}</strong><small>Active options</small></article>
      <article className="metric-card"><span>Materials</span><strong>{summary?.activeMaterials ?? "—"}</strong><small>Configured options</small></article>
    </section>
    <section className="content-grid">
      <article className="panel"><div className="panel-heading"><div><p className="eyebrow">Recently registered</p><h2>Parts</h2></div>
        <button className="text-button" onClick={() => onNavigate("parts")}>View all</button></div>
        {!summary ? <p className="empty-state">Loading parts…</p> : summary.recentParts.length === 0 ? <p className="empty-state">No parts registered yet.</p> :
          <div className="compact-list">{summary.recentParts.map((part) => <div key={part.trackingCode}><span className="code-badge">{part.trackingCode}</span>
            <p><strong>{part.name}</strong><small>Quantity {part.quantity}</small></p></div>)}</div>}
      </article>
      <article className="panel accent-panel"><p className="eyebrow">System status</p><h2>Everything is in sync</h2>
        <p>The interface is connected directly to Convex with reactive updates. PostgreSQL is no longer required for new work.</p>
        <div className="status-line"><span className="live-dot" />Convex backend connected</div></article>
    </section>
  </>;
}
