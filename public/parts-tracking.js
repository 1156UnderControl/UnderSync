const query = new URL(location.href).searchParams;
const extensionValue = (value) => {
  const text = typeof value === "string" ? value.trim() : "";
  return !text || /^\{\$[A-Za-z][A-Za-z0-9]*\}$/.test(text) ? "" : text;
};
const context = {
  server: extensionValue(query.get("server")) || "https://cad.onshape.com",
  documentId: extensionValue(query.get("documentId")),
  workspaceId: extensionValue(query.get("workspaceOrVersionId")) || extensionValue(query.get("workspaceId")),
  elementId: extensionValue(query.get("elementId")),
  configuration: extensionValue(query.get("configuration")),
};
const form = document.querySelector("#tracking-form");
const errorBox = document.querySelector("#selection-error");
const details = document.querySelector("#selection-details");
const resultBox = document.querySelector("#registration-result");
let selection;
let resolved;

const methodSelect = form.elements.namedItem("methodId");
const materialField = document.querySelector("#material-field");
const materialSelect = form.elements.namedItem("materialId");
const materialHelp = document.querySelector("#material-help");

function refreshMaterials() {
  const methodId = methodSelect.value;
  let compatible = 0;
  for (const option of [...materialSelect.options].slice(1)) {
    const allowed = Boolean(methodId && option.dataset.methodIds?.split(" ").includes(methodId));
    option.hidden = !allowed;
    option.disabled = !allowed;
    if (allowed) compatible += 1;
  }
  materialSelect.value = "";
  materialField.hidden = !methodId;
  materialSelect.disabled = !methodId || compatible === 0;
  materialHelp.textContent = compatible > 0 ? "Choose a compatible material." : "No active materials are configured for this fabrication method.";
}
methodSelect.addEventListener("change", refreshMaterials);
refreshMaterials();

function trustedOrigin() {
  try {
    const url = new URL(context.server);
    return url.protocol === "https:" && (url.hostname === "onshape.com" || url.hostname.endsWith(".onshape.com")) ? url.origin : null;
  } catch { return null; }
}
function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
  document.querySelector("#selection-title").textContent = "Selection could not be resolved";
  form.hidden = true;
}
function selectionFrom(message) {
  const items = Array.isArray(message.selections) ? message.selections : Array.isArray(message.selection) ? message.selection : [];
  if (items.length !== 1) throw new Error("Select exactly one body, face, or edge.");
  const item = items[0] ?? {};
  return {
    documentId: extensionValue(message.documentId) || context.documentId,
    workspaceId: extensionValue(message.workspaceId) || context.workspaceId,
    elementId: extensionValue(message.elementId) || context.elementId,
    microversionId: extensionValue(item.workspaceMicroversionId) || extensionValue(message.workspaceMicroversionId) || extensionValue(message.microversionId),
    selectionId: extensionValue(item.selectionId), selectionType: extensionValue(item.selectionType),
    entityType: extensionValue(item.entityType), configuration: extensionValue(message.configuration) || context.configuration,
  };
}
async function resolveSelection(message) {
  errorBox.hidden = true;
  form.hidden = true;
  document.querySelector("#selection-title").textContent = "Resolving selected geometry…";
  selection = selectionFrom(message);
  const response = await fetch("/api/onshape/selection/resolve", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(selection),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Resolution returned HTTP ${response.status}.`);
  resolved = body;
  document.querySelector("#selection-title").textContent = "Part selected";
  document.querySelector("#selection-help").textContent = "Complete the details, then generate the permanent tracking ID.";
  document.querySelector("#selected-name").textContent = body.name || "Unnamed part";
  document.querySelector("#selected-part-id").textContent = body.partId;
  document.querySelector("#selected-microversion").textContent = body.microversionId;
  const nameInput = form.elements.namedItem("name");
  if (!nameInput.value && body.name && !/^part\s+\d+$/i.test(body.name)) nameInput.value = body.name;
  details.hidden = false;
  form.hidden = false;
}

window.addEventListener("message", (event) => {
  const origin = trustedOrigin();
  if (!origin || event.origin !== origin || event.data?.messageName !== "SELECTION") return;
  resolveSelection(event.data).catch((error) => showError(String(error.message || error)));
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selection || !resolved) return showError("Select and resolve a part first.");
  const submit = form.querySelector("button[type=submit]");
  submit.disabled = true;
  resultBox.hidden = false;
  resultBox.className = "result-card";
  resultBox.textContent = "Registering in UnderSync and renaming the Onshape part…";
  const data = new FormData(form);
  try {
    const response = await fetch("/api/parts-tracking/register", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ _csrf: data.get("_csrf"), selection, name: data.get("name"), quantity: data.get("quantity"), subsystemId: data.get("subsystemId"), designerId: data.get("designerId"), methodId: data.get("methodId"), materialId: data.get("materialId") }),
    });
    const body = await response.json();
    if (!response.ok && response.status !== 207) throw new Error(body.error || `Registration returned HTTP ${response.status}.`);
    resultBox.classList.toggle("warning", body.renameStatus === "FAILED");
    resultBox.innerHTML = `<span>${body.renameStatus === "FAILED" ? "Registered; Onshape rename needs attention" : "Registration complete"}</span><strong>${escapeHtml(body.trackingCode)}</strong><p>${body.renameStatus === "FAILED" ? escapeHtml(body.warning) : `Onshape name: ${escapeHtml(body.onshapeName)}`}</p>`;
    submit.textContent = "Registered";
  } catch (error) {
    resultBox.className = "notice error";
    resultBox.textContent = String(error.message || error);
    submit.disabled = false;
  }
});

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

const origin = trustedOrigin();
if (window.parent !== window && origin && context.documentId && context.workspaceId && context.elementId) {
  window.parent.postMessage({ messageName: "applicationInit", documentId: context.documentId, workspaceId: context.workspaceId, elementId: context.elementId }, origin);
} else if (window.parent === window) {
  document.querySelector("#selection-help").textContent = "This standalone page is ready. Open the UnderSync extension inside an Onshape Part Studio to receive selections.";
} else {
  showError("The Onshape Action URL is missing valid server, document, workspace, or element parameters.");
}
