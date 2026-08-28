import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Notice } from "../components/AppLayout";
import { CotsIcon } from "./CotsPage";

type Flash = { kind: "success" | "error"; text: string } | null;
type FieldType = "STRING" | "BOOLEAN" | "SELECT" | "MEASUREMENT";

export function CotsAdminPage() {
  const config = useQuery(api.cotsAdmin.get);
  const addType = useMutation(api.cotsAdmin.addType); const updateType = useMutation(api.cotsAdmin.updateType); const deleteType = useMutation(api.cotsAdmin.deleteType);
  const addStatus = useMutation(api.cotsAdmin.addStatus); const updateStatus = useMutation(api.cotsAdmin.updateStatus); const deleteStatus = useMutation(api.cotsAdmin.deleteStatus);
  const addField = useMutation(api.cotsAdmin.addField); const updateField = useMutation(api.cotsAdmin.updateField); const deleteField = useMutation(api.cotsAdmin.deleteField);
  const addOption = useMutation(api.cotsAdmin.addOption); const updateOption = useMutation(api.cotsAdmin.updateOption); const deleteOption = useMutation(api.cotsAdmin.deleteOption);
  const [selectedTypeId, setSelectedTypeId] = useState<Id<"cotsTypes"> | null>(null);
  const [flash, setFlash] = useState<Flash>(null);
  useEffect(() => { if (!selectedTypeId && config?.types[0]) setSelectedTypeId(config.types[0].id); }, [config, selectedTypeId]);
  async function run(action: () => Promise<unknown>, success: string) {
    setFlash(null); try { await action(); setFlash({ kind: "success", text: success }); }
    catch (error) { setFlash({ kind: "error", text: error instanceof Error ? error.message : "The operation failed." }); }
  }
  if (!config) return <section className="panel"><p className="empty-state">Loading COTS configuration…</p></section>;
  const selectedType = config.types.find((type) => type.id === selectedTypeId) ?? null;
  const selectedFields = config.fields.filter((field) => field.cotsTypeId === selectedTypeId).sort((a, b) => a.sortOrder - b.sortOrder);

  return <div className="cots-admin-grid">
    {flash && <div className="span-all"><Notice kind={flash.kind}>{flash.text}</Notice></div>}
    <section className="panel"><div className="panel-heading"><div><p className="eyebrow">Catalog and generated codes</p><h2>COTS types</h2></div></div>
      <form className="cots-admin-add" onSubmit={(event) => { event.preventDefault(); const target = event.currentTarget; const form = new FormData(target);
        void run(() => addType({ name: String(form.get("name")), slug: String(form.get("slug")), code: String(form.get("code")), icon: String(form.get("icon")), sortOrder: Number(form.get("sortOrder")) }), "COTS type added.").then(() => target.reset()); }}>
        <input name="name" placeholder="Gears" required /><input name="slug" placeholder="gears" required /><input name="code" placeholder="GR" required />
        <input name="icon" placeholder="⚙ or https://…" required /><input name="sortOrder" type="number" min={0} defaultValue={10} required /><button className="button button-primary">Add type</button>
      </form>
      <div className="cots-admin-list">{config.types.map((type) => <form key={type.id} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget);
        void run(() => updateType({ id: type.id, name: String(form.get("name")), code: String(form.get("code")), icon: String(form.get("icon")), sortOrder: Number(form.get("sortOrder")), active: type.active }), "COTS type updated."); }}>
        <CotsIcon value={type.icon} label={type.name} /><div><input name="name" defaultValue={type.name} required /><small>{type.slug}</small></div>
        <input name="code" defaultValue={type.code} aria-label="Generated-code prefix" title="Generated-code prefix" required />
        <input name="icon" defaultValue={type.icon} aria-label="Icon or image URL" required /><input className="order-input" name="sortOrder" type="number" min={0} defaultValue={type.sortOrder} aria-label="Order" required />
        <div className="row-actions"><button className="button button-small button-primary">Save</button><button className="button button-small" type="button" onClick={() => void run(() => updateType({ id: type.id, name: type.name, code: type.code, icon: type.icon, sortOrder: type.sortOrder, active: !type.active }), type.active ? "Type disabled." : "Type enabled.")}>{type.active ? "Disable" : "Enable"}</button>
          <button className="button button-small button-danger" type="button" onClick={() => { if (window.confirm(`Delete ${type.name}?`)) void run(() => deleteType({ id: type.id }), "Type deleted."); }}>Delete</button></div>
      </form>)}</div>
    </section>

    <section className="panel"><div className="panel-heading"><div><p className="eyebrow">Inventory dimensions</p><h2>Quantity statuses</h2></div></div>
      <form className="cots-admin-add cots-status-add" onSubmit={(event) => { event.preventDefault(); const target = event.currentTarget; const form = new FormData(target);
        void run(() => addStatus({ name: String(form.get("name")), code: String(form.get("code")), sortOrder: Number(form.get("sortOrder")) }), "Quantity status added.").then(() => target.reset()); }}>
        <input name="name" placeholder="In stock" required /><input name="code" placeholder="IN_STOCK" required /><input name="sortOrder" type="number" min={0} defaultValue={10} required /><button className="button button-primary">Add status</button>
      </form>
      <div className="cots-admin-list cots-status-list">{config.statuses.map((status) => <form key={status.id} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget);
        void run(() => updateStatus({ id: status.id, name: String(form.get("name")), sortOrder: Number(form.get("sortOrder")), active: status.active }), "Status updated."); }}>
        <div><input name="name" defaultValue={status.name} required /><small>{status.code}</small></div><input className="order-input" name="sortOrder" type="number" min={0} defaultValue={status.sortOrder} required />
        <div className="row-actions"><button className="button button-small button-primary">Save</button><button className="button button-small" type="button" onClick={() => void run(() => updateStatus({ id: status.id, name: status.name, sortOrder: status.sortOrder, active: !status.active }), status.active ? "Status disabled." : "Status enabled.")}>{status.active ? "Disable" : "Enable"}</button>
          <button className="button button-small button-danger" type="button" onClick={() => { if (window.confirm(`Delete ${status.name}?`)) void run(() => deleteStatus({ id: status.id }), "Status deleted."); }}>Delete</button></div>
      </form>)}</div>
    </section>

    <section className="panel span-all"><div className="panel-heading"><div><p className="eyebrow">Form modifier</p><h2>Questions and generated-code segments</h2><p className="muted">Each answer is added to the item code using its question code. Measurement answers are stored in millimeters.</p></div>
      <select value={selectedTypeId ?? ""} onChange={(event) => setSelectedTypeId(event.target.value as Id<"cotsTypes">)}><option value="" disabled>Select COTS type</option>{config.types.map((type) => <option value={type.id} key={type.id}>{type.name}</option>)}</select></div>
      {selectedType && <><form className="cots-admin-add cots-question-add" onSubmit={(event) => { event.preventDefault(); const target = event.currentTarget; const form = new FormData(target);
        void run(() => addField({ cotsTypeId: selectedType.id, label: String(form.get("label")), key: String(form.get("key")), code: String(form.get("code")), fieldType: String(form.get("fieldType")) as FieldType, sortOrder: Number(form.get("sortOrder")) }), "Question added.").then(() => target.reset()); }}>
        <input name="label" placeholder="Number of teeth" required /><input name="key" placeholder="number-of-teeth" required /><input name="code" placeholder="T" required />
        <select name="fieldType" defaultValue="STRING" aria-label="Answer type"><option value="STRING">Text</option><option value="BOOLEAN">True / false</option><option value="SELECT">Selection</option><option value="MEASUREMENT">Measurement</option></select>
        <input name="sortOrder" type="number" min={0} defaultValue={(selectedFields.at(-1)?.sortOrder ?? 0) + 10} required /><button className="button button-primary">Add question</button>
      </form>
      <div className="cots-question-list">{selectedFields.length === 0 ? <p className="empty-state">No custom questions for {selectedType.name}.</p> : selectedFields.map((field, index) => <div className="cots-question-block" key={field.id}>
        <form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(() => updateField({ id: field.id, label: String(form.get("label")), code: String(form.get("code")), fieldType: String(form.get("fieldType")) as FieldType, sortOrder: Number(form.get("sortOrder")), active: field.active }), "Question updated."); }}>
          <span className="question-position">{index + 1}</span><input name="label" defaultValue={field.label} required /><span className="code-badge">{field.key}</span><input name="code" defaultValue={field.code} aria-label="Generated-code segment" title="Generated-code segment" required />
          <select name="fieldType" defaultValue={field.fieldType} aria-label="Answer type"><option value="STRING">Text</option><option value="BOOLEAN">True / false</option><option value="SELECT">Selection</option><option value="MEASUREMENT">Measurement</option></select>
          <input className="order-input" name="sortOrder" type="number" min={0} defaultValue={field.sortOrder} required />
          <div className="row-actions"><button className="button button-small button-primary">Save</button><button className="button button-small" type="button" onClick={() => void run(() => updateField({ id: field.id, label: field.label, code: field.code, fieldType: field.fieldType, sortOrder: field.sortOrder, active: !field.active }), field.active ? "Question disabled." : "Question enabled.")}>{field.active ? "Disable" : "Enable"}</button>
            <button className="button button-small button-danger" type="button" onClick={() => { if (window.confirm(`Delete ${field.label} and its saved values?`)) void run(() => deleteField({ id: field.id }), "Question deleted."); }}>Delete</button></div>
        </form>
        {field.fieldType === "SELECT" && <div className="cots-options"><h3>Selection options</h3><form className="cots-option-add" onSubmit={(event) => { event.preventDefault(); const target = event.currentTarget; const form = new FormData(target); void run(() => addOption({ fieldDefinitionId: field.id, label: String(form.get("label")), value: String(form.get("value")), sortOrder: Number(form.get("sortOrder")) }), "Option added.").then(() => target.reset()); }}>
          <input name="label" placeholder="Option label" required /><input name="value" placeholder="option-value" required /><input name="sortOrder" type="number" min={0} defaultValue={10} required /><button className="button button-small button-primary">Add option</button></form>
          {config.options.filter((option) => option.fieldDefinitionId === field.id).map((option) => <form className="cots-option-row" key={option.id} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(() => updateOption({ id: option.id, label: String(form.get("label")), sortOrder: Number(form.get("sortOrder")), active: option.active }), "Option updated."); }}>
            <input name="label" defaultValue={option.label} required /><span className="code-badge">{option.value}</span><input className="order-input" name="sortOrder" type="number" min={0} defaultValue={option.sortOrder} required /><div className="row-actions"><button className="button button-small button-primary">Save</button><button className="button button-small" type="button" onClick={() => void run(() => updateOption({ id: option.id, label: option.label, sortOrder: option.sortOrder, active: !option.active }), option.active ? "Option disabled." : "Option enabled.")}>{option.active ? "Disable" : "Enable"}</button><button className="button button-small button-danger" type="button" onClick={() => { if (window.confirm(`Delete ${option.label}?`)) void run(() => deleteOption({ id: option.id }), "Option deleted."); }}>Delete</button></div>
          </form>)}</div>}
      </div>)}</div></>}
    </section>
  </div>;
}
