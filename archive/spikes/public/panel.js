import { summarizeSelection } from "/selection-summary.js";

const parameters = new URL(window.location.href).searchParams;
function actionParameter(name) {
  const value = parameters.get(name) ?? "";
  return extensionValue(value);
}

function extensionValue(value) {
  if (typeof value !== "string") return "";
  return /^\{\$[A-Za-z][A-Za-z0-9]*\}$/.test(value.trim()) ? "" : value;
}

const context = {
  server: actionParameter("server"),
  documentId: actionParameter("documentId"),
  workspaceOrVersion: actionParameter("workspaceOrVersion") || actionParameter("workspaceType"),
  workspaceOrVersionId:
    actionParameter("workspaceOrVersionId") ||
    actionParameter("workspaceId") ||
    actionParameter("versionId"),
  elementId: actionParameter("elementId"),
  configuration: actionParameter("configuration"),
};

const elements = {
  handshake: document.querySelector("#handshake-status"),
  count: document.querySelector("#selection-count"),
  types: document.querySelector("#selection-types"),
  identifiers: document.querySelector("#selection-identifiers"),
  raw: document.querySelector("#selection-raw"),
  log: document.querySelector("#event-log"),
  authStatus: document.querySelector("#auth-status"),
  apiResult: document.querySelector("#api-result"),
  testApi: document.querySelector("#test-api"),
  resolveBody: document.querySelector("#resolve-body"),
  investigateOwnership: document.querySelector("#investigate-ownership"),
  copyResolution: document.querySelector("#copy-resolution"),
  copyResolutionStatus: document.querySelector("#copy-resolution-status"),
  diagnosticMode: document.querySelector("#diagnostic-mode"),
  refreshDiagnostics: document.querySelector("#refresh-diagnostics"),
  diagnosticsResult: document.querySelector("#diagnostics-result"),
  resolveExplanation: document.querySelector("#resolve-explanation"),
  resolutionResult: document.querySelector("#resolution-result"),
  newPartName: document.querySelector("#new-part-name"),
  renamePart: document.querySelector("#rename-part"),
  renameStatus: document.querySelector("#rename-status"),
  renameResult: document.querySelector("#rename-result"),
};

const eventLog = [];
const maxEventLogEntries = 200;
let trustedOrigin = null;
let currentSelection = null;
let currentSelectionItems = [];
let authenticated = false;
let rawResolutionEvidence = "";
let lastResolvedPart = null;

function text(selector, value) {
  document.querySelector(selector).textContent = value || "—";
}

function deriveTrustedOrigin(server) {
  try {
    const parsed = new URL(server);
    const isOnshapeHost = parsed.hostname === "onshape.com" || parsed.hostname.endsWith(".onshape.com");
    if (parsed.protocol !== "https:" || !isOnshapeHost) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function cloneForLog(value) {
  try {
    return structuredClone(value);
  } catch {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return String(value);
    }
  }
}

function appendLog(direction, origin, data, accepted = true) {
  eventLog.push({
    timestamp: new Date().toISOString(),
    direction,
    origin,
    accepted,
    messageName: data && typeof data === "object" ? data.messageName ?? null : null,
    message: cloneForLog(data),
  });
  if (eventLog.length > maxEventLogEntries) {
    eventLog.splice(0, eventLog.length - maxEventLogEntries);
  }
  elements.log.textContent = JSON.stringify(eventLog.slice().reverse(), null, 2);
}

function clearDisplayedSelection() {
  currentSelection = null;
  currentSelectionItems = [];
  elements.count.textContent = "No SELECTION message yet";
  elements.types.textContent = "—";
  elements.identifiers.textContent = "—";
  elements.raw.textContent = "No SELECTION message received.";
  lastResolvedPart = null;
  updateResolutionControls();
  updateRenameControl();
}

function displaySelection(message) {
  const summary = summarizeSelection(message);
  currentSelection = message;
  currentSelectionItems = summary.selectionItems;
  lastResolvedPart = null;
  elements.count.textContent =
    summary.entityCount === null
      ? "Unknown — inspect raw payload"
      : String(summary.entityCount);
  elements.types.textContent = summary.entityTypes.length > 0 ? summary.entityTypes.join(", ") : "Not explicitly identified";
  elements.identifiers.textContent =
    summary.identifiers.length > 0
      ? summary.identifiers.map((identifier) => `${identifier.key}=${identifier.value}`).join("\n")
      : "No ID-like fields found by conservative parser";
  elements.raw.textContent = JSON.stringify(message, null, 2);
  updateResolutionControls();
  updateRenameControl();
}

function selectionRequest() {
  if (!currentSelection || currentSelectionItems.length !== 1) return null;
  const item = currentSelectionItems[0];
  return {
    documentId: currentSelection.documentId ?? context.documentId,
    workspaceId: currentSelection.workspaceId ?? context.workspaceOrVersionId,
    elementId: currentSelection.elementId ?? context.elementId,
    microversionId: item.workspaceMicroversionId ?? currentSelection.workspaceMicroversionId,
    selectionId: item.selectionId,
    selectionType: item.selectionType,
    entityType: item.entityType,
    configuration: extensionValue(currentSelection.configuration ?? context.configuration),
  };
}

function updateResolutionControls() {
  const request = selectionRequest();
  const isBody = request?.selectionType === "BODY";
  const isOwnedEntity =
    request?.selectionType === "ENTITY" && ["FACE", "EDGE"].includes(request?.entityType);
  const hasCapturedContext = Boolean(
    request?.documentId && request?.workspaceId && request?.elementId && request?.microversionId,
  );
  elements.resolveBody.disabled = !(authenticated && isBody && hasCapturedContext);
  elements.investigateOwnership.disabled = !(authenticated && isOwnedEntity && hasCapturedContext);

  if (!authenticated) elements.resolveExplanation.textContent = "Authenticate with Onshape first.";
  else if (!request) elements.resolveExplanation.textContent = "Select exactly one entity; none or multiple selections are not resolvable.";
  else if (!hasCapturedContext) elements.resolveExplanation.textContent = "The selection lacks required document/workspace/element/microversion context.";
  else if (isBody) elements.resolveExplanation.textContent = "One BODY is selected and can be resolved by exact ID.";
  else if (isOwnedEntity) elements.resolveExplanation.textContent = `One ${request.entityType} is selected; body ownership can be investigated structurally.`;
  else elements.resolveExplanation.textContent = `Selection type ${request.selectionType ?? "unknown"} is not supported for body resolution.`;
}

function updateRenameControl() {
  const newName = elements.newPartName.value.trim();
  elements.renamePart.disabled = !(authenticated && lastResolvedPart?.partId && newName.length >= 1 && newName.length <= 256);
}

function showResolution(result) {
  const part = result.part ?? result;
  const input = result.input ?? selectionRequest() ?? {};
  document.querySelector("#resolved-document").textContent = input.documentId ?? "Not available from this API";
  document.querySelector("#resolved-workspace").textContent = input.workspaceId ?? "Not available from this API";
  document.querySelector("#resolved-element").textContent = input.elementId ?? "Not available from this API";
  document.querySelector("#resolved-microversion").textContent = input.microversionId ?? input.sourceMicroversionId ?? "Not available from this API";
  document.querySelector("#resolved-selection").textContent = input.selectionId ?? input.geometryId ?? "Not available from this API";
  document.querySelector("#resolved-selection-type").textContent = input.selectionType ?? input.entityType ?? "Not available from this API";
  document.querySelector("#resolved-status").textContent = result.partId
    ? "RESOLVED"
    : `${result.status ?? "ERROR"}: ${result.reason ?? result.error ?? "See response"}`;
  document.querySelector("#resolved-part-id").textContent = part.partId ?? result.candidatePartIds?.[0] ?? "Not available from this API";
  document.querySelector("#resolved-name").textContent = part.name ?? "Not available from this API";
  document.querySelector("#resolved-number").textContent = part.partNumber ?? "Not available from this API";
  document.querySelector("#resolved-configuration").textContent = part.configuration ?? selectionRequest()?.configuration ?? "Not available from this API";
  rawResolutionEvidence = JSON.stringify(result, null, 2);
  elements.resolutionResult.textContent = rawResolutionEvidence;
  elements.copyResolution.disabled = !result.diagnostic;
  elements.copyResolutionStatus.textContent = result.diagnostic
    ? "Diagnostic evidence is available to copy."
    : "Enable diagnostic mode before resolving to retain raw API evidence.";
  if (result.partId) {
    lastResolvedPart = result;
    const suggestedName = `${result.name ?? "Part"} | UDS-TEST`;
    if (!elements.newPartName.dataset.edited) elements.newPartName.value = suggestedName;
  }
  updateRenameControl();
}

elements.newPartName.addEventListener("input", () => {
  elements.newPartName.dataset.edited = "true";
  updateRenameControl();
});

elements.renamePart.addEventListener("click", async () => {
  const request = selectionRequest();
  if (!request || !lastResolvedPart?.partId) return;
  elements.renamePart.disabled = true;
  elements.renameStatus.textContent = "Sending one rename request to Onshape…";
  try {
    const response = await fetch("/api/onshape/rename-part", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...request, newName: elements.newPartName.value }),
    });
    const result = await response.json();
    elements.renameResult.textContent = JSON.stringify(result, null, 2);
    rawResolutionEvidence = JSON.stringify(result, null, 2);
    elements.copyResolution.disabled = false;
    elements.copyResolutionStatus.textContent = "Rename API evidence is available to copy.";
    if (!response.ok) throw new Error(result.error ?? `Rename returned HTTP ${response.status}`);
    elements.renameStatus.textContent = result.status === "UNCHANGED"
      ? "Name was already identical; no write call was made."
      : `Rename successful: ${result.oldName ?? "(unknown)"} → ${result.newName}`;
    lastResolvedPart = { ...lastResolvedPart, name: result.newName };
    document.querySelector("#resolved-name").textContent = result.newName;
  } catch (error) {
    elements.renameStatus.textContent = `Rename failed: ${String(error)}`;
  } finally {
    updateRenameControl();
    refreshDiagnostics().catch((error) => {
      elements.diagnosticsResult.textContent = String(error);
    });
  }
});

elements.copyResolution.addEventListener("click", async () => {
  if (!rawResolutionEvidence) return;
  try {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(rawResolutionEvidence);
        elements.copyResolutionStatus.textContent = "Raw API evidence copied to the clipboard.";
        return;
      } catch {
        // Embedded iframes may deny the modern Clipboard API; try the user-gesture fallback below.
      }
    }
    const copyArea = document.createElement("textarea");
    copyArea.value = rawResolutionEvidence;
    copyArea.setAttribute("readonly", "");
    copyArea.style.position = "fixed";
    copyArea.style.opacity = "0";
    document.body.appendChild(copyArea);
    copyArea.select();
    const copied = document.execCommand("copy");
    copyArea.remove();
    if (!copied) throw new Error("The browser denied clipboard access.");
    elements.copyResolutionStatus.textContent = "Raw API evidence copied to the clipboard.";
  } catch (error) {
    elements.copyResolutionStatus.textContent = `Could not copy automatically: ${String(error)}`;
  }
});

async function postResolution(path, body) {
  elements.resolveBody.disabled = true;
  elements.investigateOwnership.disabled = true;
  elements.resolutionResult.textContent = "Calling Onshape from the server…";
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, diagnostic: elements.diagnosticMode.checked }),
    });
    showResolution(await response.json());
  } catch (error) {
    showResolution({ status: "ERROR", error: String(error) });
  } finally {
    updateResolutionControls();
    refreshDiagnostics().catch((error) => {
      elements.diagnosticsResult.textContent = String(error);
    });
  }
}

elements.resolveBody.addEventListener("click", () => {
  const request = selectionRequest();
  if (request?.selectionType === "BODY") postResolution("/api/onshape/resolve-selection", request);
});

elements.investigateOwnership.addEventListener("click", () => {
  const request = selectionRequest();
  if (request) postResolution("/api/onshape/resolve-selection", request);
});

async function refreshDiagnostics() {
  const response = await fetch("/api/onshape/diagnostics");
  elements.diagnosticsResult.textContent = JSON.stringify(await response.json(), null, 2);
}

elements.refreshDiagnostics.addEventListener("click", () => {
  refreshDiagnostics().catch((error) => {
    elements.diagnosticsResult.textContent = String(error);
  });
});

function initializeContext() {
  text("#context-server", context.server);
  text("#context-document", context.documentId);
  text("#context-kind", context.workspaceOrVersion);
  text("#context-workspace", context.workspaceOrVersionId);
  text("#context-element", context.elementId);
  text("#context-configuration", context.configuration);

  trustedOrigin = deriveTrustedOrigin(context.server);
  const requiredValuesPresent = context.documentId && context.workspaceOrVersionId && context.elementId;
  if (!trustedOrigin || !requiredValuesPresent) {
    elements.handshake.textContent =
      "applicationInit not sent: trusted Onshape server or required context is missing.";
    elements.handshake.className = "status error";
    return;
  }

  const applicationInit = {
    messageName: "applicationInit",
    documentId: context.documentId,
    workspaceId: context.workspaceOrVersionId,
    elementId: context.elementId,
  };
  window.parent.postMessage(applicationInit, trustedOrigin);
  appendLog("outbound", trustedOrigin, applicationInit);
  elements.handshake.textContent = `applicationInit sent to ${trustedOrigin}`;
  elements.handshake.className = "status ok";
}

window.addEventListener("message", (event) => {
  const accepted = Boolean(trustedOrigin && event.origin === trustedOrigin);
  if (!accepted) {
    console.warn("Rejected postMessage from untrusted origin", event.origin, event.data);
    appendLog("inbound", event.origin, event.data, false);
    return;
  }

  console.log("Accepted Onshape message", {
    timestamp: new Date().toISOString(),
    origin: event.origin,
    message: event.data,
  });
  appendLog("inbound", event.origin, event.data, true);
  if (event.data && typeof event.data === "object" && event.data.messageName === "SELECTION") {
    displaySelection(event.data);
  }
});

document.querySelector("#clear-log").addEventListener("click", () => {
  eventLog.length = 0;
  elements.log.textContent = "No events yet.";
});
document.querySelector("#clear-selection").addEventListener("click", clearDisplayedSelection);
document.querySelector("#download-log").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(eventLog, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `selection-events-${new Date().toISOString().replaceAll(":", "-")}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
});

async function refreshAuthStatus() {
  const response = await fetch("/api/auth/status");
  const status = await response.json();
  elements.authStatus.textContent = status.authenticated
    ? `Authenticated locally; token received ${status.tokenReceivedAt}.`
    : status.oauthConfigured
      ? "OAuth configured but not authenticated."
      : "OAuth environment variables are missing.";
  authenticated = status.authenticated;
  elements.testApi.disabled = !status.authenticated;
  updateResolutionControls();
  updateRenameControl();
}

elements.testApi.addEventListener("click", async () => {
  elements.testApi.disabled = true;
  elements.apiResult.textContent = "Calling harmless Onshape API endpoint…";
  try {
    const response = await fetch("/api/onshape/test", { method: "POST" });
    elements.apiResult.textContent = JSON.stringify(await response.json(), null, 2);
  } catch (error) {
    elements.apiResult.textContent = String(error);
  } finally {
    await refreshAuthStatus();
  }
});

initializeContext();
refreshAuthStatus().catch((error) => {
  elements.authStatus.textContent = String(error);
});
refreshDiagnostics().catch((error) => {
  elements.diagnosticsResult.textContent = String(error);
});
window.addEventListener("focus", () => {
  refreshAuthStatus().catch((error) => {
    elements.authStatus.textContent = String(error);
  });
});
