import { useAction, useMutation, useQuery } from "convex/react";
import { useState, type FormEvent } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Notice, PageHeader } from "../components/AppLayout";
import { CotsAdminPage } from "./CotsAdminPage";
import { BuyListAdminPage } from "./BuyListAdminPage";
import { UnderSyncAdminPage } from "./UnderSyncAdminPage";

type Tab = "users" | "parts" | "cots" | "buy" | "undersync" | "database";
type Flash = { kind: "success" | "error"; text: string } | null;

export function AdminPage({ currentUserId }: { currentUserId: string }) {
  const [tab, setTab] = useState<Tab>("users");
  return <>
    <PageHeader eyebrow="Workspace administration" title="Admin" description="Manage members, the Parts Tracking form and the live application data." />
    <div className="tab-bar" role="tablist" aria-label="Admin sections">
      <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>Users</button>
      <button className={tab === "parts" ? "active" : ""} onClick={() => setTab("parts")}>Parts Tracking</button>
      <button className={tab === "cots" ? "active" : ""} onClick={() => setTab("cots")}>COTS</button>
      <button className={tab === "buy" ? "active" : ""} onClick={() => setTab("buy")}>Buy List</button>
      <button className={tab === "undersync" ? "active" : ""} onClick={() => setTab("undersync")}>UnderSync</button>
      <button className={tab === "database" ? "active" : ""} onClick={() => setTab("database")}>Database Explorer</button>
    </div>
    {tab === "users" && <UsersAdmin currentUserId={currentUserId} />}
    {tab === "parts" && <PartsConfiguration />}
    {tab === "cots" && <CotsAdminPage />}
    {tab === "buy" && <BuyListAdminPage />}
    {tab === "undersync" && <UnderSyncAdminPage currentUserId={currentUserId} />}
    {tab === "database" && <DatabaseExplorer />}
  </>;
}

function UsersAdmin({ currentUserId }: { currentUserId: string }) {
  const users = useQuery(api.admin.listUsers);
  const setRole = useMutation(api.admin.setRole);
  const setStatus = useMutation(api.admin.setStatus);
  const resetPassword = useAction(api.admin.resetPassword);
  const [flash, setFlash] = useState<Flash>(null);

  async function run(action: () => Promise<unknown>, success: string) {
    setFlash(null);
    try { await action(); setFlash({ kind: "success", text: success }); }
    catch (error) { setFlash({ kind: "error", text: error instanceof Error ? error.message : "The operation failed." }); }
  }

  return <section className="panel admin-section">
    <div className="panel-heading"><div><p className="eyebrow">Access control</p><h2>Team accounts</h2></div><span className="count-badge">{users?.length ?? 0}</span></div>
    {flash && <Notice kind={flash.kind}>{flash.text}</Notice>}
    {!users ? <p className="empty-state">Loading accounts...</p> : <div className="table-wrap"><table className="data-table">
      <thead><tr><th>User</th><th>Team role</th><th>Access</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>{users.map((user) => <tr key={user.id}>
        <td><strong>{user.displayName}</strong><small>@{user.username}<br />{user.email}</small></td>
        <td>{user.teamRole}</td>
        <td><select aria-label={`Access for ${user.displayName}`} value={user.appRole} disabled={user.id === currentUserId}
          onChange={(event) => void run(() => setRole({ userId: user.id, role: event.target.value as "ADMIN" | "MEMBER" }), "Access updated.")}>
          <option value="MEMBER">Member</option><option value="ADMIN">Admin</option></select></td>
        <td><span className={`status-pill status-${user.status.toLowerCase()}`}>{user.status}</span></td>
        <td><div className="row-actions">
          <button className="button button-small" onClick={() => void run(() => resetPassword({ targetUserId: user.id }), "Password reset to Senha1156 and sessions revoked.")}>Reset password</button>
          {user.status !== "DELETED" && <button className="button button-small" disabled={user.id === currentUserId}
            onClick={() => void run(() => setStatus({ userId: user.id, status: user.status === "ACTIVE" ? "DISABLED" : "ACTIVE" }), user.status === "ACTIVE" ? "Account disabled." : "Account enabled.")}>{user.status === "ACTIVE" ? "Disable" : "Enable"}</button>}
          {user.status !== "DELETED" && <button className="button button-small button-danger" disabled={user.id === currentUserId}
            onClick={() => { if (window.confirm(`Delete ${user.displayName}? Their operational history will be preserved.`)) void run(() => setStatus({ userId: user.id, status: "DELETED" }), "Account deleted."); }}>Delete</button>}
        </div></td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}

function PartsConfiguration() {
  const config = useQuery(api.partsConfig.get);
  const saveSettings = useMutation(api.partsConfig.saveSettings);
  const addMethod = useMutation(api.partsConfig.addMethod);
  const updateMethod = useMutation(api.partsConfig.updateMethod);
  const deleteMethod = useMutation(api.partsConfig.deleteMethod);
  const addMaterial = useMutation(api.partsConfig.addMaterial);
  const updateMaterial = useMutation(api.partsConfig.updateMaterial);
  const deleteMaterial = useMutation(api.partsConfig.deleteMaterial);
  const [flash, setFlash] = useState<Flash>(null);

  async function run(action: () => Promise<unknown>, success: string) {
    setFlash(null);
    try { await action(); setFlash({ kind: "success", text: success }); }
    catch (error) { setFlash({ kind: "error", text: error instanceof Error ? error.message : "The operation failed." }); }
  }

  if (!config) return <section className="panel"><p className="empty-state">Loading form configuration...</p></section>;
  async function submitLabels(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    await run(() => saveSettings({
      title: String(form.get("title")), nameLabel: String(form.get("nameLabel")), quantityLabel: String(form.get("quantityLabel")),
      subsystemLabel: String(form.get("subsystemLabel")), designerLabel: String(form.get("designerLabel")),
      methodLabel: String(form.get("methodLabel")), materialLabel: String(form.get("materialLabel")), submitLabel: String(form.get("submitLabel")),
    }), "Form labels saved.");
  }
  async function submitMethod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    await run(() => addMethod({ name: String(form.get("name")), code: String(form.get("code")) }), "Fabrication method added.");
    event.currentTarget.reset();
  }
  async function submitMaterial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    await run(() => addMaterial({ name: String(form.get("name")), code: String(form.get("code")), methodIds: form.getAll("methodIds") as Id<"manufacturingMethods">[] }), "Material added.");
    event.currentTarget.reset();
  }

  return <div className="admin-config-grid">
    <section className="panel"><div className="panel-heading"><div><p className="eyebrow">Form copy</p><h2>Questions and labels</h2></div></div>
      {flash && <Notice kind={flash.kind}>{flash.text}</Notice>}
      <form className="form-grid" onSubmit={submitLabels}>
        {Object.entries(config.settings).map(([key, value]) => <label key={key}>{labelForSetting(key)}<input name={key} defaultValue={value} required /></label>)}
        <div className="span-2 form-actions"><button className="button button-primary">Save labels</button></div>
      </form>
    </section>
    <section className="panel"><div className="panel-heading"><div><p className="eyebrow">Production options</p><h2>Fabrication methods</h2></div></div>
      <form className="inline-form" onSubmit={submitMethod}><input name="name" placeholder="Method name" required /><input name="code" placeholder="Short code" required /><button className="button button-primary">Add</button></form>
      <div className="editable-list">{config.methods.map((method) => <div key={method.id}>
        <input aria-label="Method name" defaultValue={method.name} onBlur={(event) => event.target.value !== method.name && void run(() => updateMethod({ id: method.id, name: event.target.value, active: method.active }), "Method updated.")} />
        <span className="code-badge">{method.code}</span>
        <button className="button button-small" onClick={() => void run(() => updateMethod({ id: method.id, name: method.name, active: !method.active }), method.active ? "Method disabled." : "Method enabled.")}>{method.active ? "Disable" : "Enable"}</button>
        <button className="button button-small button-danger" onClick={() => { if (window.confirm(`Delete ${method.name}?`)) void run(() => deleteMethod({ id: method.id }), "Method deleted."); }}>Delete</button>
      </div>)}</div>
    </section>
    <section className="panel span-all"><div className="panel-heading"><div><p className="eyebrow">Compatibility</p><h2>Materials</h2></div></div>
      <form className="material-add-form" onSubmit={submitMaterial}><input name="name" placeholder="Material name" required /><input name="code" placeholder="Short code" required />
        <fieldset><legend>Accepted fabrication methods</legend><div className="check-grid">{config.methods.map((method) => <label key={method.id}><input type="checkbox" name="methodIds" value={method.id} />{method.name}</label>)}</div></fieldset>
        <button className="button button-primary">Add material</button></form>
      <div className="material-admin-list">{config.materials.map((material) => <MaterialEditor key={material.id} material={material} methods={config.methods} onSave={(name, active, methodIds) => run(() => updateMaterial({ id: material.id, name, active, methodIds }), "Material updated.")} onDelete={() => run(() => deleteMaterial({ id: material.id }), "Material deleted.")} />)}</div>
    </section>
  </div>;
}

function MaterialEditor({ material, methods, onSave, onDelete }: {
  material: { id: Id<"materials">; name: string; code: string; active: boolean; methodIds: Id<"manufacturingMethods">[] };
  methods: Array<{ id: Id<"manufacturingMethods">; name: string }>;
  onSave: (name: string, active: boolean, methodIds: Id<"manufacturingMethods">[]) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [name, setName] = useState(material.name); const [active, setActive] = useState(material.active);
  const [selected, setSelected] = useState<Id<"manufacturingMethods">[]>(material.methodIds);
  return <article><div className="material-title"><input value={name} onChange={(event) => setName(event.target.value)} /><span className="code-badge">{material.code}</span></div>
    <div className="check-grid">{methods.map((method) => <label key={method.id}><input type="checkbox" checked={selected.includes(method.id)} onChange={() => setSelected(selected.includes(method.id) ? selected.filter((id) => id !== method.id) : [...selected, method.id])} />{method.name}</label>)}</div>
    <div className="row-actions"><button className="button button-small" onClick={() => { setActive(!active); void onSave(name, !active, selected); }}>{active ? "Disable" : "Enable"}</button>
      <button className="button button-small button-primary" onClick={() => void onSave(name, active, selected)}>Save</button>
      <button className="button button-small button-danger" onClick={() => { if (window.confirm(`Delete ${material.name}?`)) void onDelete(); }}>Delete</button></div>
  </article>;
}

function DatabaseExplorer() {
  const snapshot = useQuery(api.admin.databaseSnapshot); const [selectedName, setSelectedName] = useState("users");
  const selected = snapshot?.find((table) => table.name === selectedName) ?? snapshot?.[0];
  const rows = selected?.rows.map((row) => JSON.parse(row) as Record<string, unknown>) ?? [];
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return <section className="panel admin-section"><div className="panel-heading"><div><p className="eyebrow">Read-only overview</p><h2>Database Explorer</h2></div></div>
    <Notice>Operational editing belongs in the dedicated admin tools. This overview makes the current Convex collections visible without bypassing business rules.</Notice>
    {!snapshot ? <p className="empty-state">Loading collections...</p> : <><div className="database-tabs">{snapshot.map((table) => <button className={selected?.name === table.name ? "active" : ""} key={table.name} onClick={() => setSelectedName(table.name)}>{table.name}<span>{table.rows.length}</span></button>)}</div>
      <div className="sheet-wrap"><table className="sheet-table"><thead><tr><th>#</th>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={Math.max(1, columns.length + 1)}>No rows</td></tr> : rows.map((row, index) => <tr key={String(row._id ?? index)}><th>{index + 1}</th>{columns.map((column) => <td key={column}>{formatCell(row[column])}</td>)}</tr>)}</tbody></table></div></>}
  </section>;
}

function formatCell(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function labelForSetting(key: string) {
  return ({ title: "Form title", nameLabel: "Name question", quantityLabel: "Quantity question", subsystemLabel: "Subsystem question",
    designerLabel: "Designer question", methodLabel: "Fabrication method question", materialLabel: "Material question", submitLabel: "Submit button" } as Record<string, string>)[key] ?? key;
}
