import type { AuthenticatedUser } from "./auth.js";

export interface ExternalAccountSummary {
  provider: "ONSHAPE" | "NOTION";
  connectionName: string;
  connectionStatus: "NOT_CONFIGURED" | "ACTIVE" | "ERROR" | "DISABLED";
  identityStatus?: "PENDING" | "VERIFIED" | "REVOKED";
  externalUserId?: string;
  externalDisplayName?: string;
  externalEmail?: string;
  verifiedAt?: string;
}

export interface PartsTrackingOptions {
  subsystems: Array<{ id: string; code: string; name: string }>;
  designers: Array<{ id: string; name: string }>;
  methods: Array<{ id: string; code: string; name: string }>;
  materials: Array<{ id: string; code: string; name: string; methodIds: string[] }>;
  settings: PartsTrackingFormSettings;
}

export interface PartsTrackingFormSettings {
  formTitle: string;
  nameLabel: string;
  namePlaceholder: string;
  quantityLabel: string;
  subsystemLabel: string;
  designerLabel: string;
  fabricationMethodLabel: string;
  materialLabel: string;
  submitLabel: string;
}

export interface AdminManufacturingMethod {
  id: string;
  code: string;
  name: string;
  active: boolean;
  usedByParts: number;
}

export interface AdminMaterial {
  id: string;
  code: string;
  name: string;
  active: boolean;
  usedByParts: number;
  methodIds: string[];
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function notice(message?: string, kind: "error" | "success" = "error"): string {
  return message ? `<div class="notice ${kind}">${escapeHtml(message)}</div>` : "";
}

export function layout(title: string, content: string, user?: AuthenticatedUser, csrf = ""): string {
  const navigation = user
    ? `<nav>
         <a href="/">Home</a>
         <a href="/account">Account</a>
         <a href="/parts-tracking">Parts Tracking</a>
         ${user.role === "ADMIN" ? '<a href="/admin">Admin</a>' : ""}
         <form method="post" action="/logout" class="inline-form">
           <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}">
           <button type="submit" class="link-button">Log out</button>
         </form>
       </nav>`
    : `<nav><a href="/login">Log in</a><a href="/register">Register</a></nav>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · UnderSync</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header class="topbar">
    <a class="brand" href="/">UnderSync <span>1156 · Under Control</span></a>
    ${navigation}
  </header>
  <main>${content}</main>
</body>
</html>`;
}

export function homePage(user: AuthenticatedUser, csrf: string): string {
  return layout(
    "Home",
    `<section class="hero compact">
       <p class="eyebrow">1156 · Under Control</p>
       <h1>Welcome, ${escapeHtml(user.displayName)}</h1>
       <p>Your UnderSync account is active. Parts, tasks, and manufacturing workflows will connect here next.</p>
       <div class="actions">
         <a class="button" href="/account">Manage account</a>
         <a class="button secondary" href="/parts-tracking">Open Parts Tracking</a>
         ${user.role === "ADMIN" ? '<a class="button secondary" href="/admin">Open admin data</a>' : ""}
       </div>
     </section>`,
    user,
    csrf,
  );
}

export function loginPage(csrf: string, error?: string, identifier = "", returnTo = "/"): string {
  return layout(
    "Log in",
    `<section class="auth-shell">
       <div class="auth-copy"><p class="eyebrow">UnderSync</p><h1>Keep the team in sync.</h1><p>Sign in to manage engineering work from one reliable source.</p></div>
       <form method="post" action="/login" class="card form-card">
         <h2>Log in</h2>${notice(error)}
         <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}">
         <input type="hidden" name="return_to" value="${escapeHtml(returnTo)}">
         <label>Name or email<input name="identifier" value="${escapeHtml(identifier)}" autocomplete="username" required autofocus></label>
         <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
         <button type="submit">Log in</button>
         <p class="muted">No account? <a href="/register">Register</a></p>
       </form>
     </section>`,
  );
}

export function panelLoginRequiredPage(loginUrl: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Sign in · UnderSync</title><link rel="stylesheet" href="/styles.css"></head><body><main class="panel-auth-shell">
    <section class="card"><p class="eyebrow">UnderSync · Onshape</p><h1>Sign in outside the panel</h1>
    <p>Browsers do not reliably allow a login form to create cookies inside a third-party iframe.</p>
    <div class="actions"><a class="button" href="${escapeHtml(loginUrl)}" target="_blank" rel="noopener">Open UnderSync login</a><button type="button" class="button secondary" onclick="location.reload()">I signed in · retry</button></div>
    <p class="muted">After signing in, return here and press retry. Third-party cookies must be allowed for the Onshape site. The deployed extension must use HTTPS.</p>
    </section></main></body></html>`;
}

export function registerPage(csrf: string, error?: string, values: Record<string, string> = {}): string {
  return layout(
    "Register",
    `<section class="auth-shell">
       <div class="auth-copy"><p class="eyebrow">Join the workspace</p><h1>Create your team account.</h1><p>New accounts start as members. An administrator can grant administrator access later.</p></div>
       <form method="post" action="/register" class="card form-card">
         <h2>Register</h2>${notice(error)}
         <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}">
         <label>Name<input name="name" value="${escapeHtml(values.name)}" autocomplete="username" required></label>
         <label>Display name<input name="display_name" value="${escapeHtml(values.display_name)}" required></label>
         <label>Email<input type="email" name="email" value="${escapeHtml(values.email)}" autocomplete="email" required></label>
         <label>Password<input type="password" name="password" autocomplete="new-password" minlength="8" required><small>At least 8 characters.</small></label>
         <button type="submit">Create account</button>
         <p class="muted">Already registered? <a href="/login">Log in</a></p>
       </form>
     </section>`,
  );
}

export function accountPage(
  user: AuthenticatedUser,
  csrf: string,
  message?: string,
  isError = false,
  externalAccounts: ExternalAccountSummary[] = [],
): string {
  const accountCards = externalAccounts.map((account) => {
    const linked = account.identityStatus === "VERIFIED";
    const status = linked ? "Linked" : account.identityStatus === "PENDING" ? "Pending verification" : account.connectionStatus === "NOT_CONFIGURED" ? "Provider setup required" : "Not linked";
    const details = linked
      ? `<strong>${escapeHtml(account.externalDisplayName ?? account.externalEmail ?? account.externalUserId)}</strong><span>${escapeHtml(account.externalEmail ?? account.externalUserId)}</span>`
      : `<span>The ${escapeHtml(account.connectionName)} connection must verify this identity before it can be used for synchronization.</span>`;
    const action = account.provider === "ONSHAPE"
      ? linked
        ? `<form method="post" action="/integrations/onshape/disconnect" onsubmit="return confirm('Disconnect this Onshape account?')"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><button class="small-button secondary" type="submit">Disconnect</button></form>`
        : `<a class="small-button button" href="/integrations/onshape/connect">Link Onshape</a>`
      : "";
    return `<article class="connection-card"><div class="connection-icon">${account.provider === "ONSHAPE" ? "O" : "N"}</div><div><h3>${escapeHtml(account.connectionName)}</h3>${details}${action}</div><span class="connection-status ${linked ? "linked" : ""}">${escapeHtml(status)}</span></article>`;
  }).join("");
  return layout(
    "Account",
    `<section class="page-heading"><p class="eyebrow">Personal settings</p><h1>Your account</h1><p>Account ID <code>${escapeHtml(user.id)}</code> is permanent.</p></section>
     <form method="post" action="/account" class="card settings-grid">
       ${notice(message, isError ? "error" : "success")}
       <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}">
       <label>Name<input name="name" value="${escapeHtml(user.name)}" required></label>
       <label>Display name<input name="display_name" value="${escapeHtml(user.displayName)}" required></label>
       <label>Email<input type="email" name="email" value="${escapeHtml(user.email)}" required></label>
       <hr><h2>Change password</h2><p class="muted">Leave both password fields empty to keep the current password.</p>
       <label>Current password<input type="password" name="current_password" autocomplete="current-password"></label>
       <label>New password<input type="password" name="new_password" autocomplete="new-password" minlength="8"></label>
       <div class="form-actions"><button type="submit">Save changes</button></div>
     </form>
     <section class="connected-accounts"><div class="section-heading"><div><p class="eyebrow">Integrations</p><h2>Connected accounts</h2></div></div>
       <div class="connection-grid">${accountCards || '<p class="muted">No integration connections are configured.</p>'}</div>
       <p class="muted">Onshape identities will be verified through OAuth. Notion identities will be matched to the team workspace connection. Tokens and workspace secrets are not stored in these identity records.</p>
     </section>`,
    user,
    csrf,
  );
}

export function oauthResultPage(success: boolean, message: string, user?: AuthenticatedUser): string {
  return layout(
    "Onshape OAuth",
    `<section class="card error-card"><p class="eyebrow">Onshape OAuth</p><h1>${success ? "Account linked" : "Authentication failed"}</h1>
      ${notice(message, success ? "success" : "error")}
      <div class="actions"><a class="button" href="/account">Return to account</a>${success ? '<a class="button secondary" href="/parts-tracking">Open Parts Tracking</a>' : ""}</div></section>`,
    user,
  );
}

export function partsTrackingPanelPage(user: AuthenticatedUser, csrf: string, options: PartsTrackingOptions): string {
  const option = (item: { id: string; code?: string; name: string }) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}${item.code ? ` (${escapeHtml(item.code)})` : ""}</option>`;
  const materialOption = (item: PartsTrackingOptions["materials"][number]) => `<option value="${escapeHtml(item.id)}" data-method-ids="${escapeHtml(item.methodIds.join(" "))}">${escapeHtml(item.name)} (${escapeHtml(item.code)})</option>`;
  return layout(
    "Parts Tracking",
    `<section class="panel-heading"><div><p class="eyebrow">Onshape Parts Tracking</p><h1>Register a selected part</h1></div><a class="button secondary" href="/integrations/onshape/connect" target="_top">Link or refresh Onshape</a></section>
     <section class="tracking-layout">
       <article class="card selection-card">
         <p class="step-label">1 · Select in Onshape</p>
         <h2 id="selection-title">Waiting for one selected part</h2>
         <p id="selection-help" class="muted">Open this page as the UnderSync Element Right Panel, then select one body, face, or edge.</p>
         <dl id="selection-details" class="selection-details" hidden>
           <div><dt>Onshape name</dt><dd id="selected-name">—</dd></div>
           <div><dt>Part ID</dt><dd id="selected-part-id">—</dd></div>
           <div><dt>Microversion</dt><dd id="selected-microversion">—</dd></div>
         </dl>
         <div id="selection-error" class="notice error" hidden></div>
       </article>
       <form id="tracking-form" class="card tracking-form" hidden>
         <p class="step-label">2 · Part details</p><h2>${escapeHtml(options.settings.formTitle)}</h2>
         <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}">
         <label>${escapeHtml(options.settings.nameLabel)}<input name="name" minlength="2" maxlength="160" required placeholder="${escapeHtml(options.settings.namePlaceholder)}"></label>
         <label>${escapeHtml(options.settings.quantityLabel)}<input name="quantity" type="number" min="1" max="10000" step="1" value="1" required></label>
         <label>${escapeHtml(options.settings.subsystemLabel)}<select name="subsystemId" required><option value="">Choose an option</option>${options.subsystems.map(option).join("")}</select></label>
         <label>${escapeHtml(options.settings.designerLabel)}<select name="designerId" required><option value="">Choose an option</option>${options.designers.map(option).join("")}</select></label>
         <label>${escapeHtml(options.settings.fabricationMethodLabel)}<select name="methodId" required><option value="">Choose an option</option>${options.methods.map(option).join("")}</select></label>
         <label id="material-field" hidden>${escapeHtml(options.settings.materialLabel)}<select name="materialId" required disabled><option value="">Choose an option</option>${options.materials.map(materialOption).join("")}</select><small id="material-help">Choose the fabrication method first.</small></label>
         <p class="muted form-note">The generated ID is permanent and records the selected fabrication method and material.</p>
         <button type="submit">${escapeHtml(options.settings.submitLabel)}</button>
         <div id="registration-result" hidden></div>
       </form>
     </section>
     <script type="application/json" id="panel-context">${safeJsonForHtml({ csrf })}</script>
     <script type="module" src="/parts-tracking.js"></script>`,
    user,
    csrf,
  );
}

function safeJsonForHtml(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function renderCell(column: string, value: unknown): string {
  if (["password_hash", "token_hash", "csrf_token_hash", "access_token_encrypted", "refresh_token_encrypted"].includes(column)) return '<span class="redacted">Redacted</span>';
  if (value === null) return '<span class="null">NULL</span>';
  if (typeof value === "object") return `<code>${escapeHtml(JSON.stringify(value))}</code>`;
  return escapeHtml(value);
}

export function adminPage(
  user: AuthenticatedUser,
  csrf: string,
  tables: string[],
  selected: string,
  columns: string[],
  rows: Record<string, unknown>[],
  page: number,
  hasNext: boolean,
  message?: string,
): string {
  const tableLinks = tables.map((table) => `<a class="table-link${table === selected ? " active" : ""}" href="/admin/database?table=${encodeURIComponent(table)}">${escapeHtml(table)}</a>`).join("");
  const hasUserActions = selected === "users";
  const head = columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("") + (hasUserActions ? "<th>admin actions</th>" : "");
  const body = rows.length
    ? rows.map((row) => {
        const cells = columns.map((column) => `<td>${renderCell(column, row[column])}</td>`).join("");
        if (!hasUserActions) return `<tr>${cells}</tr>`;
        const active = row.status === "ACTIVE";
        const admin = row.role === "ADMIN";
        return `<tr>${cells}<td class="row-actions">
          <form method="post" action="/admin/users/${encodeURIComponent(String(row.id))}/toggle-status">
            <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}">
            <button type="submit" class="small-button ${active ? "danger" : "secondary"}">${active ? "Disable" : "Enable"}</button>
          </form>
          <form method="post" action="/admin/users/${encodeURIComponent(String(row.id))}/reset-password" onsubmit="return confirm('Reset this password to Senha1156?')">
            <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}">
            <button type="submit" class="small-button secondary">Reset password</button>
          </form>
          <form method="post" action="/admin/users/${encodeURIComponent(String(row.id))}/set-role">
            <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}">
            <input type="hidden" name="role" value="${admin ? "MEMBER" : "ADMIN"}">
            <button type="submit" class="small-button secondary">${admin ? "Make member" : "Make admin"}</button>
          </form>
          <form method="post" action="/admin/users/${encodeURIComponent(String(row.id))}/delete" onsubmit="return confirm('Permanently delete this account? This cannot be undone.')">
            <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}">
            <button type="submit" class="small-button danger">Delete</button>
          </form>
        </td></tr>`;
      }).join("")
    : `<tr><td colspan="${Math.max(columns.length + (hasUserActions ? 1 : 0), 1)}" class="empty">No rows</td></tr>`;
  const queryBase = `/admin/database?table=${encodeURIComponent(selected)}&page=`;
  return layout(
    "Admin data",
    `<section class="admin-heading"><div><p class="eyebrow"><a href="/admin">Administrator</a> / Database</p><h1>Database explorer</h1><p>Table data is read-only; user account controls are available on the users table. Sensitive hashes are always redacted.</p></div><span class="admin-badge">ADMIN</span></section>
     <div class="data-workspace">
       <aside class="table-list"><h2>Tables</h2>${tableLinks}</aside>
       <section class="sheet-panel">${message ? `<div class="sheet-notice">${escapeHtml(message)}</div>` : ""}<div class="sheet-toolbar"><strong>${escapeHtml(selected)}</strong><span>${rows.length} rows on this page</span></div>
         <div class="sheet-scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
         <div class="pagination">${page > 1 ? `<a href="${queryBase}${page - 1}">Previous</a>` : "<span></span>"}${hasNext ? `<a href="${queryBase}${page + 1}">Next</a>` : ""}</div>
       </section>
     </div>`,
    user,
    csrf,
  );
}

export function adminOverviewPage(user: AuthenticatedUser, csrf: string, counts: { users: number; parts: number; activeMethods: number }): string {
  return layout(
    "Admin",
    `<section class="admin-heading"><div><p class="eyebrow">Administrator</p><h1>Administration</h1><p>Manage UnderSync configuration, users, operational forms, and database visibility.</p></div><span class="admin-badge">ADMIN</span></section>
     <section class="admin-cards">
       <a class="admin-card" href="/admin/database?table=users"><span class="admin-card-icon">DB</span><h2>Database explorer</h2><p>Inspect all tables and manage user access.</p><strong>${counts.users} users · ${counts.parts} parts</strong></a>
       <a class="admin-card" href="/admin/parts-tracking"><span class="admin-card-icon">PT</span><h2>Parts Tracking form</h2><p>Change question wording and fabrication-method options.</p><strong>${counts.activeMethods} active methods</strong></a>
     </section>`,
    user,
    csrf,
  );
}

export function adminPartsTrackingPage(
  user: AuthenticatedUser,
  csrf: string,
  settings: PartsTrackingFormSettings,
  methods: AdminManufacturingMethod[],
  materials: AdminMaterial[],
  message?: string,
  isError = false,
): string {
  const methodRows = methods.map((method) => `<tr><td><code>${escapeHtml(method.code)}</code></td><td>${escapeHtml(method.name)}</td><td>${method.active ? "Active" : "Disabled"}</td><td>${method.usedByParts}</td><td class="row-actions method-actions">
    <form method="post" action="/admin/parts-tracking/methods/${encodeURIComponent(method.id)}">
      <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><input name="name" value="${escapeHtml(method.name)}" maxlength="100" required aria-label="Method name"><input type="hidden" name="active" value="${method.active ? "true" : "false"}"><button class="small-button secondary" type="submit">Save name</button>
    </form>
    <form method="post" action="/admin/parts-tracking/methods/${encodeURIComponent(method.id)}">
      <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><input type="hidden" name="name" value="${escapeHtml(method.name)}"><input type="hidden" name="active" value="${method.active ? "false" : "true"}"><button class="small-button ${method.active ? "danger" : "secondary"}" type="submit">${method.active ? "Disable" : "Enable"}</button>
    </form>
    <form method="post" action="/admin/parts-tracking/methods/${encodeURIComponent(method.id)}/delete" onsubmit="return confirm('Permanently delete this fabrication method?')">
      <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><button class="small-button danger" type="submit">Delete</button>
    </form>
  </td></tr>`).join("");
  const methodCheckboxes = (selected: string[]) => methods.map((method) => `<label class="checkbox-label"><input type="checkbox" name="method_ids" value="${escapeHtml(method.id)}"${selected.includes(method.id) ? " checked" : ""}>${escapeHtml(method.name)}</label>`).join("");
  const materialRows = materials.map((material) => `<article class="material-admin-card"><div class="material-card-heading"><div><code>${escapeHtml(material.code)}</code><strong>${escapeHtml(material.name)}</strong></div><span>${material.active ? "Active" : "Disabled"} · ${material.usedByParts} parts</span></div>
    <form method="post" action="/admin/parts-tracking/materials/${encodeURIComponent(material.id)}" class="material-edit-form">
      <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><input type="hidden" name="active" value="${material.active ? "true" : "false"}"><label>Material name<input name="name" value="${escapeHtml(material.name)}" maxlength="100" required></label><fieldset><legend>Accepted by fabrication methods</legend><div class="checkbox-grid">${methodCheckboxes(material.methodIds)}</div></fieldset><button type="submit">Save material</button>
    </form><div class="material-card-actions">
      <form method="post" action="/admin/parts-tracking/materials/${encodeURIComponent(material.id)}"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><input type="hidden" name="name" value="${escapeHtml(material.name)}"><input type="hidden" name="active" value="${material.active ? "false" : "true"}">${material.methodIds.map((id) => `<input type="hidden" name="method_ids" value="${escapeHtml(id)}">`).join("")}<button class="small-button secondary" type="submit">${material.active ? "Disable" : "Enable"}</button></form>
      <form method="post" action="/admin/parts-tracking/materials/${encodeURIComponent(material.id)}/delete" onsubmit="return confirm('Permanently delete this material?')"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><button class="small-button danger" type="submit">Delete</button></form>
    </div></article>`).join("");
  return layout(
    "Admin Parts Tracking",
    `<section class="admin-heading"><div><p class="eyebrow"><a href="/admin">Administrator</a> / Parts Tracking</p><h1>Parts Tracking form</h1><p>Change what the team sees without weakening the required registration data.</p></div><a class="button secondary" href="/parts-tracking">Preview form</a></section>
     ${notice(message, isError ? "error" : "success")}
     <section class="admin-config-grid">
       <form method="post" action="/admin/parts-tracking/settings" class="card form-card">
         <h2>Question wording</h2><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}">
         <label>Form title<input name="form_title" value="${escapeHtml(settings.formTitle)}" maxlength="120" required></label>
         <label>Name question<input name="name_label" value="${escapeHtml(settings.nameLabel)}" maxlength="80" required></label>
         <label>Name placeholder<input name="name_placeholder" value="${escapeHtml(settings.namePlaceholder)}" maxlength="160" required></label>
         <label>Quantity question<input name="quantity_label" value="${escapeHtml(settings.quantityLabel)}" maxlength="80" required></label>
         <label>Subsystem question<input name="subsystem_label" value="${escapeHtml(settings.subsystemLabel)}" maxlength="80" required></label>
         <label>Designer question<input name="designer_label" value="${escapeHtml(settings.designerLabel)}" maxlength="80" required></label>
         <label>Fabrication-method question<input name="fabrication_method_label" value="${escapeHtml(settings.fabricationMethodLabel)}" maxlength="80" required></label>
         <label>Material question<input name="material_label" value="${escapeHtml(settings.materialLabel)}" maxlength="80" required></label>
         <label>Submit button<input name="submit_label" value="${escapeHtml(settings.submitLabel)}" maxlength="100" required></label>
         <button type="submit">Save form wording</button>
       </form>
       <section class="card"><h2>Fabrication methods</h2><p class="muted">Codes become part of permanent tracking IDs. Existing codes cannot be edited here; rename or disable the visible option instead.</p>
         <div class="sheet-scroll"><table><thead><tr><th>Code</th><th>Name</th><th>Status</th><th>Parts</th><th>Actions</th></tr></thead><tbody>${methodRows || '<tr><td colspan="5" class="empty">No fabrication methods</td></tr>'}</tbody></table></div>
         <form method="post" action="/admin/parts-tracking/methods" class="inline-create-form"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><label>New code<input name="code" pattern="[A-Z0-9]+" maxlength="12" required placeholder="WATERJET"></label><label>New method name<input name="name" maxlength="100" required placeholder="Waterjet"></label><button type="submit">Add method</button></form>
       </section>
       <section class="card materials-admin"><h2>Materials</h2><p class="muted">A material appears only after the user chooses one of its accepted fabrication methods. Codes are permanent once used by a part.</p>
         <div class="material-admin-list">${materialRows || '<p class="empty">No materials configured</p>'}</div>
         <form method="post" action="/admin/parts-tracking/materials" class="material-create-form"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><label>New code<input name="code" pattern="[A-Z0-9]+" maxlength="12" required placeholder="STEEL"></label><label>New material name<input name="name" maxlength="100" required placeholder="Steel"></label><fieldset><legend>Accepted by fabrication methods</legend><div class="checkbox-grid">${methodCheckboxes([])}</div></fieldset><button type="submit">Add material</button></form>
       </section>
     </section>`,
    user,
    csrf,
  );
}

export function errorPage(title: string, message: string, status: number, user?: AuthenticatedUser, csrf = ""): string {
  return layout(title, `<section class="card error-card"><p class="eyebrow">Error ${status}</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><a class="button" href="/">Return home</a></section>`, user, csrf);
}
