# UnderSync

UnderSync is the local-first operations application for FRC Team 1156 — Under Control. The active implementation currently includes PostgreSQL-backed accounts, registration, login/logout, account editing, and an administrator-only spreadsheet-style database explorer.

New registrations always receive the `MEMBER` role. Only an existing administrator can promote a user to `ADMIN` or demote an administrator back to `MEMBER` from the admin `users` table. Users cannot change their own permission role or active/disabled status.

The same admin table can disable/enable accounts, reset a password to `Senha1156`, and permanently delete an unreferenced account. Disabling or resetting revokes the affected user's active sessions. A user that owns protected task/part history cannot be deleted and must be disabled instead.

The account page displays Onshape and Notion connection/link status. Onshape OAuth and the first Parts Tracking registration flow are active; Notion workspace/user verification remains later integration work.

The earlier Onshape Spike 1–3 work is preserved under [`archive/spikes`](archive/spikes) and is not part of the active build.

## Development setup

1. Install Node.js and Docker Desktop.
2. Run `npm.cmd install`.
3. Add the database values from `.env.example` to the ignored `.env` file.
4. Start and prepare PostgreSQL:

```powershell
npm.cmd run db:up
npm.cmd run db:migrate
npm.cmd run db:seed
```

5. Start UnderSync:

```powershell
npm.cmd run dev
```

Open `http://localhost:8000`. The development seed account is:

```text
Name: admin
Password: admin
```

This weak credential exists only for local development and must never be used in production.

See [DATABASE.md](DATABASE.md) for schema, migration, reset, and database-test details.

## Onshape Parts Tracking

Configure the Onshape application with:

- Authorization URL: `https://oauth.onshape.com/oauth/authorize`
- Access Token URL: `https://oauth.onshape.com/oauth/token`
- Redirect URL: `http://localhost:8000/oauth/callback` for local development; this must exactly match `ONSHAPE_REDIRECT_URI`
- Element Right Panel Action URL: `http://localhost:8000/onshape/panel?server={$server}&documentId={$documentId}&workspaceOrVersion={$workspaceOrVersion}&workspaceOrVersionId={$workspaceOrVersionId}&elementId={$elementId}&configuration={$configuration}`

Onshape must be able to load the Action URL. Use trusted public HTTPS instead of localhost when testing from another machine or deploying. OAuth access and refresh tokens are encrypted before PostgreSQL storage using `INTEGRATION_ENCRYPTION_KEY`.

If the Right Panel is not signed in, use **Open UnderSync login** to authenticate in a normal browser tab, return to Onshape, and press **I signed in · retry**. Extension sessions use `Secure; SameSite=None` cookies because the panel is a cross-site iframe. Onshape also requires third-party cookies to be enabled for application extensions.

The first Parts Tracking form asks for name, quantity, subsystem, designer, and fabrication method. Material is explicitly `TBD` until material selection is added next. Onshape is renamed from the submitted form value using `Form name | Tracking ID`.

The administrator landing page is at `/admin`. Its Database Explorer is a separate `/admin/database` sub-page. `/admin/parts-tracking` lets administrators change every displayed question label, the name placeholder, form title, submit-button text, fabrication methods, and materials. Each material can be assigned to multiple accepted fabrication methods. On the live form, Material remains hidden until a method is selected and then displays only compatible active materials.

Methods and materials may be renamed, disabled, or permanently deleted. Codes remain stable because they are embedded in permanent tracking IDs. PostgreSQL blocks permanent deletion when historical parts reference the option; disable it instead in that case.
