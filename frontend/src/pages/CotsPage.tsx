import { useMutation, useQuery } from "convex/react";
import { useMemo, useState, type FormEvent } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Notice, PageHeader } from "../components/AppLayout";
import { formatMeasurement, measurementInputValue, toMillimeters, type MeasurementPreferences } from "../measurements";

const defaultPreferences: MeasurementPreferences = { measurementUnit: "MM", numberFormat: "DECIMAL" };

export function CotsPage({ compact = false, isAdmin = false, preferences = defaultPreferences }: {
  compact?: boolean; isAdmin?: boolean; preferences?: MeasurementPreferences;
}) {
  const catalog = useQuery(api.cots.catalog);
  const [selectedTypeId, setSelectedTypeId] = useState<Id<"cotsTypes"> | null>(null);
  const content = selectedTypeId
    ? <CotsTypePage cotsTypeId={selectedTypeId} onBack={() => setSelectedTypeId(null)} compact={compact} isAdmin={isAdmin} preferences={preferences} />
    : <CotsCatalog catalog={catalog} onSelect={setSelectedTypeId} compact={compact} />;
  if (compact) return <div className="cots-compact">{content}</div>;
  return <>{!selectedTypeId && <PageHeader eyebrow="Inventory library" title="COTS" description="Browse commercial off-the-shelf components by type and see where every quantity is being used." />}{content}</>;
}

function CotsCatalog({ catalog, onSelect, compact }: {
  catalog: Array<{ id: Id<"cotsTypes">; name: string; icon: string; itemCount: number; totalQuantity: number }> | undefined;
  onSelect: (id: Id<"cotsTypes">) => void; compact: boolean;
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

function CotsTypePage({ cotsTypeId, onBack, compact, isAdmin, preferences }: {
  cotsTypeId: Id<"cotsTypes">; onBack: () => void; compact: boolean; isAdmin: boolean; preferences: MeasurementPreferences;
}) {
  const details = useQuery(api.cots.typeDetails, { cotsTypeId });
  const createItem = useMutation(api.cots.createItem);
  const updateItem = useMutation(api.cots.updateItem);
  const deleteItem = useMutation(api.cots.deleteItem);
  const [formMode, setFormMode] = useState<{ kind: "add" } | { kind: "edit"; itemId: Id<"cotsItems"> } | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const filteredItems = useMemo(() => {
    if (!details) return [];
    return details.items.filter((item) => details.fields.every((field) => {
      const filter = filters[field.id]?.trim();
      if (!filter) return true;
      const value = item.values.find((row) => row.fieldDefinitionId === field.id)?.value ?? "";
      if (field.fieldType === "STRING") return value.toLowerCase().includes(filter.toLowerCase());
      if (field.fieldType === "MEASUREMENT") return Math.abs(Number(value) - toMillimeters(Number(filter), preferences.measurementUnit)) < 0.001;
      return value === filter;
    }));
  }, [details, filters, preferences.measurementUnit]);
  if (details === undefined) return <p className="empty-state">Loading inventory…</p>;
  if (details === null) return <Notice kind="error">This COTS type is unavailable.</Notice>;
  const editingItem = formMode?.kind === "edit" ? details.items.find((item) => item.id === formMode.itemId) : undefined;
  const hasFilters = Object.values(filters).some(Boolean);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(null); const form = new FormData(event.currentTarget);
    const values = details!.fields.map((field) => {
      const input = String(form.get(`field-${field.id}`) ?? "");
      return { fieldDefinitionId: field.id, value: field.fieldType === "MEASUREMENT"
        ? String(toMillimeters(Number(input), preferences.measurementUnit)) : input };
    });
    const quantities = details!.statuses.map((status) => ({ statusId: status.id, quantity: Number(form.get(`status-${status.id}`) ?? 0) }));
    try {
      if (formMode?.kind === "edit") await updateItem({ itemId: formMode.itemId, values, quantities });
      else await createItem({ cotsTypeId, values, quantities });
      setFormMode(null); setMessage({ kind: "success", text: formMode?.kind === "edit" ? "COTS item updated." : "COTS item added with its generated code." });
    } catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : "Unable to save this COTS item." }); }
    finally { setBusy(false); }
  }

  function displayValue(field: NonNullable<typeof details>["fields"][number], value: string | undefined) {
    if (field.fieldType === "BOOLEAN") return value === "true" ? "Yes" : "No";
    if (field.fieldType === "SELECT") return field.options.find((option) => option.value === value)?.label ?? value ?? "—";
    if (field.fieldType === "MEASUREMENT") return value === undefined ? "—" : formatMeasurement(value, preferences);
    return value ?? "—";
  }

  return <section className={compact ? "cots-detail cots-detail-compact" : "cots-detail"}>
    <header className="cots-detail-header"><button className="text-button" onClick={onBack}>← All COTS</button>
      <div><CotsIcon value={details.type.icon} label={details.type.name} /><span><p className="eyebrow">COTS type</p><h1>{details.type.name}</h1></span></div>
      <div className="row-actions"><button className={`button ${hasFilters ? "button-primary" : ""}`} onClick={() => setShowFilters(true)}>Filters{hasFilters ? " •" : ""}</button>
        <button className="button button-primary" onClick={() => { setFormMode({ kind: "add" }); setMessage(null); }}>Add</button></div></header>
    {message && <Notice kind={message.kind}>{message.text}</Notice>}
    {preferences.measurementUnit === "IN" && details.fields.some((field) => field.fieldType === "MEASUREMENT") && <p className="conversion-note">* Converted from the stored millimeter value.</p>}
    {filteredItems.length === 0 ? <p className="empty-state panel">{hasFilters ? "No COTS items match these filters." : `No ${details.type.name.toLowerCase()} have been added yet.`}</p> :
      <div className="cots-item-list">{filteredItems.map((item) => <article key={item.id}>
        <div className="cots-item-heading"><h2>{item.code}</h2><div className="row-actions"><div className="quantity-chips">{details.statuses.map((status) => {
          const quantity = item.quantities.find((row) => row.statusId === status.id)?.quantity ?? 0;
          return <span key={status.id}><strong>{quantity}</strong> {status.name.toLowerCase()}</span>;
        })}</div><button className="button button-small" onClick={() => { setFormMode({ kind: "edit", itemId: item.id }); setMessage(null); }}>Edit</button>
          {isAdmin && <button className="button button-small button-danger" onClick={() => {
            if (!window.confirm(`Delete ${item.code}? This cannot be undone.`)) return;
            setMessage(null); void deleteItem({ itemId: item.id }).then(() => setMessage({ kind: "success", text: "COTS item deleted." }))
              .catch((error: unknown) => setMessage({ kind: "error", text: error instanceof Error ? error.message : "Unable to delete this item." }));
          }}>Delete</button>}</div></div>
        {details.fields.length > 0 && <dl className="cots-values">{details.fields.map((field) => <div key={field.id}><dt>{field.label}</dt><dd>{displayValue(field, item.values.find((row) => row.fieldDefinitionId === field.id)?.value)}</dd></div>)}</dl>}
      </article>)}</div>}
    {formMode && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && setFormMode(null)}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="cots-form-title">
        <div className="panel-heading"><div><p className="eyebrow">{formMode.kind === "edit" ? editingItem?.code : `New ${details.type.name}`}</p><h2 id="cots-form-title">{formMode.kind === "edit" ? "Edit COTS item" : "Add COTS item"}</h2></div>
          <button className="text-button" type="button" disabled={busy} onClick={() => setFormMode(null)}>Close</button></div>
        <form className="form-stack" onSubmit={submit}>
          <p className="generated-code-hint">The item code is generated from the type and answers below.</p>
          {details.fields.map((field, index) => {
            const savedValue = editingItem?.values.find((row) => row.fieldDefinitionId === field.id)?.value;
            return <label key={field.id}>{field.label}{field.fieldType === "BOOLEAN"
              ? <select name={`field-${field.id}`} required defaultValue={savedValue ?? ""} autoFocus={index === 0}><option value="" disabled>Select…</option><option value="true">Yes</option><option value="false">No</option></select>
              : field.fieldType === "SELECT" ? <select name={`field-${field.id}`} required defaultValue={savedValue ?? ""} autoFocus={index === 0}><option value="" disabled>Select…</option>{field.options.map((option) => <option key={option.id} value={option.value}>{option.label}</option>)}</select>
              : field.fieldType === "MEASUREMENT" ? <span className="input-with-unit"><input name={`field-${field.id}`} type="number" min={0} max={1000000} step="any" required defaultValue={savedValue === undefined ? "" : measurementInputValue(savedValue, preferences.measurementUnit)} autoFocus={index === 0} /><span>{preferences.measurementUnit === "MM" ? "mm" : "in"}</span></span>
              : <input name={`field-${field.id}`} required maxLength={500} defaultValue={savedValue ?? ""} autoFocus={index === 0} />}</label>;
          })}
          {details.statuses.length > 0 && <fieldset><legend>Quantity by status</legend><div className="cots-quantity-form">{details.statuses.map((status) => <label key={status.id}>{status.name}<input name={`status-${status.id}`} type="number" min={0} max={1000000} step={1} defaultValue={editingItem?.quantities.find((row) => row.statusId === status.id)?.quantity ?? 0} required /></label>)}</div></fieldset>}
          <div className="form-actions"><button className="button" type="button" disabled={busy} onClick={() => setFormMode(null)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? "Saving…" : formMode.kind === "edit" ? "Save changes" : "Add item"}</button></div>
        </form>
      </section></div>}
    {showFilters && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setShowFilters(false)}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="cots-filter-title">
      <div className="panel-heading"><div><p className="eyebrow">Inventory view</p><h2 id="cots-filter-title">Filter {details.type.name}</h2></div><button className="text-button" onClick={() => setShowFilters(false)}>Close</button></div>
      <form className="form-stack" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const next: Record<string, string> = {}; details.fields.forEach((field) => { next[field.id] = String(form.get(`filter-${field.id}`) ?? ""); }); setFilters(next); setShowFilters(false); }}>
        {details.fields.map((field) => <label key={field.id}>{field.label}{field.fieldType === "BOOLEAN"
          ? <select name={`filter-${field.id}`} defaultValue={filters[field.id] ?? ""}><option value="">Any</option><option value="true">Yes</option><option value="false">No</option></select>
          : field.fieldType === "SELECT" ? <select name={`filter-${field.id}`} defaultValue={filters[field.id] ?? ""}><option value="">Any</option>{field.options.map((option) => <option key={option.id} value={option.value}>{option.label}</option>)}</select>
          : <input name={`filter-${field.id}`} type={field.fieldType === "MEASUREMENT" ? "number" : "text"} step={field.fieldType === "MEASUREMENT" ? "any" : undefined} defaultValue={filters[field.id] ?? ""} placeholder={field.fieldType === "MEASUREMENT" ? preferences.measurementUnit.toLowerCase() : "Contains…"} />}</label>)}
        <div className="form-actions"><button className="button" type="button" onClick={() => { setFilters({}); setShowFilters(false); }}>Clear filters</button><button className="button button-primary">Apply filters</button></div>
      </form>
    </section></div>}
  </section>;
}

export function CotsIcon({ value, label }: { value: string; label: string }) {
  const isImage = /^(https?:\/\/|\/)/i.test(value);
  return <span className="cots-icon">{isImage ? <img src={value} alt={`${label} icon`} /> : <span aria-hidden="true">{value}</span>}</span>;
}
