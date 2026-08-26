import { useAuthActions } from "@convex-dev/auth/react";
import { useEffect, useMemo, useState } from "react";
import logo from "../assets/undersync-logo.png";

type PanelProfile = {
  user: { displayName: string };
  integrations: Array<{ provider: "ONSHAPE" | "NOTION"; status: string }>;
};

type Selection = {
  selectionId: string;
  selectionType: string;
  entityType: string;
  microversionId: string;
};

function extensionValue(value: string | null) {
  const text = value?.trim() ?? "";
  return !text || /^\{\$[A-Za-z][A-Za-z0-9]*\}$/.test(text) ? "" : text;
}

function trustedOnshapeOrigin(server: string) {
  try {
    const url = new URL(server);
    if (url.protocol !== "https:" || (url.hostname !== "onshape.com" && !url.hostname.endsWith(".onshape.com"))) return null;
    return url.origin;
  } catch { return null; }
}

export function OnshapePanelPage({ profile }: { profile: PanelProfile }) {
  const { signOut } = useAuthActions();
  const context = useMemo(() => {
    const query = new URL(window.location.href).searchParams;
    return {
      server: extensionValue(query.get("server")) || "https://cad.onshape.com",
      documentId: extensionValue(query.get("documentId")),
      workspaceOrVersion: extensionValue(query.get("workspaceOrVersion")),
      workspaceId: extensionValue(query.get("workspaceOrVersionId")) || extensionValue(query.get("workspaceId")),
      elementId: extensionValue(query.get("elementId")),
      configuration: extensionValue(query.get("configuration")),
    };
  }, []);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [panelError, setPanelError] = useState("");
  const onshapeLinked = profile.integrations.some((item) => item.provider === "ONSHAPE" && item.status === "CONNECTED");

  useEffect(() => {
    const origin = trustedOnshapeOrigin(context.server);
    if (!origin) { setPanelError("The Action URL did not provide a trusted Onshape server."); return; }
    if (!context.documentId || !context.workspaceId || !context.elementId) {
      setPanelError("The Action URL is missing document, workspace/version, or element parameters."); return;
    }
    function receive(event: MessageEvent) {
      if (event.origin !== origin || typeof event.data !== "object" || event.data === null || event.data.messageName !== "SELECTION") return;
      const message = event.data as Record<string, unknown>;
      const candidates = Array.isArray(message.selections) ? message.selections : Array.isArray(message.selection) ? message.selection : [];
      if (candidates.length !== 1) { setSelection(null); setPanelError("Select exactly one body, face, or edge."); return; }
      const selected = candidates[0] as Record<string, unknown>;
      const value = (input: unknown) => extensionValue(typeof input === "string" ? input : null);
      const next = {
        selectionId: value(selected.selectionId), selectionType: value(selected.selectionType), entityType: value(selected.entityType),
        microversionId: value(selected.workspaceMicroversionId) || value(message.workspaceMicroversionId) || value(message.microversionId),
      };
      if (!next.selectionId) { setSelection(null); setPanelError("Onshape did not provide an identifier for this selection."); return; }
      setPanelError(""); setSelection(next);
    }
    window.addEventListener("message", receive);
    window.parent.postMessage({ messageName: "applicationInit", documentId: context.documentId,
      workspaceId: context.workspaceId, elementId: context.elementId }, origin);
    return () => window.removeEventListener("message", receive);
  }, [context]);

  return <main className="onshape-panel-shell">
    <header className="panel-brand"><img src={logo} alt="" /><div><strong>UnderSync</strong><small>Onshape Parts Tracking</small></div>
      <button className="text-button" onClick={() => void signOut()}>Sign out</button></header>
    <section className="panel-user"><span>Signed in as</span><strong>{profile.user.displayName}</strong></section>
    {!onshapeLinked && <section className="panel-alert"><strong>Onshape account not linked</strong><p>Open UnderSync in a full browser tab and link this account before resolving or renaming selected parts.</p>
      <a className="button button-primary" href="/" target="_blank" rel="noreferrer">Open account settings</a></section>}
    <section className="panel-card"><p className="eyebrow">1 · Select in Onshape</p><h1>{selection ? "Part selection received" : "Select one part"}</h1>
      <p className="muted">Choose one body, face, or edge in the current Part Studio.</p>
      {panelError && <div className="notice notice-error">{panelError}</div>}
      {selection && <dl className="selection-data"><div><dt>Selection ID</dt><dd>{selection.selectionId}</dd></div>
        <div><dt>Type</dt><dd>{selection.selectionType || selection.entityType || "ENTITY"}</dd></div>
        <div><dt>Microversion</dt><dd>{selection.microversionId || "Not provided"}</dd></div></dl>}
    </section>
    <section className="panel-card panel-context"><p className="eyebrow">Onshape context</p>
      <dl className="selection-data"><div><dt>Document</dt><dd>{context.documentId || "Missing"}</dd></div>
        <div><dt>Workspace/version</dt><dd>{context.workspaceId || "Missing"}</dd></div><div><dt>Element</dt><dd>{context.elementId || "Missing"}</dd></div></dl>
    </section>
    {selection && onshapeLinked && <div className="notice">Selection messaging is connected. Cloud API resolution and registration will be enabled after the Onshape OAuth callback is migrated to Convex.</div>}
  </main>;
}
