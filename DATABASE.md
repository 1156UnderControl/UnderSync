# UnderSync Local Database

## Technology and local server

UnderSync uses PostgreSQL 17.6 for the single fixed organization, FRC Team 1156 — Under Control. A separate `teams` table is intentionally unnecessary. Prisma 7.9.1 manages the declarative schema and migration history; reviewed SQL in each migration adds PostgreSQL constraints and triggers that Prisma cannot express.

The development server is the pinned `postgres:17.6-bookworm` container in `compose.yaml`. It binds only to `127.0.0.1`, stores data in the named `undersync_postgres_data` Docker volume, and can be reproduced on another computer from the repository plus environment values.

Prerequisites:

- Docker Desktop (or another Docker Compose-compatible local runtime)
- Node.js and `npm`

On this Windows machine, use `npm.cmd` because the PowerShell execution policy may block `npm.ps1`.

## Configuration

Do not replace an existing `.env` if it already contains Onshape settings. Copy the database section from `.env.example` into the ignored `.env` file and replace the placeholder password.

| Variable | Purpose |
|---|---|
| `POSTGRES_DB` | Development database created by the container |
| `POSTGRES_USER` | Local PostgreSQL role created by the container |
| `POSTGRES_PASSWORD` | Local PostgreSQL password; never commit it |
| `POSTGRES_PORT` | Host port bound on `127.0.0.1` |
| `DATABASE_URL` | Prisma/application URL for the development database |
| `TEST_DATABASE_URL` | Isolated test URL; database name must end in `_test` |

Keep the username, password, port, and database names in the URLs aligned with the `POSTGRES_*` values. URL-encode special characters used in a password when placing it in a connection URL.

## Start and stop

Start PostgreSQL and wait until its health status is healthy:

```powershell
npm.cmd run db:up
docker compose ps
```

Stop the server without deleting its persistent data:

```powershell
npm.cmd run db:down
```

Follow PostgreSQL logs:

```powershell
npm.cmd run db:logs
```

`docker compose down` preserves the named volume. `docker compose down -v` permanently deletes the local database volume and should be used only when that data is intentionally disposable.

## Migrations

Create the entire schema in an empty database:

```powershell
npm.cmd run db:migrate
```

For a new core field or relation, edit `prisma/schema.prisma`, create a development migration, review the generated SQL, and commit both files:

```powershell
npx.cmd prisma migrate dev --name describe_the_change
```

Never edit a migration that has already been applied to a shared environment. Add a new migration to remove or change a core field. This preserves deterministic upgrades and makes the schema reproducible from empty.

The initial migration also contains reviewed database-level behavior for:

- atomic, season-scoped Parts Tracking ID allocation;
- immutable tracking-code origin fields;
- Manufactured versus COTS field/status correctness;
- exactly one COTS detail row for every COTS part and none for Manufactured parts;
- relational task, part, and user integrity;
- typed custom-field values and exactly one target per value;
- automatic `updated_at` timestamps.

## Seed data

Apply the clearly fictional development seed:

```powershell
npm.cmd run db:seed
```

It creates three `@undersync.test` users for Team 1156, two tasks, one Manufactured part, one COTS part, reference configuration, quantities, relationships, and unconfigured Onshape/Notion connection records. It contains no access tokens or real secrets and is safe to run more than once.

The local-only development administrator is `admin` with password `admin`. The password is stored only as an Argon2id hash. These intentionally weak credentials must never be used outside disposable local development.

Public registration always creates a `MEMBER`. Role promotion/demotion, account enable/disable, password reset to `Senha1156`, and account deletion are administrator-only operations. The current administrator and final active administrator are protected from lockout. Permanent deletion is rejected when foreign-key-protected operational history still references the user; disabling preserves that history safely.

## Reset development data

This command erases the schema named by `DATABASE_URL`, reapplies all migrations, and reapplies the development seed:

```powershell
npm.cmd run db:reset
```

Confirm that `DATABASE_URL` points to the intended local development database before running it.

## Database tests

Run the database suite with PostgreSQL already started:

```powershell
npm.cmd run test:db
```

The runner accepts only a localhost `TEST_DATABASE_URL` whose database name ends in `_test`. It drops and recreates that isolated database, deploys migrations from empty, and then checks primary keys, foreign keys, case-insensitive email uniqueness, user/task relations, both part kinds, generated tracking IDs, manufacturing requirements/files, quantities, part/user/task links, CAD references, and typed custom fields.

The ordinary `npm.cmd test` suite remains independent of PostgreSQL.

## Entities

| Area | Tables |
|---|---|
| Users and authentication | `users`, `sessions` |
| Part configuration | `seasons`, `subsystems`, `manufacturing_methods`, `materials`, `file_types`, `manufacturing_method_file_requirements` |
| Parts Tracking form configuration | `parts_tracking_form_settings`, active/inactive `manufacturing_methods` and `materials`, and `manufacturing_method_materials` compatibility links |
| Parts | `parts`, `part_number_sequences`, `cots_part_details`, `part_requirements`, `manufacturing_files` |
| Tasks and associations | `tasks`, `task_parts`, `part_user_assignments` |
| CAD identity | `cad_references` |
| External account links | `integration_connections`, `external_identities`, `oauth_authorization_states`, `onshape_oauth_grants` |
| Configurable optional fields | `custom_field_definitions`, `custom_field_values` |

`PartRequirement.required_quantity` stores contextual demand. Quantity is deliberately not stored on the reusable Part definition, so four identical mounts remain one part identity with a requirement of four.

Manufactured parts require a manufacturing method and material and may have manufacturing information/files. COTS parts prohibit those manufacturing-only columns and require `cots_part_details` containing manufacturer and manufacturer part number.

The `cad_references` table stores a versioned Onshape identity: server, document, workspace/version kind and ID, element, microversion, Onshape Part ID, configuration, and optional geometry/selection ID. It also records the requested Onshape name and whether the rename is pending, succeeded, or failed, making partial external writes visible.

## Onshape and Notion account links

`integration_connections` represents the team-level provider context. Onshape uses `OAUTH`; Notion uses the team's `INTERNAL_TOKEN` connection. Its `config` field is for non-secret provider configuration only. Onshape tokens are AES-256-GCM encrypted in `onshape_oauth_grants` using the application key outside PostgreSQL; they must never be placed in `config`, `external_identities`, logs, or audit payloads. One-use hashed OAuth state values are stored briefly in `oauth_authorization_states`.

`external_identities` maps one UnderSync user to the durable external user ID returned by a configured connection. It stores optional external display/email data, link state, verification time, and non-secret metadata. Database constraints enforce:

- at most one identity per UnderSync user per connection;
- one external identity cannot be claimed by two UnderSync users on the same connection;
- a `VERIFIED` identity must have `verified_at` evidence;
- deleting an UnderSync user cascades its identity links, while deleting a referenced connection is restricted.

The account page reports the current connection/link state. Creating a verified record must happen only after a successful Onshape OAuth identity read or an approved Notion workspace-user match; users must not manually type an external ID and claim it.

## Parts Tracking IDs

The database generates tracking IDs atomically using Team 1156 and a sequence scoped to season:

```text
Team-Season-Subsystem-Manufacturing-Material-Sequence
1156-26-S-3D-PLA-001
```

COTS definitions use the explicit `COTS-NA` segments. Clients cannot supply the code, sequence, or origin fields. Allocation fields are immutable and sequence values are never silently reused.

## Adding and removing fields

There are two supported mechanisms:

1. Core fields and invariants use Prisma migrations. This is appropriate for identities, status, ownership, dates, lifecycle gates, and relationships that require strong database constraints.
2. Optional fields use `custom_field_definitions` and `custom_field_values`. A definition selects `USER`, `TASK`, or `PART` and a typed value (`TEXT`, `NUMBER`, `BOOLEAN`, `DATE`, or `SELECT`). Set `active = false` to retire a field while preserving its history.

Custom fields cannot replace core columns or relational invariants. The database checks entity type, JSON value type, and one value per definition/entity. Adding a new optional field or retiring one therefore requires data changes only, while adding/removing a structural database field remains safe and reviewable through migrations.

## Deletion behavior

- Configuration records and users are generally `RESTRICT`ed while referenced.
- Deleting an assignee sets `tasks.assignee_id` to null; deleting a task creator is restricted.
- Part-owned join rows, files, requirements, COTS details, CAD references, and custom values cascade with their parent.
- File types, manufacturing methods, and materials are restricted while referenced.

Operational application code should archive users and parts rather than physically deleting important history.
