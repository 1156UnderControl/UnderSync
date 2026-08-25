import type { ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="shell">
      <section className="card" aria-labelledby="page-title">
        <p className="eyebrow">FRC 1156 · Under Control</p>
        <h1 id="page-title">UnderSync</h1>
        {children}
      </section>
    </main>
  );
}

export function App() {
  const status = useQuery(api.system.status);

  return (
    <Shell>
      <p className="lede">The Vercel frontend and Convex backend foundation is ready.</p>
      <div className={`status ${status ? "connected" : "connecting"}`} role="status" aria-live="polite">
        <span className="status-dot" aria-hidden="true" />
        {status ? "Connected to Convex" : "Connecting to Convex…"}
      </div>
      {status && (
        <dl>
          <div><dt>Service</dt><dd>{status.service}</dd></div>
          <div><dt>Architecture</dt><dd>{status.architecture}</dd></div>
        </dl>
      )}
      <p className="note">Product features are intentionally not implemented in this infrastructure phase.</p>
    </Shell>
  );
}

export function MissingConvexConfiguration() {
  return (
    <Shell>
      <p className="lede">Convex is not configured for this environment.</p>
      <div className="status error" role="alert">
        <span className="status-dot" aria-hidden="true" />
        Missing VITE_CONVEX_URL
      </div>
      <p className="note">Run <code>npx convex dev</code> once to create the local development configuration.</p>
    </Shell>
  );
}
