import { useMutation, useQuery } from "convex/react";
import { useState, type FormEvent } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Notice, PageHeader } from "../components/AppLayout";

export function CotsPage({ compact = false }: { compact?: boolean }) {
  const catalog = useQuery(api.cots.catalog);
  const [selectedTypeId, setSelectedTypeId] = useState<Id<"cotsTypes"> | null>(null);
  const content = selectedTypeId
    ? <CotsTypePage cotsTypeId={selectedTypeId} onBack={() => setSelectedTypeId(null)} compact={compact} />
    : <CotsCatalog catalog={catalog} onSelect={setSelectedTypeId} compact={compact} />;
  if (compact) return <div className="cots-compact">{content}</div>;
  return <>{!selectedTypeId && <PageHeader eyebrow="Inventory library" title="COTS" description="Browse commercial off-the-shelf components by type and see where every quantity is being used." />}{content}</>;
}

function CotsCatalog({ catalog, onSelect, compact }: {
  catalog: Array<{ id: Id<"cotsTypes">; name: string; icon: string; itemCount: number; totalQuantity: number }> | undefined;
  onSelect: (id: Id<"cotsTypes">) => void;
  compact: boolean;
}) {
  if (!catalog) return <p className="empty-state">Loading COTS types…</p>;
  if (catalog.length === 0) return <Notice>No active COTS types are configured. An administrator can add them in Admin → COTS.</Notice>;
  return <section className={compact ? "cots-grid cots-grid-compact" : "cots-grid"}>{catalog.map((type) =>
    <button className="cots-type-card" key={type.id} onClick={() => onSelect(type.id)}>
      <CotsIcon value={type.icon} label={type.name} />
      <span><strong>{type.name}</strong><small>{type.itemCount} item types · {type.totalQuantity} total units</small></span>
      <span className="cots-card-arrow" aria-hidden="true">→</span>
    </button>)}</section>;
}

function CotsTypePage({ cotsTypeId, onBack, compact }: { cotsTypeId: Id<"cotsTypes">; onBack: () => void; compact: boolean }) {
  const details = useQuery(api.cots.typeDetails, { cotsTypeId });
  const createItem = useMutation(api.cots.createItem);
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  if (details === undefined) return <p className="empty-state">Loading inventory…</p>;
  if (details === null) return <Notice kind="error">This COTS type is unavailable.</Notice>;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(null); const form = new FormData(event.currentTarget);
    try {
      await createItem({
        cotsTypeId,
        name: String(form.get("name") ?? ""),
        values: details!.fields.map((field) => ({ fieldDefinitionId: field.id, value: String(form.get(`field-${field.id}`) ?? "") })),
        quantities: details!.statuses.map((status) => ({ statusId: status.id, quantity: Number(form.get(`status-${status.id}`) ?? 0) })),
      });
      setShowAdd(false); setMessage({ kind: "success", text: "COTS item added." });
    } catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : "Unable to add this COTS item." }); }
    finally { setBusy(false); }
  }

  return <section className={compact ? "cots-detail cots-detail-compact" : "cots-detail"}>
    <header className="cots-detail-header"><button className="text-button" onClick={onBack}>← All COTS</button>
      <div><CotsIcon value={details.type.icon} label={details.type.name} /><span><p className="eyebrow">COTS type</p><h1>{details.type.name}</h1></span></div>
      <button className="button button-primary" onClick={() => { setShowAdd(true); setMessage(null); }}>Add</button></header>
    {message && <Notice kind={message.kind}>{message.text}</Notice>}
    {details.items.length === 0 ? <p className="empty-state panel">No {details.type.name.toLowerCase()} have been added yet.</p> :
      <div className="cots-item-list">{details.items.map((item) => <article key={item.id}>
        <div className="cots-item-heading"><h2>{item.name}</h2><div className="quantity-chips">{details.statuses.map((status) => {
          const quantity = item.quantities.find((row) => row.statusId === status.id)?.quantity ?? 0;
          return <span key={status.id}><strong>{quantity}</strong> {status.name.toLowerCase()}</span>;
        })}</div></div>
        {details.fields.length > 0 && <dl className="cots-values">{details.fields.map((field) => <div key={field.id}><dt>{field.label}</dt><dd>{item.values.find((row) => row.fieldDefinitionId === field.id)?.value ?? "—"}</dd></div>)}</dl>}
      </article>)}</div>}
    {showAdd && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && setShowAdd(false)}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="add-cots-title">
        <div className="panel-heading"><div><p className="eyebrow">New {details.type.name}</p><h2 id="add-cots-title">Add COTS item</h2></div>
          <button className="text-button" type="button" disabled={busy} onClick={() => setShowAdd(false)}>Close</button></div>
        <form className="form-stack" onSubmit={submit}>
          <label>Name<input name="name" required minLength={2} maxLength={160} placeholder={details.type.name === "Gears" ? "50T gear" : "Item name"} autoFocus /></label>
          {details.fields.map((field) => <label key={field.id}>{field.label}<input name={`field-${field.id}`} required maxLength={500} /></label>)}
          {details.statuses.length > 0 && <fieldset><legend>Quantity by status</legend><div className="cots-quantity-form">{details.statuses.map((status) => <label key={status.id}>{status.name}<input name={`status-${status.id}`} type="number" min={0} max={1000000} step={1} defaultValue={0} required /></label>)}</div></fieldset>}
          <div className="form-actions"><button className="button" type="button" disabled={busy} onClick={() => setShowAdd(false)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? "Adding…" : "Add"}</button></div>
        </form>
      </section></div>}
  </section>;
}

export function CotsIcon({ value, label }: { value: string; label: string }) {
  const isImage = /^(https?:\/\/|\/)/i.test(value);
  return <span className="cots-icon">{isImage ? <img src={value} alt={`${label} icon`} /> : <span aria-hidden="true">{value}</span>}</span>;
}
