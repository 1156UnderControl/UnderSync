import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml } from "../src/pages.js";
import { hashToken, isValidEmail, safeEqual, validatePassword } from "../src/security.js";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "../src/integration-crypto.js";
import { parseSelectionInput, trackedOnshapeName } from "../src/onshape.js";

test("security helpers validate account input and tokens", () => {
  assert.equal(isValidEmail("member@team.test"), true);
  assert.equal(isValidEmail("not-an-email"), false);
  assert.match(validatePassword("short") ?? "", /at least 8/);
  assert.equal(validatePassword("long-enough"), undefined);
  assert.equal(hashToken("secret").length, 64);
  assert.equal(safeEqual("same", "same"), true);
  assert.equal(safeEqual("same", "different"), false);
});

test("HTML output escapes database and account values", () => {
  assert.equal(escapeHtml('<script>alert("x")</script>'), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
});

test("integration secrets are authenticated and Onshape rename rules are deterministic", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  const encrypted = encryptIntegrationSecret("oauth-token", key);
  assert.notEqual(encrypted, "oauth-token");
  assert.equal(decryptIntegrationSecret(encrypted, key), "oauth-token");
  assert.equal(trackedOnshapeName("Form Part Name", "1156-26-S-3D-TBD-003"), "Form Part Name | 1156-26-S-3D-TBD-003");
  assert.equal(trackedOnshapeName("Camera mount", "1156-26-S-3D-TBD-003"), "Camera mount | 1156-26-S-3D-TBD-003");
  assert.equal(trackedOnshapeName("Camera mount | 1156-26-S-3D-TBD-003", "1156-26-S-3D-TBD-003"), "Camera mount | 1156-26-S-3D-TBD-003");
});

test("selection parsing drops unresolved Onshape action parameters", () => {
  const selection = parseSelectionInput({
    documentId: "doc", workspaceId: "workspace", elementId: "element", microversionId: "micro",
    selectionId: "RdDD", selectionType: "BODY", configuration: "{$configuration}",
  });
  assert.equal(selection.configuration, undefined);
  assert.equal(selection.selectionId, "RdDD");
});
