# UnderSync Architecture Review

**Status:** Core local foundation and authentication implementation begun by product-owner direction; external integrations still await Stage 0 validation  
**Review date:** 2026-08-23  
**Scope:** Product consistency, domain architecture, Onshape and Notion feasibility, technical risks, and incremental delivery plan

## 1. Executive decision

UnderSync is feasible as a self-hosted, modular monolith. The best initial architecture is a TypeScript web application with a React frontend, a NestJS backend, PostgreSQL, a PostgreSQL-backed job queue, and local versioned file storage behind a storage interface. Onshape and Notion must be isolated behind adapters and asynchronous jobs; neither integration should be allowed to make the core application unavailable.

The product-owner decisions resolve the main domain ambiguities:

1. A `PartDefinition` owns one permanent Part Number; quantity belongs to `PartRequirement`.
2. Individually traceable physical units are `AssetInstance` records. Any COTS definition may enable individual tracking; motors are a specialization of this model.
3. A Part Number is allocated at registration and never reused. It identifies the part, not its current material or process.
4. Part revision records design evolution. A single display-only `*` indicates that current manufacturing method/material differs from the original values encoded in the Part Number.
5. Manufacturing requirements are evaluated progressively by lifecycle state. Missing files are readiness failures, not automatic Blockers.
6. Onshape tasks synchronize only through an explicit shared-field contract; conflicting concurrent edits become records requiring resolution.

The highest remaining risks are whether general Tasks and task API operations are available to Team 1156's actual Free/Education account combinations, private-app API quotas, absence of a documented task-specific webhook, unstable geometry IDs, and public HTTPS requirements during integration testing.

## 2. Verified external capabilities

### 2.1 Onshape

The current official documentation supports the following conclusions:

- OAuth 2.0 is the correct production authentication model. Access tokens expire and refresh-token rotation must be persisted atomically. API keys are suitable only for scripts/internal testing and authenticate the key owner rather than each user. App Store distribution requires OAuth. [Onshape OAuth documentation](https://onshape-public.github.io/docs/auth/oauth/)
- An Element Right Panel extension is an HTTPS page embedded in an iframe. It receives document/workspace/element context and can receive `SELECTION` messages after sending `applicationInit`. The selection payload can identify selected bodies/entities. Messages must be origin-validated. [Right-panel messaging](https://onshape-public.github.io/docs/app-dev/messages/element-right-panel/) and [extension security/context](https://onshape-public.github.io/docs/app-dev/extensions/)
- Onshape documents contain workspaces, immutable versions, and automatically created microversions. API reads may target workspace/version/microversion; writes generally target a workspace and create a new microversion. [Onshape document model](https://onshape-public.github.io/docs/api-intro/architecture/)
- A geometry Part ID is not a durable external key. Onshape explicitly says geometry IDs may change and provides an ID-translation endpoint between microversions; translation can resolve to zero, one, or multiple targets. [Onshape associativity](https://onshape-public.github.io/docs/api-adv/associativity/)
- Part and element metadata can be read and updated, including the Onshape Part number property. UnderSync can therefore optionally publish its assigned number back into Onshape, subject to permissions and an explicit ownership policy. [Onshape metadata API](https://onshape-public.github.io/docs/api-adv/metadata/)
- General task endpoints were added for list, create, retrieve, update, and transition operations (`/tasks`, `/tasks/{tid}`, and `/tasks/{tid}/{transition}`). [Onshape API changelog, rel-1.186](https://onshape-public.github.io/docs/changelog/)
- Webhooks cover model changes, metadata changes, versions, elements, comments, and release workflow transitions. The documented webhook event list does not identify a general-task create/update event. This means reliable Onshape-to-UnderSync task sync may require scoped polling unless the current API Explorer or the team's account exposes additional task events. [Onshape webhook documentation](https://onshape-public.github.io/docs/app-dev/webhook/)
- Private applications are subject to endpoint rate limits and annual account quotas. As currently documented, annual quotas range from 2,500 calls for several account types to 10,000 for Enterprise/EDU Enterprise groupings, while calls made through public App Store OAuth applications are excluded. A busy polling design is therefore unsafe. [Onshape API limits](https://onshape-public.github.io/docs/auth/limits/) and [rate-limit response behavior](https://onshape-public.github.io/docs/api-adv/errors/)

#### Team 1156 account constraints

UnderSync will be a private application owned and used only by FRC Team 1156. It will use OAuth for user-level grants, but its calls will still count as private-application calls. The documented allocation is 2,500 annual calls per user for Free and EDU Student subscriptions and 2,500 per company for EDU Educator; the application owner, not each authorizing user, bears the quota for private OAuth applications. This makes the choice of application owner operationally significant. [Onshape API limits](https://onshape-public.github.io/docs/auth/limits/)

Individual users can register OAuth applications and extensions from My Account → Developer, including an internal/test extension workflow. Team 1156 does not need public App Store publication, although Onshape's internal extension setup may still require creating a private store entry and subscribing users to it. [Onshape My Account — Developer](https://cad.onshape.com/help/Content/Plans/my_account_developer.htm)

Official plan descriptions establish that Free accounts are limited to public documents, EDU Student is comparable to Standard, and EDU Educator is comparable to Professional. [Onshape subscription help](https://cad.onshape.com/help/Content/Plans/managing_your_onshape_account_and_subscription.htm) and [Education plan comparison](https://www.onshape.com/en/education/plans)

General task capability remains a deployment gate. The REST API contains Tasks endpoints, but official help associates Action Items with managed Company/Enterprise/Classroom contexts and an official glossary identifies Action Items with Enterprise/Professional plans. The documentation does not provide enough evidence to promise general task creation/synchronization for every Free or Student account. [Onshape Action Items](https://cad.onshape.com/help/Content/Plans/action_items.htm) and [Onshape glossary](https://cad.onshape.com/help/Content/Home/glossary.htm)

The architecture therefore uses capability detection rather than plan-name assumptions. Each Onshape connection stores observed capabilities such as `oauth_connected`, `read_documents`, `read_parts`, `write_metadata`, `use_tasks`, `create_tasks`, `transition_tasks`, `use_webhooks`, and `right_panel_available`, along with the last check time and diagnostic evidence. Unsupported actions remain visible but disabled with an explanation and remediation path.

Consequences for the specification:

- Store `(server, document_id, workspace_or_version, workspace_or_version_id, element_id, configuration, microversion_id, geometry_id)` as a **CAD snapshot reference**, not `part_id` alone.
- On a model-change webhook, acknowledge quickly, enqueue reconciliation, fetch the new microversion, translate known IDs, then calculate a new snapshot/fingerprint. A webhook means “something changed,” not “this particular linked part changed geometry.”
- Treat “geometry changed,” “metadata changed,” “configuration changed,” and “drawing changed” as separate findings with different evidence and acceptance actions.
- Make Onshape polling budgets configurable and visible. Stage 0 must confirm the team's exact subscription quota and task endpoint schemas.
- Do not infer API capability solely from `FREE`, `STUDENT`, or `EDUCATOR`. Run harmless capability probes after OAuth, cache their results, and handle later 401/403/404/402 responses as connection/capability changes.
- Publicly trusted HTTPS is an integration prerequisite, not a late deployment concern. Onshape rejects self-signed webhook certificates, and the right panel/OAuth callback must be reachable in the relevant browser/server flow.

### 2.2 Notion

The current official documentation supports the intended one-way model:

- For one team workspace, use an **internal connection** with a static secret. A public OAuth connection is only needed if UnderSync will be installed into independently owned workspaces. Pages/data sources must be shared with the connection, and the secret must not be committed. [Notion authorization](https://developers.notion.com/guides/get-started/authorization)
- Request only read, insert, update, and user-information capabilities that are actually required. Connection access never exceeds the access of the installing/sharing user. [Notion capabilities](https://developers.notion.com/reference/capabilities)
- Current APIs distinguish a database container from one or more data sources. Rows are pages under a `data_source_id`; page properties must conform to that data source's schema. UnderSync should target the current `2026-03-11` API version and store both database and data-source IDs. [Notion data sources](https://developers.notion.com/reference/data-source) and [version changes](https://developers.notion.com/reference/changes-by-version)
- Data-source rows are created with Create Page and updated with Update Page. The API does not manage database views, so meeting views, filters, and layout must be configured in Notion itself or documented as setup steps. [Create data source](https://developers.notion.com/reference/create-a-data-source) and [Update Page](https://developers.notion.com/reference/patch-page)
- The average request limit is three requests per second per connection and 429 responses include `Retry-After`. Publishing must be queued, coalesced, and retried. [Notion request limits](https://developers.notion.com/reference/request-limits)
- Notion user IDs are durable mapping keys. Listing users does not include guests and cannot filter by name/email, so account linking needs an admin-assisted mapping flow. Email visibility also depends on the connection's capabilities. [Notion users](https://developers.notion.com/reference/get-users)
- Notion webhooks exist, but UnderSync does not need to consume content-change events while Notion remains a one-way projection. This avoids accidentally turning Notion into a second editor. If webhook monitoring is later used for drift warnings, events are signals rather than full changes, may be aggregated/out of order, and should trigger a fresh read. [Notion event delivery](https://developers.notion.com/reference/webhooks-events-delivery)

Consequences for the specification:

- Every published page must contain a stable `UnderSync ID`, `UnderSync URL`, and `Last published at` field.
- Store a projection record containing `entity_type`, `entity_id`, `notion_page_id`, `data_source_id`, `last_payload_hash`, and `last_published_at`.
- Publish only a documented allowlist of fields. Never infer changes back from Notion.
- If a Notion page is edited manually, the next UnderSync publish may overwrite managed properties. Mark managed fields in the database description and leave freeform notes in an explicitly unmanaged property.

## 3. Source-of-truth contract

| Information | Authoritative system | Direction |
|---|---|---|
| CAD geometry, CAD structure, workspaces, versions | Onshape | Onshape → UnderSync observations |
| Part identity, Part Number, revisions, current manufacturing configuration | UnderSync | Optionally canonical Part Number → Onshape metadata |
| Manufacturing readiness, files, blockers, warnings, approvals | UnderSync | UnderSync → Notion projection |
| Inventory, purchasing, motors, meeting history | UnderSync | UnderSync → Notion projection where useful |
| Shared task fields | Field-level shared ownership | UnderSync ↔ Onshape with conflict records |
| UnderSync-only task fields and blocker relationships | UnderSync | Not sent unless mapped into description/reference |
| Notion pages/data sources | UnderSync projection | UnderSync → Notion only |
| General team knowledge outside CAD operations | Notion | Outside UnderSync scope |

“Bidirectional” must not mean that every field in two different task models is interchangeable. The initial shared task contract should be limited to title, description, assignee mapping, due date, priority if compatible, status transition if compatible, and Onshape references. Subsystem, blocker, approval, custom fields, audit data, and internal permissions remain UnderSync-only.

## 4. Recommended system architecture

```text
Browser / Onshape iframe
          |
     HTTPS reverse proxy (Caddy)
          |
  React web UI ── NestJS modular API
                       |
             PostgreSQL + job tables
                       |
                 Background worker
                 /       |       \
          Onshape API  Notion API  File storage
                       adapters
```

### Technology choices

- **Language:** TypeScript throughout. One language reduces contribution overhead and allows integration DTOs, domain contracts, and frontend types to share generated schemas.
- **Frontend:** React with Vite and a small component system. The normal application and Onshape panel can share components but have separate entry points and layouts.
- **Backend:** NestJS using a modular-monolith structure. It gives explicit modules, dependency injection, guards, validation, scheduled jobs, and testable external adapters without introducing microservices.
- **Database:** PostgreSQL. The domain is relational, transaction-heavy, and needs uniqueness, locking, audit history, JSON for limited extension data, and reliable reporting.
- **ORM/migrations:** Prisma, with SQL migrations reviewed into source control. Complex dashboard queries may use reviewed SQL rather than forcing all reporting through the ORM.
- **Job processing:** A PostgreSQL-backed durable queue such as `pg-boss`, run by a separate worker process from the same codebase. This avoids adding Redis to the first self-hosted deployment while still supporting retries, deduplication, and delayed work.
- **Files:** Local filesystem volumes with database metadata, SHA-256 checksums, immutable revisions, MIME/type validation, and a storage interface. This keeps initial hosting simple and permits later S3-compatible storage without changing the domain.
- **Deployment:** Docker Compose with separate `web`, `worker`, `postgres`, and `caddy` services. Caddy terminates HTTPS. Backups must include a consistent database dump plus the file volume and encryption secrets.
- **Observability:** Structured JSON logs, health/readiness endpoints, job-failure views for admins, and an integration status page. Full telemetry infrastructure can wait.

This is intentionally a modular monolith, not microservices. Onshape synchronization, Notion publishing, and file processing are modules and background jobs within one deployable product. They can be separated later only if real load or reliability data justifies it.

### Backend module boundaries

1. Identity & Access
2. Team Configuration
3. Parts & CAD Links
4. Manufacturing Readiness & Files
5. Tasks
6. Blockers, Warnings & Approvals
7. Inventory & COTS
8. Purchasing
9. Motors & Physical Assets
10. Dashboard & Meetings
11. Onshape Adapter/Sync
12. Notion Publisher
13. Audit & Integration Operations

Modules may call domain services synchronously inside the monolith, but all external side effects must be emitted through a transactional outbox and processed by the worker.

## 5. Revised domain model

### 5.1 Part definition versus physical instance

The accepted model uses three concepts:

- `PartDefinition`: the engineering/design or catalog identity and its immutable generated Part Number. One CAD design normally maps here. It is exactly one of `MANUFACTURED` or `COTS`.
- `PartRequirement`: a contextual demand for a quantity of a definition, associated with a season, robot, subsystem, task, or build. Four camera mounts are one definition and a requirement quantity of four.
- `AssetInstance`: one serialized physical unit when individual tracking is enabled, such as `NEO-017`. Most manufactured pieces and bulk COTS stock do not require instances.

Purchased/COTS items are definitions. A COTS definition has `individual_tracking_required`. When false, inventory is aggregate stock. When true, every on-hand unit must have an `AssetInstance`; aggregate quantities are derived from instances and movements rather than maintained as an unrelated counter.

Motors are not a separate root concept. A motor model is a COTS `PartDefinition` with individual tracking enabled, and each motor is an `AssetInstance` with motor-specific profile/performance and maintenance records. The same mechanism may be used for sensors, controllers, gearboxes, batteries, or any other COTS item.

### 5.2 Part Number, revision, and manufacturing configuration

A Part Number is allocated atomically when a `PartDefinition` is registered or imported. Draft form data that has not been registered has no number. Once allocated:

- the Part Number is immutable;
- it remains unchanged when name, CAD geometry, manufacturing method, or material changes;
- cancellation/archive permanently retires it;
- a sequence value is never silently reused, even after transaction completion, cancellation, or archival;
- the stored Part Number never contains `*`.

The number records an immutable `PartNumberOrigin` snapshot containing the scheme version and encoded values used at allocation, including original manufacturing method/material where applicable. Current manufacturing configuration remains mutable on the manufactured-part profile.

`manufacturing_configuration_changed` is a derived boolean:

```text
current manufacturing method/material != PartNumberOrigin method/material
```

The UI/export display formatter appends exactly one `*` when this flag is true. For example, the stored identity remains `1156-26-S-3D-PLA-001`, while its current display may be `1156-26-S-3D-PLA-001*`. Search, uniqueness, foreign keys, Onshape metadata, and integrations use the unstarred canonical value. The UI must show a legend and the original/current values; `*` is never the only evidence of change.

Design evolution is represented by immutable `PartRevision` records under the same Part Definition. Revisions use a configurable-but-versioned sequence policy; v1 defaults to uppercase alphabetic revisions (`A` through `Z`, then `AA`, `AB`, ...). A revision records its creator, timestamp, reason, accepted CAD snapshot, manufacturing configuration snapshot, required file revisions, and approval decision. Creating or accepting a material CAD change proposes a new revision; it does not allocate a new Part Number.

Corrections that mean “this was actually a different part” require a new Part Definition and new Part Number. This boundary prevents revision history from being used to merge unrelated designs.

### 5.3 Essential entities

- `User`, `Role`, `Session`, `ExternalIdentity`, `ExternalIdentityCandidate`
- `Season`, `Subsystem`, `TeamSettings`
- `PartRegistrationDraft`, `PartDefinition`, `ManufacturedPartProfile`, `CotsPartProfile`, `PartRequirement`, `PartRevision`
- `PartNumberSchemeVersion`, `PartNumberSequence`, `PartNumberAllocation`, `PartNumberOrigin`
- `ManufacturingMethod`, `Material`, `FileRequirementRule`, `FileAsset`, `FileRevision`
- `CadLink`, `CadSnapshot`, `CadChangeFinding`, `CadChangeDecision`
- `Task`, `TaskExternalLink`, `TaskSyncState`, `TaskConflict`
- `Blocker`, `Warning`, `ApprovalRequest`, `ApprovalDecision`
- `InventoryLocation`, `StockLot`, `StockMovement`, `AssetInstance`, `AssetAssignment`, `MaintenanceEvent`, `MotorAssetProfile`
- `PurchaseRequest`, `PurchaseOrderLine` (one combined workflow is acceptable in v1 if names remain precise)
- `Meeting`, `MeetingSnapshotItem`
- `CustomFieldDefinition`, `CustomFieldValue`
- `AuditEvent`, `OutboxEvent`, `InboundEvent`, `IntegrationConnection`, `IntegrationCapability`, `IntegrationRun`

### 5.4 Invariants enforced by the database/domain

- A part is exactly one of `MANUFACTURED` or `COTS`; subtype-incompatible fields are rejected.
- Registration allocates a unique immutable Part Number. Changing a scheme creates a new scheme version.
- Number allocation is transactional and safe under concurrent creation. Allocated sequence values are append-only; cancelled/archived numbers are never silently reused.
- The display `*` is derived, singular, and never persisted as part of the canonical Part Number.
- Revisions belong to exactly one Part Definition and never change its Part Number.
- “Ready for Manufacturing” requires all applicable file rules to pass and any configured approval gate to be accepted.
- Completing a task never automatically resolves a blocker; it only prompts blocker verification.
- Only an Admin may create a task through the blocker-to-task action.
- External IDs are unique within `(provider, connection/account/server)` rather than globally.
- Records referenced by audit history are archived/soft-deleted; destructive deletion is an exceptional admin operation.
- All timestamps are stored in UTC; the team timezone controls date boundaries and “Today.”
- For a COTS definition with individual tracking enabled, serialized inventory cannot be increased without creating corresponding Asset Instances.

### 5.5 COTS inventory and Asset Instances

`CotsPartProfile` contains manufacturer, manufacturer part number, preferred supplier, purchase link, default price/currency, and `individual_tracking_required`. This flag controls inventory behavior; it is not restricted to electronics.

COTS definitions do not enter manufacturing states. Their definition lifecycle is `DRAFT → ACTIVE → DISCONTINUED → ARCHIVED`, with `CANCELLED` available before use. Purchasing status, stock availability, and Asset condition are separate dimensions and must not be overloaded into the definition status.

When individual tracking is **off**:

- stock is held in `StockLot`/`StockMovement` by definition, location, condition, and unit of measure;
- reservations reduce available quantity without changing on-hand quantity;
- bearings, fasteners, belts, and similar items normally use this model.

When individual tracking is **on**:

- every physical unit is an `AssetInstance` with a permanent Asset ID, condition, lifecycle state, location, optional robot/subsystem assignment, and full history;
- usage, maintenance, inspection, performance observations, and assignment changes reference that instance;
- inventory summaries are derived from the instances rather than manually maintained counts;
- `MotorAssetProfile` adds motor-specific serial/runtime/performance values without making Motor a separate inventory root.

Proposed Asset lifecycle:

```text
IN_STOCK → RESERVED → IN_USE → IN_STOCK
    |          |          |
    +----------+----------+→ MAINTENANCE → IN_STOCK
                           → BROKEN
                           → MISSING
                           → RETIRED
```

Changing `individual_tracking_required` is restricted once inventory exists. Aggregate → individual requires an audited conversion that creates one instance per physical unit. Individual → aggregate is prohibited while active instances/history exist; the definition may instead be superseded by a new inventory policy through an Admin migration.

### 5.6 Custom fields

Custom fields are schema-controlled extensions, not arbitrary JSON attached by clients. `CustomFieldDefinition` records entity type, stable key, label, value type, validation/options, required/default behavior, active state, and schema version. Typed `CustomFieldValue` records preserve user/date/relation integrity and audit changes.

V1 supports text, number, boolean, date, dropdown, multi-select, user, and allowlisted relation targets. Definitions cannot shadow reserved native keys or replace Part Number, lifecycle status, subsystem, manufacturing method/material, approval, readiness, task synchronization fields, or permissions. Deactivating a definition preserves historical values; changing an incompatible field type requires an explicit migration rather than silent coercion.

## 6. Revised lifecycle and state machines

Configurability should not make business invariants arbitrary. Keep machine-readable core states fixed and allow configurable labels, colors, ordering, and optional supplemental states only where transitions remain valid.

Accepted manufactured-part workflow:

```text
DRAFT --Register/Import + allocate Part Number--> IN_DEVELOPMENT
                                                    |
                                                    v
                                           READY_FOR_REVIEW
                                              /           \
                             CHANGES_REQUESTED             APPROVED
                                      |                         |
                                      +--> IN_DEVELOPMENT       v
                                                   READY_FOR_MANUFACTURING
                                                              |
                                                              v
                                                     IN_MANUFACTURING
                                                              |
                                                              v
                                                          COMPLETED
                                                              |
                                                              v
                                                           ARCHIVED

Any active pre-completion state --Admin cancel--> CANCELLED
```

`DRAFT` represents saved, incomplete registration input and has no allocated Part Number. The atomic Register/Import command validates identity fields, allocates the permanent Part Number, creates the initial Part Revision, and enters `IN_DEVELOPMENT`. If a registration transaction fails, it creates neither a usable definition nor a reusable allocated number.

Requirements are state-scoped and progressively stricter:

| Target state | Minimum gate |
|---|---|
| `IN_DEVELOPMENT` | Registered identity and valid manufactured/COTS subtype |
| `READY_FOR_REVIEW` | CAD link/snapshot where applicable plus required engineering metadata |
| `APPROVED` | Explicit Admin approval of a specific Part Revision and evidence snapshot |
| `READY_FOR_MANUFACTURING` | Approval valid, method/material set, all applicable readiness rules and file requirements satisfied |
| `IN_MANUFACTURING` | Ready state remains valid and manufacturing start is recorded |
| `COMPLETED` | Required quantity/outcome recorded and completion checks pass |

File requirement rules declare the lifecycle states in which they become enforced. They may be displayed earlier as future requirements, but their absence does not fail `IN_DEVELOPMENT`. A failed gate returns structured reasons such as `MISSING_DXF`; it does not create a Blocker. An Admin may explicitly escalate a readiness failure into a linked Blocker.

A material CAD/manufacturing change after review creates a change finding and may invalidate the current approval/readiness. The invalidation policy is evidence-based and configurable within a safe fixed set; it must never silently preserve approval across a change classified as design-relevant.

`ARCHIVED` means completed history retained but not active. `CANCELLED` means abandoned and permanently retires the allocated Part Number. Neither is a destructive delete.

Proposed task core states:

```text
DRAFT → OPEN → IN_PROGRESS → COMPLETED
                    ↘ CANCELLED
```

Onshape transitions should map into this model explicitly. An unmappable remote state creates a sync conflict rather than guessing.

## 7. Revised Onshape and Task synchronization model

### Right panel

The iframe receives and validates initial context, sends `applicationInit`, listens for `SELECTION`, and passes the selection to the UnderSync backend. The backend exchanges only its own secure session cookie with the panel; Onshape OAuth tokens remain server-side and encrypted at rest. The panel handles no selection, multiple selection, unsupported entity type, missing access, and stale link as first-class states.

For a selected body, the registration flow captures the current configuration and microversion. It then resolves current part details from the API and either finds a matching active `CadLink` or proposes registration. Never identify a part by name or Part ID alone.

### Change detection

1. Receive and authenticate an Onshape webhook.
2. Insert its `messageId` into `InboundEvent`; duplicates become no-ops.
3. Return success quickly.
4. Worker identifies affected linked elements, retrieves current microversion and required metadata, and runs ID translation from the last accepted snapshot.
5. Generate separate findings for identity resolution, metadata, configuration, geometry evidence, drawing/file evidence, and deletion/split/merge.
6. Compare canonical hashes and store evidence. Do not persist large tessellation unless necessary.
7. Present `Accept`, `Investigate`, and `Open in Onshape`. Acceptance creates a new accepted snapshot and audit event; it may revoke approval/readiness according to policy.

A microversion difference is a trigger, not proof that a linked part changed. Exact geometry equality may require a deliberately chosen fingerprint (for example, canonical mass properties plus a stable exported representation or tessellation hash). That algorithm must be validated in a spike because configurations, regeneration, units, and harmless topology-ID changes can create false positives.

### Task synchronization

Use an inbox/outbox synchronizer, never request-time dual writes:

- Local commits create an outbox row in the same transaction.
- Worker maps the shared fields, sends the Onshape update, and stores remote ID, remote update/version marker, canonical payload hash, and sync time.
- Remote reads/webhooks are deduplicated and normalized before comparison.
- An echo whose canonical payload equals the last pushed payload updates sync metadata but causes no outbound event.
- Disjoint field changes can merge. Concurrent changes to the same shared field create `TaskConflict` and require a user choice.
- Failures are retried with bounded exponential backoff; permanent permission/schema errors become visible admin incidents.

The initial canonical shared-field map is:

| UnderSync field | Onshape field | Rule |
|---|---|---|
| `title` | task name/title | Bidirectional, conflict-detected |
| `description` | description | Bidirectional, conflict-detected; no hidden UnderSync metadata |
| `assignee_user_id` | assignee ID | Bidirectional only when an approved ExternalIdentity mapping exists |
| `due_date` | due date | Bidirectional, normalized as a date in the team timezone |
| `priority` | compatible priority | Bidirectional only after actual enum mapping is validated |
| `status` | compatible workflow state | Explicit transition map; unsupported transitions become conflicts |
| `onshape_references` | task references | Bidirectional only for supported reference types |

Subsystem, linked Blockers, approvals, custom fields, meeting records, internal relations, permissions, and audit history remain UnderSync-only.

Each `TaskExternalLink` stores the UnderSync ID, provider/connection, Onshape Task ID, last remote marker, last synchronized canonical shared payload, and per-field base values. Conflict detection uses a three-way comparison: last synchronized base versus current UnderSync and current Onshape values. Different fields merge; the same changed field creates `TaskConflict`. Resolution choices are `Use UnderSync`, `Use Onshape`, or an explicitly edited value, all audited.

Capability tiers keep the core usable across Team 1156 accounts:

1. `LOCAL_ONLY`: UnderSync tasks work normally; the UI explains that this connection cannot use Onshape Tasks.
2. `PUSH_ONLY`: UnderSync can create/update Onshape Tasks, but reverse discovery is unavailable.
3. `MANUAL_BIDIRECTIONAL`: both directions work through an explicit Sync action.
4. `SCHEDULED_BIDIRECTIONAL`: incremental polling is possible within a configured quota budget.
5. `EVENT_BIDIRECTIONAL`: only if a supported task event mechanism is verified.

Because the official webhook list does not document task events and plan availability is unclear for Free/Student accounts, Stage 0 must test each distinct account context. If there is no efficient updated-since/cursor query, background polling is prohibited under the documented quota; manual sync is the safe fallback. The product must not label a connection “fully synchronized” when it is operating at a lower tier.

## 8. Revised Dashboard and Daily Meeting model

The Dashboard is a read model derived from authoritative domain records; it never stores a parallel status. A query/projection service gathers tasks, parts, readiness failures, approvals, Blockers, Warnings, purchasing, inventory shortages, Asset issues, and subsystem summaries into `AttentionItem` values.

Each Attention Item contains:

- source entity type and stable ID;
- subsystem where applicable;
- reason codes and human-readable explanations;
- effective deadline;
- blocker/warning flags;
- severity band and deterministic score;
- deep link to the authoritative object;
- `calculated_at`, so stale projections are detectable.

The initial ordering is lexicographic, not an opaque AI score:

```text
BLOCKED + OVERDUE
BLOCKED
OVERDUE
DUE_TODAY
DUE_SOON
WARNING
NORMAL
```

Within a band, sort by severity, deadline, configured subsystem order, then stable ID. Every card displays reason chips such as `Blocked`, `3 days overdue`, `Awaiting approval`, `Missing DXF for readiness`, `COTS shortage`, or `Asset maintenance due`. Admin-configurable weights may be introduced later, but core reason bands and explanations remain fixed.

`parts_not_ready` must be contextual: an `IN_DEVELOPMENT` part with future file requirements is normal, while a part attempting or expected to reach `READY_FOR_MANUFACTURING` with missing requirements is an attention item. This prevents the Dashboard from treating normal development as failure.

Subsystem status is derived from counts and highest-severity Attention Items across linked parts, tasks, Blockers, purchases, inventory, and assets. A subsystem does not maintain a manually duplicated red/yellow/green value in v1; an Admin may add a narrative update separately.

Daily Meeting Mode is a focused presentation over the same Attention Items. Starting a meeting creates `Meeting`; it does not copy the whole Dashboard. As items are reviewed, `MeetingSnapshotItem` records source ID, reason/score snapshot, review outcome, and any action IDs created. Tasks created from Blockers remain linked, and completing them does not resolve the Blocker. Meeting history therefore preserves what was seen and decided without becoming another mutable operational database.

## 9. Notion publishing design

Create one data source per useful audience view rather than mirroring every normalized table. A sensible initial projection is `Engineering Attention`, containing parts/tasks/blockers/warnings/purchases that the broader team should see. Additional `Parts` or `Daily Meetings` projections can follow after usage feedback.

Publishing is asynchronous and idempotent:

1. Domain change creates a `NotionProjectionRequested` outbox event.
2. Coalesce rapid changes by entity.
3. Render an allowlisted payload and hash it.
4. Skip if the hash matches the last successful publish.
5. Create or update the page by stored Notion page ID.
6. If the page was deleted or access was revoked, record a visible integration error; do not silently create duplicates.

Use an internal connection with read/insert/update content and user-information capability only if People properties are required. Avoid Notion webhooks in v1 because edits are intentionally non-authoritative.

## 10. Authentication, permissions, and audit

- Use server-side opaque sessions in secure, `HttpOnly`, `SameSite=Lax` cookies. Store only a hash of each session token and support revocation of all sessions after an admin password reset.
- Hash passwords with Argon2id using parameters benchmarked on the deployment machine. Add login throttling and generic error messages even though this is an internal tool.
- Keep `ADMIN` and `MEMBER` as fixed v1 roles. The existing statement that roles are configurable conflicts with the defined two-role model; defer arbitrary roles until a permission matrix exists.
- Authorization is enforced in backend services, never only by hidden buttons.
- Link people through `ExternalIdentity(provider, connection_id, external_user_id, undersync_user_id)`. Name/email matches may create an `ExternalIdentityCandidate`, but only an Admin or a verified self-link confirms ambiguous matches. Task assignment sync is disabled until the relevant mapping is confirmed.
- Encrypt OAuth refresh tokens and integration secrets with an application key kept outside the database/backups. Document key rotation and recovery.
- Audit events are append-only and include actor, action, target, request/correlation ID, timestamp, source, and a redacted before/after summary. Passwords, tokens, and sensitive file contents never enter audit payloads.

## 11. Remaining contradictions and decisions

The following points remain unresolved after the product-owner update. None prevents local UI/domain prototyping, but items marked **Stage 0 gate** prevent the affected production integration or schema from being finalized.

| Remaining issue | Required decision or evidence |
|---|---|
| **Onshape Tasks availability — Stage 0 gate** | Test list/create/update/transition as an actual Free user, EDU Student user, and relevant mentor/Educator context. Record status codes, scopes, schemas, reference support, and cross-user assignment behavior. True bidirectional sync cannot be promised if the source feature is unavailable. |
| **Private-app quota ownership — Stage 0 gate** | Select the Onshape account that owns the OAuth application and confirm its displayed annual allowance. Decide who receives usage alerts and what happens if that account loses Education status. |
| **Task reverse-sync mechanism — Stage 0 gate** | Determine whether an undocumented task event exists or whether `/tasks` supports efficient incremental filtering/cursors. Otherwise accept manual reverse sync as the quota-safe behavior. |
| **Sequential number scope** | Choose sequence per scheme+season (recommended) or per full encoded category tuple. The example language previously implied category/subsystem sequencing, while a global seasonal sequence is simpler and easier to search. |
| **Revision trigger and naming** | Approve the default `A..Z, AA..` policy and decide whether every accepted CAD change creates a revision automatically or an Admin explicitly promotes a pending change to a revision. |
| **Part identity boundary** | Define when a redesign is still a revision of the same part versus a new Part Definition/Part Number. Recommended test: if old and new units are not interchangeable for the same requirement, create a new Part Definition. |
| **Onshape Part Number publishing** | Decide whether UnderSync writes its canonical unstarred number to Onshape metadata. If yes, choose reject-and-review versus Admin overwrite for pre-existing conflicting values. |
| **Approval invalidation** | Select which accepted changes invalidate approval: recommended default is geometry, configuration, manufacturing method/material, or approved file revision changes; name/description-only changes do not. |
| **Manufacturing file provenance** | Choose which sources are accepted: direct upload, generated Onshape export, linked Onshape Drawing/blob, or all with explicit provenance. Also set size, retention, and approval-revision rules. |
| **Roles** | Confirm fixed `ADMIN`/`MEMBER` for v1. Custom task fields are accepted; arbitrary configurable roles still require a future permission matrix. |
| **Dates** | Confirm `America/Sao_Paulo` as the team timezone and choose the `DUE_SOON` window (recommended: next 3 calendar days). |
| **Inventory rules** | Decide units of measure, locations, reservation behavior, adjustment approvals, and whether negative aggregate stock is forbidden (recommended). |
| **Asset identifiers** | Define configurable prefixes/sequences (`NEO-017`) and whether IDs remain globally unique after an asset is retired (recommended: yes). |
| **Purchasing money** | Select default currency and whether multi-currency purchases are needed in v1. Store decimal minor/unit values, never floating point. |
| **Backup target** | Name an encrypted off-machine destination and recovery objectives before production deployment. |

## 12. Incremental delivery plan

Each stage ends with migrations, automated tests, a short architecture decision record, and a demo using realistic FRC data.

### Stage 0 — Team 1156 integration and workflow validation

Stage 0 uses disposable probes and written evidence only. It does not create the production database or synchronization service.

#### A. Account and application inventory

- List the exact account contexts the team will support: Free, EDU Student if present, EDU Educator/mentor, and any Classroom context.
- Choose a provisional private OAuth application owner and record the annual API allowance shown in Developer settings, reset period, current usage, and alert recipients.
- Record the Onshape server/stack for each context (`cad.onshape.com` versus any classroom/company domain) because tokens, IDs, and API keys are stack-specific.
- Confirm that the intended FRC educational/non-commercial use complies with the selected account terms; do not use Free-plan public documents for confidential robot designs.

#### B. OAuth and capability matrix

- Register a disposable private OAuth application with the minimum scopes required for the probes.
- Test authorization, callback, refresh-token rotation, revocation, and reauthorization for one representative of each account context.
- For each context, record harmless read/write results for documents, elements, parts, metadata, users, Tasks, webhooks, and right-panel extension access.
- Define the runtime capability probe and user-facing explanations for 401, 402 quota exhausted, 403 unavailable/forbidden, 404 inaccessible/not exposed, and 429 rate limited.

#### C. Right-panel spike

- Establish temporary trusted public HTTPS for the callback/panel; local-only HTTP is insufficient for this spike.
- Create the private extension/store entry/subscription needed for internal testing and record exactly how Free, Student, and Educator users gain access.
- Capture actual `applicationInit`/`SELECTION` payloads for no selection, one Part Studio body, multiple bodies, assembly occurrence, configuration, workspace, and version contexts.
- Verify third-party cookie/browser behavior and document the fallback link flow when the iframe cannot maintain a session.

#### D. CAD identity and change detection

- Test microversion retrieval and ID translation across rename, harmless feature edit, geometry edit, split, merge, delete, rollback, configuration change, and workspace/version contexts.
- Compare candidate fingerprints for false positives, API cost, and configuration sensitivity. Record which evidence categories revoke approval by default.
- Verify webhook registration, trusted-certificate requirements, event deduplication fields, delivery behavior, and account-specific permission.
- Estimate API calls for one linked part registration and one change reconciliation; turn that into an annual quota budget.

#### E. Tasks feasibility matrix

- In each actual account context, test Tasks list, retrieve, create, update, transition, assignee lookup, due date, priority, references, pagination, filtering, and permission failures.
- Test whether a task created by a Free user can be assigned/synchronized to an Education user and vice versa, using only documents/accounts the users may legitimately access.
- Inspect the current API Explorer for update markers, cursors, modified-since filters, idempotency support, transition enums, and any task event/callback not present in the general webhook guide.
- Calculate the API cost of manual sync and every plausible polling interval. Select the highest supportable capability tier (`LOCAL_ONLY` through `EVENT_BIDIRECTIONAL`) for each account context.
- Validate the three-way conflict algorithm with simultaneous edits to title, assignee, due date, and status.

#### F. Notion one-way projection

- Create a disposable internal connection with minimal capabilities and a test `Engineering Attention` data source using the current API version.
- Verify create/update/query, explicit user-ID mappings, deletion/access-revocation handling, payload hashes, 429 retry behavior, and protection of an unmanaged notes field.
- Confirm the initial audience and exact allowlisted properties. Do not subscribe to reverse-content webhooks.

#### G. Domain decisions and written outputs

- Approve the Part Number sequence scope, revision promotion rule, identity boundary, approval invalidation policy, file provenance, roles, dates, inventory rules, asset ID format, currency, and backup target listed in Section 11.
- Produce a capability matrix, API-call budget, shared task-field/transition map, CAD fingerprint decision record, right-panel test record, Notion projection schema, and final state-machine decision record.

**Exit:** every affected integration has evidence for Team 1156's real accounts, remaining Section 11 decisions are answered, and unsupported capabilities have an approved fallback. No production feature code exists.

### Stage 1 — Foundation

- Repository, migrations, users, Admin/Member authorization, sessions, team timezone, audit skeleton, health checks, test harness, and backup/restore script validation.

### Stage 2 — Team configuration and parts

- Seasons, subsystems, manufacturing methods/materials, manufactured versus COTS profiles, draft registration, permanent transactional Part Number allocation, origin snapshots, revisions, lifecycle rules, and the derived `*` display indicator.

### Stage 3 — Manufacturing readiness

- File requirement rules, versioned uploads, readiness evaluation, approvals, blockers/warnings, and history.

### Stage 4 — Tasks and daily operations

- Native UnderSync tasks, blocker-to-task admin workflow, actionable dashboard, deterministic attention ordering, daily meeting mode, and meeting snapshots.

### Stage 5 — Onshape linking and right panel

- Enable the production/staging public HTTPS route, then add OAuth, capability detection, identity mappings, panel context/selection, registration, Open in Onshape, metadata reads, and optional canonical Part Number publishing. No automatic change acceptance.

### Stage 6 — Onshape change detection

- Webhook receiver, reconciliation queue, CAD snapshots, ID translation, findings, acceptance/investigation workflow, rate-budget dashboard.

### Stage 7 — Task synchronization

- Ship the highest verified capability tier per connection. Begin with UnderSync → Onshape where supported. Add Onshape → UnderSync only when Stage 0 proves a quota-safe mechanism. Ship three-way conflict handling and capability/status explanations before claiming bidirectional sync.

### Stage 8 — Notion projection

- One data source and a minimal allowlisted projection; idempotent publishing, mapping repair, retries, and connection health.

### Stage 9 — Inventory, purchasing, and assets

- Aggregate stock movements/reservations, the COTS individual-tracking switch, serialized Asset Instances, assignments/location/condition/history, purchase workflow, optional motor profiles/performance/maintenance, and dashboard integration.

### Stage 10 — Production hardening

- Public HTTPS, firewall rules, secret rotation, off-machine encrypted backups, restore drills, update/rollback procedure, resource monitoring, and disaster documentation.

## 13. Remaining product-owner decisions

The following product choices still need answers. The Onshape capability questions are evidence tasks in Stage 0 rather than choices the owner can settle by preference.

1. **Part sequence scope:** one sequence per scheme+season (recommended), or a separate sequence per complete subsystem/manufacturing/material tuple?
2. **Revision promotion:** should an accepted design-relevant CAD change automatically create the next revision, or should an Admin explicitly promote a pending change? Recommended: explicit promotion, with urgent changes visibly pending.
3. **New part versus revision:** approve the interchangeability rule: if old and new physical units cannot satisfy the same requirement, allocate a new Part Number.
4. **Onshape metadata:** should UnderSync publish its canonical unstarred Part Number into Onshape? If there is a conflict, recommended behavior is stop and request Admin review rather than overwrite.
5. **Approval invalidation:** approve the recommended defaults: invalidate for geometry, configuration, manufacturing method/material, or an approved manufacturing-file revision; do not invalidate for name/description-only edits.
6. **Manufacturing files:** which provenance types are allowed, what is the size/retention policy, and does approval always bind to exact file revisions? Recommended: yes.
7. **Roles:** confirm `ADMIN` and `MEMBER` as the only v1 roles.
8. **Dates:** confirm `America/Sao_Paulo` and a three-calendar-day `DUE_SOON` window.
9. **Inventory/assets:** approve non-negative stock, initial locations/units, reservation behavior, and globally non-reusable Asset IDs.
10. **Purchasing:** choose the v1 currency model; recommended: BRL default with an ISO currency field on every monetary record.
11. **Notion projection:** confirm the first audience and the proposed `Engineering Attention` data source.
12. **Recovery:** identify the encrypted off-machine backup target and acceptable data-loss/recovery windows.

## 14. Architecture acceptance criteria

Architecture can move into Stage 1 when:

- The source-of-truth table and fixed workflows are approved.
- The Part Number sequence scope, revision-promotion rule, and new-part-versus-revision boundary are approved.
- Stage 0 has recorded the actual Free/Education capability matrix, Tasks schemas, selection behavior, private-app quota ownership, and webhook/polling result.
- A practical trusted public HTTPS route is identified for Stage 0/5 integration testing; it need not be the final headquarters deployment yet.
- Onshape Part Number metadata ownership/conflict behavior is decided.
- File retention/revision requirements are decided.
- Roles, date semantics, inventory/Asset ID rules, purchasing currency, and the initial Notion projection are decided.
- Backup and recovery objectives have named targets before production deployment.

The local database and identity/access foundation are now being implemented by product-owner direction. Onshape/Notion production synchronization and unresolved integration-dependent schema remain gated on the Stage 0 evidence above.
