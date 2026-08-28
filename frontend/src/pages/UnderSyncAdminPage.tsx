import { useMutation, useQuery } from "convex/react";
import { useState, type FormEvent } from "react";
import { api } from "../../../convex/_generated/api";
import { Notice } from "../components/AppLayout";

type Flash = { kind: "success" | "error"; text: string } | null;

export function UnderSyncAdminPage({ currentUserId }: { currentUserId: string }) {
  const config = useQuery(api.undersyncAdmin.get);
  const saveSettings = useMutation(api.undersyncAdmin.saveSettings);
  const addSubsystem = useMutation(api.undersyncAdmin.addSubsystem); const updateSubsystem = useMutation(api.undersyncAdmin.updateSubsystem); const deleteSubsystem = useMutation(api.undersyncAdmin.deleteSubsystem);
  const requestArchive = useMutation(api.undersyncAdmin.requestArchive); const decideArchive = useMutation(api.undersyncAdmin.decideArchive);
  const [flash, setFlash] = useState<Flash>(null);
  async function run(action: () => Promise<unknown>, success: string) { setFlash(null); try { await action(); setFlash({ kind: "success", text: success }); } catch (error) { setFlash({ kind: "error", text: error instanceof Error ? error.message : "The operation failed." }); } }
  if (!config) return <section className="panel"><p className="empty-state">Loading UnderSync settings…</p></section>;
  function submitSettings(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); void run(() => saveSettings({
    appName: String(form.get("appName")), organizationName: String(form.get("organizationName")), teamNumber: String(form.get("teamNumber")), seasonCode: String(form.get("seasonCode")), partCodeSeparator: String(form.get("partCodeSeparator")), partSequenceDigits: Number(form.get("partSequenceDigits")),
  }), "UnderSync settings saved."); }
  return <div className="admin-config-grid">{flash && <div className="span-all"><Notice kind={flash.kind}>{flash.text}</Notice></div>}
    <section className="panel"><div className="panel-heading"><div><p className="eyebrow">Identity and numbering</p><h2>UnderSync</h2></div></div>
      <form className="form-grid" onSubmit={submitSettings}><label>Application name<input name="appName" defaultValue={config.settings.appName} required /></label><label>Organization<input name="organizationName" defaultValue={config.settings.organizationName} required /></label>
        <label>Team code<input name="teamNumber" defaultValue={config.settings.teamNumber} required /></label><label>Season code<input name="seasonCode" defaultValue={config.settings.seasonCode} required /></label>
        <label>Part-code separator<input name="partCodeSeparator" defaultValue={config.settings.partCodeSeparator} required /></label><label>Sequence digits<input name="partSequenceDigits" type="number" min={2} max={8} defaultValue={config.settings.partSequenceDigits} required /></label>
        <div className="span-2"><Notice>New numbering settings apply only to parts registered after saving. Existing permanent tracking codes are never rewritten.</Notice></div><div className="span-2 form-actions"><button className="button button-primary">Save settings</button></div>
      </form></section>
    <section className="panel"><div className="panel-heading"><div><p className="eyebrow">Robot structure</p><h2>Subsystems</h2></div></div>
      <form className="inline-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(() => addSubsystem({ name: String(form.get("name")), code: String(form.get("code")) }), "Subsystem added.").then(() => event.currentTarget.reset()); }}><input name="name" placeholder="Intake" required /><input name="code" placeholder="IN" required /><button className="button button-primary">Add</button></form>
      <div className="editable-list">{config.subsystems.map((subsystem) => <div key={subsystem.id}><input defaultValue={subsystem.name} aria-label={`${subsystem.code} name`} onBlur={(event) => event.target.value !== subsystem.name && void run(() => updateSubsystem({ id: subsystem.id, name: event.target.value, active: subsystem.active }), "Subsystem updated.")} /><span className="code-badge">{subsystem.code}</span><button className="button button-small" onClick={() => void run(() => updateSubsystem({ id: subsystem.id, name: subsystem.name, active: !subsystem.active }), subsystem.active ? "Subsystem disabled." : "Subsystem enabled.")}>{subsystem.active ? "Disable" : "Enable"}</button><button className="button button-small button-danger" onClick={() => { if (window.confirm(`Delete ${subsystem.name}?`)) void run(() => deleteSubsystem({ id: subsystem.id }), "Subsystem deleted."); }}>Delete</button></div>)}</div>
    </section>
    <section className="panel span-all danger-zone"><div className="panel-heading"><div><p className="eyebrow">Two-person control</p><h2>Archive operational data</h2></div></div>
      <Notice kind="error">Approval archives every active part and Buy List item. The requesting administrator cannot approve the request; a second active administrator must confirm it.</Notice>
      <button className="button button-danger" onClick={() => { if (window.confirm("Request archival of all active Parts and Buy List data?")) void run(() => requestArchive({}), "Archive request created. A different administrator must approve it."); }}>Request archive</button>
      <div className="archive-request-list">{config.archiveRequests.length === 0 ? <p className="empty-state">No archive requests.</p> : config.archiveRequests.map((request) => <article key={request.id}><div><strong>{request.status}</strong><p>Requested by {request.requesterName} · {new Date(request.requestedAt).toLocaleString()}</p>{request.deciderName && <small>Decided by {request.deciderName}</small>}</div>
        {request.status === "PENDING" && request.requestedBy !== currentUserId && <div className="row-actions"><button className="button button-small button-danger" onClick={() => void run(() => decideArchive({ requestId: request.id, approve: true }), "Archive approved and queued.")}>Approve</button><button className="button button-small" onClick={() => void run(() => decideArchive({ requestId: request.id, approve: false }), "Archive request rejected.")}>Reject</button></div>}
        {request.status === "PENDING" && request.requestedBy === currentUserId && <small>Waiting for another administrator.</small>}
      </article>)}</div>
    </section>
  </div>;
}
