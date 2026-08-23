# UnderSync Onshape Selection Spike

**Report date:** 2026-08-23  
**Scope:** Disposable local OAuth and Element Right Panel selection-message spike only  
**Production implementation:** Not started

## Environment

- Node version: `v24.16.0`
- OS: Microsoft Windows `10.0.26200.9168`
- Local URL: `http://localhost:8000`
- Panel URL: `http://localhost:8000/panel`
- Onshape server: `https://cad.onshape.com`
- Local process started successfully: **YES**
- Automated tests: **8 passed, 0 failed**
- TypeScript type check: **PASSED**

Live local probes returned:

- `GET /health`: HTTP `200`
- `GET /panel?...`: HTTP `200`
- `GET /oauth/login`: HTTP `302` to `https://oauth.onshape.com/oauth/authorize` with `response_type`, client ID, exact callback, and random state
- `POST /api/onshape/test` before OAuth: local HTTP `401`, correctly reporting that authentication is required

## OAuth

- Authorization successful: **NO — requires interactive Onshape grant**
- Token exchange successful: **NO — no authorization code has been issued yet**
- API request successful: **NO — intentionally blocked until a token exists**
- HTTP status: **No upstream Onshape status yet**; local pre-authentication response was HTTP `401`

The credentials were supplied to the running process through environment variables and are not hardcoded or written to `.env` by this implementation. The OAuth redirect construction and state rejection were tested locally. Completing the flow requires the OAuth application to have the exact `http://localhost:8000/oauth/callback` redirect registered and a user to authorize it in a browser.

## Right Panel

- Panel loaded: **YES locally (HTTP 200); NO real Onshape iframe observation yet**
- `applicationInit` sent: **NO real Onshape observation yet**; the implemented code sends it once only when trusted `server`, `documentId`, workspace/version ID, and `elementId` are present
- `documentId` received: **NO real Onshape observation yet**
- workspace/version received: **NO real Onshape observation yet**
- `elementId` received: **NO real Onshape observation yet**

The panel parses and displays `server`, `documentId`, `workspaceOrVersion`, `workspaceOrVersionId` (with `workspaceId`/`versionId` fallbacks), `elementId`, and `configuration`. It maps the current workspace/version ID to the `workspaceId` property required by Onshape's documented `applicationInit` message.

Inbound `message` events are accepted only when `event.origin` exactly matches the normalized `server` origin, and only HTTPS `onshape.com` hosts can become trusted origins. Accepted and rejected messages are logged with timestamp, direction, origin, `messageName`, and the complete cloneable message data.

## Selection

- Single selection received: **NO — private extension has not been opened in Onshape**
- Multiple selection received: **NO — private extension has not been opened in Onshape**
- Empty selection handled: **NO real payload yet**; local parser tests pass for an explicit empty selection array
- Raw payload captured: **NO real Onshape payload yet**

The client preserves the complete raw `SELECTION` message before deriving any summary. The conservative parser recognizes selection/entity arrays wherever they are nested, displays all entries in the raw JSON, extracts explicitly named entity/body/geometry/selection types and ID-like fields, and reports an unknown structure instead of guessing. A Download Event Log control saves all observed messages as JSON.

## Findings

### What is verified locally

1. The Express application runs on port 8000 and serves both the status page and right-panel page.
2. OAuth credentials are read only from environment variables.
3. The authorization redirect uses the official authorization URL, exact configurable callback, `response_type=code`, client ID, and a random state. The secret is absent from the redirect.
4. Invalid/expired OAuth state is rejected before token exchange.
5. The harmless API test targets `https://cad.onshape.com/api/users/sessioninfo` and will send a bearer token only after OAuth succeeds.
6. The panel's outbound message is exactly:

```json
{
  "messageName": "applicationInit",
  "documentId": "<context documentId>",
  "workspaceId": "<context workspaceOrVersionId>",
  "elementId": "<context elementId>"
}
```

7. `postMessage` uses the trusted Onshape origin as `targetOrigin`, not `*`.
8. Geometry/selection IDs are visibly labeled as observations and are not treated as durable UnderSync identities.

### What Onshape actually sent

No real Onshape client messages have been captured yet. Therefore this report does **not** claim an exact `SELECTION` payload structure, entity identifiers, empty-selection shape, or configuration behavior.

The official Element Right Panel documentation states that Onshape begins sending messages with `messageName: "SELECTION"` after receiving a valid `applicationInit`, but it does not document the exact spontaneous `SELECTION` payload schema. That missing evidence is the reason this spike must be opened inside an actual Part Studio. [Official right-panel messaging](https://onshape-public.github.io/docs/app-dev/messages/element-right-panel/)

### Expected resolution call to validate

The official API identifies `getPartStudioBodyDetails` as the call that provides body details/selection IDs:

```text
GET /api/{version}/partstudios/d/{did}/{wvm}/{wvmid}/e/{eid}/bodydetails
```

After observing the actual `SELECTION` identifier, the next test should call this endpoint with the captured document/workspace-or-version/element context and active configuration, then match the selection identifier to a returned body/part. Richer Part Number/name/custom metadata may require the Parts or Metadata endpoint after that mapping. [Official Part Studio body-details guide](https://onshape-public.github.io/docs/api-adv/partstudios/)

This is a hypothesis grounded in the official API, not a completed resolution result. The exact join key must be confirmed from the real payload.

## Problems

1. Creating the OAuth application, registering the exact redirect URL, creating the Element Right Panel extension, creating/assigning its private store entry, and subscribing the test user are manual Onshape operations.
2. This environment cannot interactively sign in to the owner's Onshape account or approve the OAuth grant.
3. Without that subscription/configuration, the panel cannot be loaded by the real Onshape parent frame and no authentic `SELECTION` event can be produced.
4. Generic extension documentation describes embedded pages as HTTPS, while Onshape's current official Hello World tutorial explicitly uses `http://localhost:8000`. The actual browser/account must confirm that current localhost mixed-content behavior works for Team 1156. [Official localhost Hello World](https://onshape-public.github.io/docs/app-dev/helloworld/)
5. The system-wide npm cache was not writable. Installation succeeded with a workspace-local `.npm-cache`, which is ignored by source control.
6. The initial `tsx` test runner failed before tests because the environment could not resolve its OS-user temporary directory. The dependency was removed; the spike now compiles with TypeScript and runs/tests with plain Node.js.

## Manual configuration still required

1. In Onshape Developer settings, register the OAuth application and the exact callback `http://localhost:8000/oauth/callback`.
2. Add an **Element right panel / Inside Part Studio** extension with this Action URL:

```text
http://localhost:8000/panel?documentId={$documentId}&workspaceOrVersion={$workspaceOrVersion}&workspaceOrVersionId={$workspaceOrVersionId}&elementId={$elementId}&configuration={$configuration}
```

Onshape supplies `server` as a default query parameter for this extension location.

3. Create the private store entry and subscribe the test user, or assign the internal app if the account context supports assignment.
4. Keep the local process running, authenticate at `http://localhost:8000`, open a test Part Studio, and open the panel.
5. Select one body, multiple entities, and no entities; download the event log after all three cases.
6. Paste or retain the downloaded JSON so this report can be updated with the exact evidence.

## Conclusion

1. **Can UnderSync reliably detect what the user selected in the Onshape viewport?**  
   **Not proven yet.** The documented handshake and secure listener are implemented, but reliability requires authentic single, multiple, and cleared-selection messages from the Onshape iframe.

2. **Can it obtain `documentId`/`workspaceId`/`elementId`?**  
   **The mechanism is implemented but not yet proven against the real extension.** The official Action URL replacements support document, workspace/version, and element context, and the panel displays them directly.

3. **Can it identify the selected part/body?**  
   **Not yet proven.** The panel will expose all raw selection identifiers, but no real payload exists yet to establish which identifier represents a body or Part.

4. **What additional Onshape API call is required to resolve the selected entity into useful part metadata?**  
   The first resolution candidate is `getPartStudioBodyDetails` for the captured document/workspace-or-version/element/configuration. After matching its body/part identifier, call the relevant Parts or Metadata endpoint for richer part properties. This must be tested rather than assumed.

5. **What information is NOT available directly from the `SELECTION` message?**  
   **Unknown until a real payload is captured.** The current official guide does not specify the spontaneous payload schema. The spike must determine whether it includes a Part ID, only lower-level geometry IDs, body type, configuration, occurrence data, names, metadata, or none of those.

6. **What should the next development spike test?**  
   Complete this same spike inside Onshape, save the three raw selection cases, then add one read-only `getPartStudioBodyDetails` request to prove whether the observed selection ID maps to the intended Part under the active configuration. Do not proceed to Stage 1 before that evidence exists.
