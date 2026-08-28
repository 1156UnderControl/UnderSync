import { useAction, useMutation, useQuery } from "convex/react";
import { useMemo, useState, type FormEvent } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Notice, PageHeader } from "../components/AppLayout";

type Part = {
  id: Id<"parts">; trackingCode: string; name: string; quantity: number; subsystemId: Id<"subsystems">;
  subsystem: string; designerId: Id<"users">; designer: string; manufacturingMethodId: Id<"manufacturingMethods">;
  method: string; materialId: Id<"materials">; material: string; hasOnshapeSource: boolean;
};

export function PartsPage({ isAdmin }: { isAdmin: boolean }) {
  const catalog = useQuery(api.parts.catalog); const options = useQuery(api.partsConfig.get);
  const [subsystemId, setSubsystemId] = useState<Id<"subsystems"> | null>(null);
  const parts = useQuery(api.parts.listBySubsystem, subsystemId ? { subsystemId } : "skip");
  const updatePart = useMutation(api.parts.update); const deletePart = useMutation(api.parts.deletePart);
  const exportPart = useAction(api.onshapeDownloads.exportPart);
  const [editPart, setEditPart] = useState<Part | null>(null); const [downloadPart, setDownloadPart] = useState<Part | null>(null);
  const [methodId, setMethodId] = useState<Id<"manufacturingMethods"> | "">("");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const compatibleMaterials = useMemo(() => options?.materials.filter((material) => material.active && methodId && material.methodIds.includes(methodId)) ?? [], [methodId, options]);

  function beginEdit(part: Part) { setEditPart(part); setMethodId(part.manufacturingMethodId); setMessage(null); }
  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editPart) return; setBusy(true); setMessage(null); const form = new FormData(event.currentTarget);
    try {
      await updatePart({ partId: editPart.id, name: String(form.get("name")), quantity: Number(form.get("quantity")), subsystemId: String(form.get("subsystemId")) as Id<"subsystems">, designerId: String(form.get("designerId")) as Id<"users">, manufacturingMethodId: String(form.get("methodId")) as Id<"manufacturingMethods">, materialId: String(form.get("materialId")) as Id<"materials"> });
      setEditPart(null); setMessage({ kind: "success", text: `${editPart.trackingCode} updated.` });
    } catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : "Unable to update this part." }); }
    finally { setBusy(false); }
  }
  async function download(format: "STL" | "PARASOLID") {
    if (!downloadPart) return; setBusy(true); setMessage(null);
    try {
      const file = await exportPart({ partId: downloadPart.id, format });
      const link = document.createElement("a"); link.href = file.url; link.download = file.fileName; link.rel = "noreferrer";
      document.body.appendChild(link); link.click(); link.remove(); setDownloadPart(null);
      setMessage({ kind: "success", text: `${file.fileName} is ready.` });
    } catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : "Unable to export this part." }); }
    finally { setBusy(false); }
  }

  if (!subsystemId) return <><PageHeader eyebrow="Engineering registry" title="Parts Tracking" description="Browse parts registered from the Onshape panel, organized by robot subsystem." />
    {message && <Notice kind={message.kind}>{message.text}</Notice>}
    {!catalog ? <p className="empty-state">Loading subsystems…</p> : catalog.length === 0 ? <Notice>No active robot subsystems are configured.</Notice> : <section className="subsystem-grid">{catalog.map((subsystem) => <button className="subsystem-card" key={subsystem.id} onClick={() => setSubsystemId(subsystem.id)}><span>{subsystem.code}</span><strong>{subsystem.name}</strong><small>{subsystem.partCount} parts</small><i>→</i></button>)}</section>}
  </>;

  const subsystem = catalog?.find((row) => row.id === subsystemId);
  return <><PageHeader eyebrow="Parts Tracking" title={subsystem?.name ?? "Subsystem"} description="Parts uploaded from Onshape for this subsystem." actions={<button className="button" onClick={() => { setSubsystemId(null); setMessage(null); }}>← All subsystems</button>} />
    {message && <Notice kind={message.kind}>{message.text}</Notice>}
    {!parts ? <p className="empty-state">Loading parts…</p> : parts.length === 0 ? <p className="empty-state panel">No Onshape parts have been registered in this subsystem.</p> : <div className="part-registry">{parts.map((part) => <article key={part.id}><div><span className="code-badge">{part.trackingCode}</span><h2>{part.name}</h2><p>{part.designer} · {part.method} · {part.material} · Quantity {part.quantity}</p></div><div className="row-actions"><button className="button button-small" disabled={!part.hasOnshapeSource} title={part.hasOnshapeSource ? "Export from Onshape" : "This part has no complete Onshape source"} onClick={() => { setDownloadPart(part); setMessage(null); }}>Download files</button><button className="button button-small button-primary" onClick={() => beginEdit(part)}>Edit</button>{isAdmin && <button className="button button-small button-danger" onClick={() => { if (window.confirm(`Delete ${part.trackingCode}? This cannot be undone.`)) void deletePart({ partId: part.id }).then(() => setMessage({ kind: "success", text: "Part deleted." })).catch((error: unknown) => setMessage({ kind: "error", text: error instanceof Error ? error.message : "Unable to delete part." })); }}>Delete</button>}</div></article>)}</div>}
    {downloadPart && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && setDownloadPart(null)}><section className="modal-card" role="dialog" aria-modal="true"><div className="panel-heading"><div><p className="eyebrow">Onshape export</p><h2>{downloadPart.trackingCode}</h2></div><button className="text-button" disabled={busy} onClick={() => setDownloadPart(null)}>Close</button></div><p>Choose a real export generated from the linked Onshape part.</p><div className="download-options"><button className="button button-primary" disabled={busy} onClick={() => void download("STL")}><strong>STL</strong><small>Binary mesh · millimeters</small></button><button className="button" disabled={busy} onClick={() => void download("PARASOLID")}><strong>Parasolid</strong><small>Native geometry · .x_t</small></button></div>{busy && <p className="empty-state">Asking Onshape to generate the file…</p>}</section></div>}
    {editPart && options && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && setEditPart(null)}><section className="modal-card" role="dialog" aria-modal="true"><div className="panel-heading"><div><p className="eyebrow">Edit part</p><h2>{editPart.trackingCode}</h2></div><button className="text-button" disabled={busy} onClick={() => setEditPart(null)}>Close</button></div><form className="form-grid" onSubmit={submitEdit}>
      <label className="span-2">Name<input name="name" defaultValue={editPart.name} required minLength={2} maxLength={160} /></label><label>Quantity<input name="quantity" type="number" min={1} max={10000} defaultValue={editPart.quantity} required /></label><label>Subsystem<select name="subsystemId" defaultValue={editPart.subsystemId}>{options.subsystems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Designer<select name="designerId" defaultValue={editPart.designerId}>{options.designers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Method<select name="methodId" value={methodId} onChange={(event) => setMethodId(event.target.value as Id<"manufacturingMethods">)}>{options.methods.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="span-2">Material<select name="materialId" defaultValue={compatibleMaterials.some((item) => item.id === editPart.materialId) ? editPart.materialId : ""} required><option value="" disabled>Select compatible material…</option>{compatibleMaterials.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="span-2 form-actions"><button className="button" type="button" disabled={busy} onClick={() => setEditPart(null)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button></div>
    </form></section></div>}
  </>;
}
