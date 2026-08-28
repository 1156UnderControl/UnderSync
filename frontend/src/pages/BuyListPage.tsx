import { useMutation, useQuery } from "convex/react";
import { useState, type FormEvent } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Notice, PageHeader } from "../components/AppLayout";
import { CotsIcon } from "./CotsPage";

export function BuyListPage({ isAdmin }: { isAdmin: boolean }) {
  const catalog = useQuery(api.buyList.catalog);
  const settings = useQuery(api.buyList.settings);
  const [selectedTypeId, setSelectedTypeId] = useState<Id<"buyListTypes"> | null>(null);
  if (selectedTypeId) return <BuyListTypePage buyListTypeId={selectedTypeId} onBack={() => setSelectedTypeId(null)} isAdmin={isAdmin} addLabel={settings?.addLabel ?? "Add item"} />;
  return <>
    <PageHeader eyebrow="Purchasing" title={settings?.title ?? "Buy List"} description={settings?.description ?? "Organize everything the team needs to purchase."} />
    {!catalog ? <p className="empty-state">Loading buy-list categories…</p> : catalog.length === 0
      ? <Notice>No active categories are configured. An administrator can add them in Admin → Buy List.</Notice>
      : <section className="cots-grid">{catalog.map((type) => <button className="cots-type-card" key={type.id} onClick={() => setSelectedTypeId(type.id)}>
        <CotsIcon value={type.icon} label={type.name} /><span><strong>{type.name}</strong><small>{type.itemCount} entries · {type.totalQuantity} units requested</small></span><span className="cots-card-arrow">→</span>
      </button>)}</section>}
  </>;
}

function BuyListTypePage({ buyListTypeId, onBack, isAdmin, addLabel }: { buyListTypeId: Id<"buyListTypes">; onBack: () => void; isAdmin: boolean; addLabel: string }) {
  const details = useQuery(api.buyList.typeDetails, { buyListTypeId });
  const createItem = useMutation(api.buyList.createItem);
  const setPurchased = useMutation(api.buyList.setPurchased);
  const deleteItem = useMutation(api.buyList.deleteItem);
  const [showAdd, setShowAdd] = useState(false); const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  if (details === undefined) return <p className="empty-state">Loading buy list…</p>;
  if (details === null) return <Notice kind="error">This buy-list category is unavailable.</Notice>;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(null); const form = new FormData(event.currentTarget);
    try {
      await createItem({ buyListTypeId, name: String(form.get("name") ?? ""), quantity: Number(form.get("quantity")),
        values: details!.fields.map((field) => ({ fieldDefinitionId: field.id, value: String(form.get(`field-${field.id}`) ?? "") })) });
      setShowAdd(false); setMessage({ kind: "success", text: "Item added to the buy list." });
    } catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : "Unable to add this item." }); }
    finally { setBusy(false); }
  }

  return <section className="cots-detail"><header className="cots-detail-header"><button className="text-button" onClick={onBack}>← All categories</button>
    <div><CotsIcon value={details.type.icon} label={details.type.name} /><span><p className="eyebrow">Buy-list category</p><h1>{details.type.name}</h1></span></div>
    <button className="button button-primary" onClick={() => { setShowAdd(true); setMessage(null); }}>{addLabel}</button></header>
    {message && <Notice kind={message.kind}>{message.text}</Notice>}
    {details.items.length === 0 ? <p className="empty-state panel">No items are currently requested.</p> : <div className="cots-item-list">{details.items.map((item) => <article key={item.id} className={item.purchased ? "item-complete" : ""}>
      <div className="cots-item-heading"><div><h2>{item.name}</h2><small>Quantity {item.quantity}</small></div><div className="row-actions">
        <button className="button button-small" onClick={() => void setPurchased({ itemId: item.id, purchased: !item.purchased }).catch((error: unknown) => setMessage({ kind: "error", text: error instanceof Error ? error.message : "Unable to update item." }))}>{item.purchased ? "Mark needed" : "Mark purchased"}</button>
        {isAdmin && <button className="button button-small button-danger" onClick={() => { if (window.confirm(`Delete ${item.name}?`)) void deleteItem({ itemId: item.id }).catch((error: unknown) => setMessage({ kind: "error", text: error instanceof Error ? error.message : "Unable to delete item." })); }}>Delete</button>}
      </div></div>
      {details.fields.length > 0 && <dl className="cots-values">{details.fields.map((field) => { const value = item.values.find((row) => row.fieldDefinitionId === field.id)?.value; return <div key={field.id}><dt>{field.label}</dt><dd>{field.fieldType === "BOOLEAN" ? value === "true" ? "Yes" : "No" : value ?? "—"}</dd></div>; })}</dl>}
    </article>)}</div>}
    {showAdd && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && setShowAdd(false)}><section className="modal-card" role="dialog" aria-modal="true">
      <div className="panel-heading"><div><p className="eyebrow">New request</p><h2>{addLabel}</h2></div><button className="text-button" disabled={busy} onClick={() => setShowAdd(false)}>Close</button></div>
      <form className="form-stack" onSubmit={submit}><label>Name<input name="name" required minLength={2} maxLength={160} autoFocus /></label>
        <label>Quantity<input name="quantity" type="number" min={1} max={1000000} defaultValue={1} required /></label>
        {details.fields.map((field) => <label key={field.id}>{field.label}{field.fieldType === "BOOLEAN"
          ? <select name={`field-${field.id}`} defaultValue="" required><option value="" disabled>Select…</option><option value="true">Yes</option><option value="false">No</option></select>
          : <input name={`field-${field.id}`} required maxLength={500} />}</label>)}
        <div className="form-actions"><button className="button" type="button" disabled={busy} onClick={() => setShowAdd(false)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? "Adding…" : addLabel}</button></div>
      </form></section></div>}
  </section>;
}
