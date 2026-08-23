const configured = document.querySelector("#oauth-configured");
const authenticated = document.querySelector("#oauth-authenticated");
const apiBase = document.querySelector("#api-base");
const oauthError = document.querySelector("#oauth-error");
const apiResult = document.querySelector("#api-result");
const testButton = document.querySelector("#test-api");

async function refreshStatus() {
  const response = await fetch("/api/auth/status");
  const status = await response.json();
  configured.textContent = status.oauthConfigured ? "YES" : "NO";
  configured.className = status.oauthConfigured ? "ok" : "error";
  authenticated.textContent = status.authenticated ? "YES" : "NO";
  authenticated.className = status.authenticated ? "ok" : "pending";
  apiBase.textContent = status.apiBaseUrl;
  testButton.disabled = !status.authenticated;
  if (status.lastError) {
    oauthError.textContent = status.lastError;
    oauthError.classList.remove("hidden");
  }
}

testButton.addEventListener("click", async () => {
  testButton.disabled = true;
  apiResult.textContent = "Calling harmless Onshape session-info endpoint…";
  try {
    const response = await fetch("/api/onshape/test", { method: "POST" });
    const result = await response.json();
    apiResult.textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    apiResult.textContent = String(error);
  } finally {
    await refreshStatus();
  }
});

refreshStatus().catch((error) => {
  oauthError.textContent = String(error);
  oauthError.classList.remove("hidden");
});
