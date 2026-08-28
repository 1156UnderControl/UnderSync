import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { AuthPage } from "./pages/AuthPage";
import { DashboardPage } from "./pages/DashboardPage";
import { PartsPage } from "./pages/PartsPage";
import { CotsPage } from "./pages/CotsPage";
import { BuyListPage } from "./pages/BuyListPage";
import { AccountPage } from "./pages/AccountPage";
import { AdminPage } from "./pages/AdminPage";
import { OnshapePanelPage } from "./pages/OnshapePanelPage";
import { AppLayout, type PageKey } from "./components/AppLayout";

export function App() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading) return <LoadingScreen message="Loading UnderSync…" />;
  if (!isAuthenticated) return <AuthPage />;
  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  const [page, setPage] = useState<PageKey>(() => window.location.pathname === "/account" ? "account" : "dashboard");
  const [setupError, setSetupError] = useState("");
  const [setupComplete, setSetupComplete] = useState(false);
  const [authenticationTimedOut, setAuthenticationTimedOut] = useState(false);
  const { signOut } = useAuthActions();
  const ensureCurrent = useMutation(api.profiles.ensureCurrent);
  const serverAuthenticated = useQuery(api.auth.isAuthenticated);
  const profile = useQuery(api.profiles.current);

  useEffect(() => {
    if (serverAuthenticated !== true || setupComplete) return;
    let cancelled = false;
    void ensureCurrent({})
      .then(() => { if (!cancelled) setSetupComplete(true); })
      .catch((error: unknown) => {
        if (!cancelled) setSetupError(error instanceof Error ? error.message : "Unable to prepare this account.");
      });
    return () => { cancelled = true; };
  }, [ensureCurrent, serverAuthenticated, setupComplete]);

  useEffect(() => {
    if (serverAuthenticated === true) { setAuthenticationTimedOut(false); return; }
    const timer = window.setTimeout(() => setAuthenticationTimedOut(true), 8000);
    return () => window.clearTimeout(timer);
  }, [serverAuthenticated]);

  if (setupError) return <LoadingScreen message={setupError} error />;
  if (authenticationTimedOut) return <main className="center-screen"><section className="loading-card session-recovery" role="alert">
    <strong>Your session could not be verified.</strong><span>Reload the page. If this continues, sign out and enter your credentials again.</span>
    <div className="row-actions"><button className="button button-primary" onClick={() => window.location.reload()}>Reload</button>
      <button className="button" onClick={() => void signOut()}>Sign out</button></div>
  </section></main>;
  if (serverAuthenticated !== true || !setupComplete || profile === undefined || profile === null) {
    return <LoadingScreen message="Preparing your secure workspace…" />;
  }

  if (["/panel", "/onshape/panel"].includes(window.location.pathname)) {
    return <OnshapePanelPage profile={profile} />;
  }

  return (
    <AppLayout user={profile.user} page={page} onNavigate={setPage}>
      {page === "dashboard" && <DashboardPage user={profile.user} onNavigate={setPage} />}
      {page === "parts" && <PartsPage isAdmin={profile.user.appRole === "ADMIN"} />}
      {page === "buy" && <BuyListPage isAdmin={profile.user.appRole === "ADMIN"} />}
      {page === "cots" && <CotsPage isAdmin={profile.user.appRole === "ADMIN"} />}
      {page === "account" && <AccountPage profile={profile} />}
      {page === "admin" && profile.user.appRole === "ADMIN" && <AdminPage currentUserId={profile.user.id} />}
    </AppLayout>
  );
}

function LoadingScreen({ message, error = false }: { message: string; error?: boolean }) {
  return <main className="center-screen"><section className="loading-card" role={error ? "alert" : "status"}>
    <div className={`spinner ${error ? "spinner-error" : ""}`} /><strong>{message}</strong>
  </section></main>;
}

export function MissingConvexConfiguration() {
  return <LoadingScreen error message="Missing VITE_CONVEX_URL. Run npm run convex:dev first." />;
}
