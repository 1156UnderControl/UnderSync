import { useMutation, useQuery } from "convex/react";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Notice } from "../components/AppLayout";
import { CotsIcon } from "./CotsPage";

type Flash = { kind: "success" | "error"; text: string } | null;

export function BuyListAdminPage() {
  const config = useQuery(api.buyListAdmin.get);
  const saveSettings = useMutation(api.buyListAdmin.saveSettings);
  const addType = useMutation(api.buyListAdmin.addType); const updateType = useMutation(api.buyListAdmin.updateType); const deleteType = useMutation(api.buyListAdmin.deleteType);
  const addField = useMutation(api.buyListAdmin.addField); const updateField = useMutation(api.buyListAdmin.updateField); const deleteField = useMutation(api.buyListAdmin.deleteField);
  const [selectedTypeId, setSelectedTypeId] = useState<Id<"buyListTypes"> | null>(null); const [flash, setFlash] = useState<Flash>(null);
  useEffect(() => { if (!selectedTypeId && config?.types[0]) setSelectedTypeId(config.types[0].id); }, [config, selectedTypeId]);
  async function run(action: () => Promise<unknown>, success: string) { setFlash(null); try { await action(); setFlash({ kind: "success", text: success }); } catch (error) { setFlash({ kind: "error", text: error instanceof Error ? error.message : "The operation failed." }); } }
  if (!config) return <section className="panel"><p className="empty-state">Loading Buy List configuration…</p></section>;
  const selectedType = config.types.find((type) => type.id === selectedTypeId) ?? null;
  const selectedFields = config.fields.filter((field) => field.buyListTypeId === selectedTypeId).sort((a, b) => a.sortOrder - b.sortOrder);
  return <div className="cots-admin-grid">{flash && <div className="span-all"><Notice kind={flash.kind}>{flash.text}</Notice></div>}
    <section className="panel span-all"><div className="panel-heading"><div><p className="eyebrow">General form</p><h2>Buy List labels</h2></div></div>
      <form className="form-grid" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(() => saveSettings({ title: String(form.get("title")), description: String(form.get("description")), addLabel: String(form.get("addLabel")) }), "Buy List labels saved."); }}>
        <label>Page title<input name="title" defaultValue={config.settings.title} required /></label><label>Add button<input name="addLabel" defaultValue={config.settings.addLabel} required /></label>
        <label className="span-2">Description<input name="description" defaultValue={config.settings.description} required /></label><div className="span-2 form-actions"><button className="button button-primary">Save labels</button></div>
      </form></section>
    <section className="panel span-all"><div className="panel-heading"><div><p className="eyebrow">Organization</p><h2>Buy-list categories</h2></div></div>
      <form className="cots-admin-add" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(() => addType({ name: String(form.get("name")), slug: String(form.get("slug")), icon: String(form.get("icon")), sortOrder: Number(form.get("sortOrder")) }), "Category added.").then(() => event.currentTarget.reset()); }}>
        <input name="name" placeholder="Electronics" required /><input name="slug" placeholder="electronics" required /><input name="icon" placeholder="⚡ or https://…" required /><input name="sortOrder" type="number" min={0} defaultValue={10} required /><button className="button button-primary">Add category</button>
      </form><div className="cots-admin-list">{config.types.map((type) => <form key={type.id} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(() => updateType({ id: type.id, name: String(form.get("name")), icon: String(form.get("icon")), sortOrder: Number(form.get("sortOrder")), active: type.active }), "Category updated."); }}>
        <CotsIcon value={type.icon} label={type.name} /><div><input name="name" defaultValue={type.name} required /><small>{type.slug}</small></div><input name="icon" defaultValue={type.icon} required /><input className="order-input" name="sortOrder" type="number" min={0} defaultValue={type.sortOrder} required />
        <div className="row-actions"><button className="button button-small button-primary">Save</button><button className="button button-small" type="button" onClick={() => void run(() => updateType({ id: type.id, name: type.name, icon: type.icon, sortOrder: type.sortOrder, active: !type.active }), type.active ? "Category disabled." : "Category enabled.")}>{type.active ? "Disable" : "Enable"}</button><button className="button button-small button-danger" type="button" onClick={() => { if (window.confirm(`Delete ${type.name}?`)) void run(() => deleteType({ id: type.id }), "Category deleted."); }}>Delete</button></div>
      </form>)}</div></section>
    <section className="panel span-all"><div className="panel-heading"><div><p className="eyebrow">Category-specific form</p><h2>Questions</h2></div></div>
      <div className="cots-type-tabs">{config.types.map((type) => <button key={type.id} className={type.id === selectedTypeId ? "active" : ""} onClick={() => setSelectedTypeId(type.id)}>{type.name}</button>)}</div>
      {!selectedType ? <p className="empty-state">Add a category before configuring questions.</p> : <><form className="cots-admin-add cots-field-add" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(() => addField({ buyListTypeId: selectedType.id, label: String(form.get("label")), key: String(form.get("key")), fieldType: String(form.get("fieldType")) as "STRING" | "BOOLEAN", sortOrder: Number(form.get("sortOrder")) }), "Question added.").then(() => event.currentTarget.reset()); }}>
        <input name="label" placeholder="Supplier URL" required /><input name="key" placeholder="supplier-url" required /><select name="fieldType" defaultValue="STRING"><option value="STRING">Text</option><option value="BOOLEAN">True / false</option></select><input name="sortOrder" type="number" min={0} defaultValue={(selectedFields.at(-1)?.sortOrder ?? 0) + 10} required /><button className="button button-primary">Add question</button>
      </form><div className="cots-question-list">{selectedFields.length === 0 ? <p className="empty-state">No questions for {selectedType.name}.</p> : selectedFields.map((field, index) => <form key={field.id} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(() => updateField({ id: field.id, label: String(form.get("label")), fieldType: String(form.get("fieldType")) as "STRING" | "BOOLEAN", sortOrder: Number(form.get("sortOrder")), active: field.active }), "Question updated."); }}>
        <span className="question-position">{index + 1}</span><input name="label" defaultValue={field.label} required /><span className="code-badge">{field.key}</span><select name="fieldType" defaultValue={field.fieldType}><option value="STRING">Text</option><option value="BOOLEAN">True / false</option></select><input className="order-input" name="sortOrder" type="number" min={0} defaultValue={field.sortOrder} required />
        <div className="row-actions"><button className="button button-small button-primary">Save</button><button className="button button-small" type="button" onClick={() => void run(() => updateField({ id: field.id, label: field.label, fieldType: field.fieldType, sortOrder: field.sortOrder, active: !field.active }), field.active ? "Question disabled." : "Question enabled.")}>{field.active ? "Disable" : "Enable"}</button><button className="button button-small button-danger" type="button" onClick={() => { if (window.confirm(`Delete ${field.label} and its saved values?`)) void run(() => deleteField({ id: field.id }), "Question deleted."); }}>Delete</button></div>
      </form>)}</div></>}
    </section>
  </div>;
}
