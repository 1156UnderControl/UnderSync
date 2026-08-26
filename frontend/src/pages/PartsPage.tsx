import { useMutation, useQuery } from "convex/react";
import { useMemo, useState, type FormEvent } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Notice, PageHeader } from "../components/AppLayout";

export function PartsPage() {
  const options = useQuery(api.partsConfig.get); const parts = useQuery(api.parts.listRecent); const createPart = useMutation(api.parts.create);
  const [methodId, setMethodId] = useState(""); const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const compatibleMaterials = useMemo(() => options?.materials.filter((material) => material.active && material.methodIds.includes(methodId as Id<"manufacturingMethods">)) ?? [], [options, methodId]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(null); const form = new FormData(event.currentTarget);
    try {
      const result = await createPart({ name: String(form.get("name") ?? ""), quantity: Number(form.get("quantity")),
        subsystemId: String(form.get("subsystemId")) as Id<"subsystems">, designerId: String(form.get("designerId")) as Id<"users">,
        manufacturingMethodId: String(form.get("methodId")) as Id<"manufacturingMethods">, materialId: String(form.get("materialId")) as Id<"materials"> });
      setMessage({ kind: "success", text: `Registered ${result.trackingCode}. Onshape name: ${result.onshapeName}` });
      event.currentTarget.reset(); setMethodId("");
    } catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : "Unable to register the part." }); }
    finally { setBusy(false); }
  }
  return <><PageHeader eyebrow="Engineering identity" title="Parts Tracking" description="Register a design definition and allocate its permanent Team 1156 tracking ID." />
    <section className="parts-layout"><article className="panel form-panel"><div className="panel-heading"><div><p className="eyebrow">New definition</p><h2>{options?.settings.title ?? "Register part"}</h2></div></div>
      {!options ? <p className="empty-state">Loading form configuration…</p> : <form className="form-grid" onSubmit={submit}>
        <label className="span-2">{options.settings.nameLabel}<input name="name" required minLength={2} maxLength={160} placeholder="Camera mount" /></label>
        <label>{options.settings.quantityLabel}<input name="quantity" type="number" min={1} max={10000} defaultValue={1} required /></label>
        <label>{options.settings.subsystemLabel}<select name="subsystemId" required defaultValue=""><option value="" disabled>Select…</option>{options.subsystems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>{options.settings.designerLabel}<select name="designerId" required defaultValue=""><option value="" disabled>Select…</option>{options.designers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>{options.settings.methodLabel}<select name="methodId" required value={methodId} onChange={(event) => setMethodId(event.target.value)}><option value="" disabled>Select…</option>{options.methods.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {methodId && <label className="span-2">{options.settings.materialLabel}<select name="materialId" required defaultValue=""><option value="" disabled>Select compatible material…</option>{compatibleMaterials.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        {message && <div className="span-2"><Notice kind={message.kind}>{message.text}</Notice></div>}
        <div className="span-2 form-actions"><button className="button button-primary" disabled={busy || !methodId}>{busy ? "Registering…" : options.settings.submitLabel}</button></div>
      </form>}
    </article>
    <article className="panel"><div className="panel-heading"><div><p className="eyebrow">Registry</p><h2>Recent parts</h2></div><span className="count-badge">{parts?.length ?? 0}</span></div>
      {!parts ? <p className="empty-state">Loading registry…</p> : parts.length === 0 ? <p className="empty-state">The first tracked part will appear here.</p> :
        <div className="part-list">{parts.map((part) => <article key={part.id}><div><span className="code-badge">{part.trackingCode}</span><h3>{part.name}</h3>
          <p>{part.subsystem} · {part.method} · {part.material}</p></div><div className="part-meta"><strong>×{part.quantity}</strong><small>{part.designer}</small></div></article>)}</div>}
    </article></section>
  </>;
}
