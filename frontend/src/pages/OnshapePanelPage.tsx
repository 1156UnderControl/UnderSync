import { useAuthActions } from "@convex-dev/auth/react";
import { useAction, useQuery } from "convex/react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import logo from "../assets/undersync-logo.png";
import { CotsPage } from "./CotsPage";

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
  const options = useQuery(api.partsConfig.get);
  const registerPart = useAction(api.onshapeParts.register);
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
  const [methodId, setMethodId] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [mode, setMode] = useState<"parts" | "cots">("parts");
  const onshapeLinked = profile.integrations.some((item) => item.provider === "ONSHAPE" && item.status === "CONNECTED");
  const compatibleMaterials = useMemo(() => options?.materials.filter((material) =>
    material.active && material.methodIds.includes(methodId as Id<"manufacturingMethods">)) ?? [], [methodId, options]);

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
      setPanelError(""); setSelection(next); setResult(null); setMethodId("");
    }
    window.addEventListener("message", receive);
    window.parent.postMessage({ messageName: "applicationInit", documentId: context.documentId,
      workspaceId: context.workspaceId, elementId: context.elementId }, origin);
    return () => window.removeEventListener("message", receive);
  }, [context]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selection) return;
    if (!selection.microversionId) { setResult({ kind: "error", text: "Onshape did not provide the selected microversion. Reselect the part and try again." }); return; }
    setBusy(true); setResult(null);
    const form = new FormData(event.currentTarget);
    try {
      const registered = await registerPart({
        documentId: context.documentId, workspaceId: context.workspaceId, elementId: context.elementId,
        microversionId: selection.microversionId, selectionId: selection.selectionId,
        selectionType: selection.selectionType || "ENTITY",
        ...(selection.entityType ? { entityType: selection.entityType } : {}),
        ...(context.configuration ? { configuration: context.configuration } : {}),
        name: String(form.get("name") ?? ""), quantity: Number(form.get("quantity")),
        subsystemId: String(form.get("subsystemId")) as Id<"subsystems">,
        designerId: String(form.get("designerId")) as Id<"users">,
        manufacturingMethodId: String(form.get("methodId")) as Id<"manufacturingMethods">,
        materialId: String(form.get("materialId")) as Id<"materials">,
      });
      setResult({
        kind: registered.renameStatus === "SUCCEEDED" ? "success" : "error",
        text: registered.renameStatus === "SUCCEEDED"
          ? `Registered ${registered.trackingCode}. Onshape name: ${registered.onshapeName}`
          : registered.warning ?? `Registered ${registered.trackingCode}, but the Onshape rename failed.`,
      });
    } catch (error) {
      setResult({ kind: "error", text: error instanceof Error ? error.message : "Unable to register this Onshape part." });
    } finally { setBusy(false); }
  }

  return <main className="onshape-panel-shell">
    <header className="panel-brand"><img src={logo} alt="" /><div><strong>UnderSync</strong><small>{mode === "cots" ? "COTS Inventory" : "Onshape Parts Tracking"}</small></div>
      <button className={`panel-cots-button ${mode === "cots" ? "active" : ""}`} onClick={() => setMode("cots")}>COTS</button>
      <button className="text-button" onClick={() => void signOut()}>Sign out</button></header>
    <section className="panel-user"><span>Signed in as</span><strong>{profile.user.displayName}</strong></section>
    {mode === "cots" && <><button className="text-button panel-back-button" onClick={() => setMode("parts")}>← Parts Tracking</button><CotsPage compact /></>}
    {mode === "parts" && <>{!onshapeLinked && <section className="panel-alert"><strong>Onshape account not linked</strong><p>Open UnderSync in a full browser tab and link this account before resolving or renaming selected parts.</p>
      <a className="button button-primary" href="/account" target="_blank" rel="noreferrer">Open account settings</a></section>}
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
    {selection && onshapeLinked && <section className="panel-card"><p className="eyebrow">2 · Register part</p><h1>{options?.settings.title ?? "Register part"}</h1>
      {!options ? <p className="muted">Loading form configuration…</p> : <form className="panel-form-grid" onSubmit={submit}>
        <label>{options.settings.nameLabel}<input name="name" required minLength={2} maxLength={160} placeholder="Camera mount" /></label>
        <label>{options.settings.quantityLabel}<input name="quantity" type="number" min={1} max={10000} defaultValue={1} required /></label>
        <label>{options.settings.subsystemLabel}<select name="subsystemId" required defaultValue=""><option value="" disabled>Select…</option>{options.subsystems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>{options.settings.designerLabel}<select name="designerId" required defaultValue=""><option value="" disabled>Select…</option>{options.designers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>{options.settings.methodLabel}<select name="methodId" required value={methodId} onChange={(event) => setMethodId(event.target.value)}><option value="" disabled>Select…</option>{options.methods.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {methodId && <label>{options.settings.materialLabel}<select name="materialId" required defaultValue=""><option value="" disabled>Select compatible material…</option>{compatibleMaterials.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        {result && <div className={`notice notice-${result.kind}`}>{result.text}</div>}
        <button className="button button-primary" disabled={busy || !methodId}>{busy ? "Resolving and registering…" : options.settings.submitLabel}</button>
      </form>}
    </section>}</>}
  </main>;
}
