# UnderSync Onshape Selection and Part Resolution Spikes

This repository currently contains disposable local proof-of-concepts for observing selection messages from an Onshape Element Right Panel and resolving one selected body through authenticated Onshape REST calls. It is not the UnderSync production application.

The local PostgreSQL development foundation is documented separately in [DATABASE.md](DATABASE.md).

The implementation follows Onshape's official [Element Right Panel messaging documentation](https://onshape-public.github.io/docs/app-dev/messages/element-right-panel/), [extension parameter documentation](https://onshape-public.github.io/docs/app-dev/extensions/), [localhost Hello World example](https://onshape-public.github.io/docs/app-dev/helloworld/), and [OAuth guide](https://onshape-public.github.io/docs/auth/oauth/).

## Local setup

Requirements: Node.js 24 or a current supported Node.js release.

```powershell
npm.cmd install
Copy-Item .env.example .env
```

Edit `.env` and set the Onshape OAuth client ID and secret. The requested local values must be supplied through these environment variables; they are intentionally absent from source control.

The registered redirect URL and `ONSHAPE_REDIRECT_URI` must match exactly. The default is:

```text
http://localhost:8000/oauth/callback
```

Start the spike:

```powershell
npm.cmd start
```

Then open [http://localhost:8000](http://localhost:8000). Tokens exist only in the running Node process and disappear when it stops.

## Manual Onshape configuration

These steps must be performed in Onshape; code cannot create or subscribe the private UI extension for you.

1. Go to **My account → Developer** (or the applicable Classroom/Company Developer settings).
2. Register a private OAuth application.
3. Add `http://localhost:8000/oauth/callback` as an exact redirect URL.
4. Grant the minimum read permission needed for the harmless session-info API test.
5. Add an extension:
   - Location: **Element right panel**
   - Context: **Inside Part Studio**
   - Action URL:

```text
http://localhost:8000/panel?documentId={$documentId}&workspaceOrVersion={$workspaceOrVersion}&workspaceOrVersionId={$workspaceOrVersionId}&elementId={$elementId}&configuration={$configuration}
```

Onshape supplies `server`, `companyId`, `userId`, `locale`, and `clientId` as default query parameters for this extension location. The current parameters above avoid deprecated `{$workspaceId}`/`{$versionId}` replacements.

If Onshape leaves an unavailable action parameter literal (for example, `configuration={$configuration}` in an unconfigured Part Studio), the panel and backend treat it as absent. The REST request then omits `configuration`, allowing Onshape to use the element's default configuration.

6. For an individual account, create the private store entry and subscribe to it. Company/Classroom/Enterprise admins may instead assign the internal app to users.
7. Reload Onshape, open a Part Studio, and click the new right-panel icon.

The official Hello World guide uses localhost for this flow. `localhost` refers to the computer running the browser; the local Node process must still be running there.

## Test procedure

1. Open the local home page and choose **Authenticate with Onshape**.
2. Confirm the redirect returns to the configured callback and reports success.
3. Choose **Test Onshape API** and record the returned HTTP status and JSON.
4. Open the private right panel in a test Part Studio.
5. Confirm the panel displays server, document, workspace/version, element, and configuration context.
6. Select one body, multiple entities, and then clear the selection.
7. Inspect the raw `SELECTION` message after each action.
8. Use **Download event log** to save the complete accepted/rejected message record.
9. With exactly one body selected, choose **Resolve Selected Body**. A cache miss makes one microversion-specific Parts-list request, matches the exact Part ID, and stops. Repeated selections in the same immutable context use the bounded cache.
10. With exactly one face or edge selected, choose **Investigate FACE/EDGE Ownership**. This never treats the face/edge ID as a Part ID; it uses the cached Parts list and, when missing, one body-details request to build a bounded ownership index.
11. Leave diagnostic mode off during normal use. Enable it only when raw remote response evidence is required; normal responses contain only normalized part identity fields.
12. Use **API budget and memory** to inspect session calls, endpoint counts, cache behavior, failures, duration, RSS, and configured quota estimate. It reads local counters and never polls Onshape.

The panel accepts inbound messages only when `event.origin` exactly equals the trusted Onshape `server` origin supplied in the Action URL. It also restricts that origin to HTTPS `onshape.com` hosts. Geometry IDs are displayed as observations only and are never treated as permanent UnderSync identities.

## Local verification

```powershell
npm.cmd run typecheck
npm.cmd test
```

These checks validate the local server, OAuth redirect construction/state rejection, static panel, unauthenticated API behavior, conservative selection parsing, one-call BODY resolution, shared FACE/EDGE ownership caching, simultaneous-request deduplication, diagnostic evidence gating, and the prohibition on name matching. Only a real Onshape-hosted iframe and authenticated account can prove the actual API responses for the supplied document.
