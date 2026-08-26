# UnderSync development

UnderSync uses a Vercel-ready React/Vite frontend with Convex as its active
backend and database. Authentication, accounts, administration and Parts
Tracking now run on Convex. The former Express/PostgreSQL application remains
available only as an isolated compatibility implementation.

## Requirements

- A current Node.js LTS release and npm
- Docker Desktop only when using a local Convex deployment or the legacy
  PostgreSQL application
- A Convex account for cloud development and production deployments

## Install

```powershell
npm.cmd install
```

The first Convex setup creates ignored `.env.local` values and generates
`convex/_generated`:

```powershell
npm.cmd run convex:dev
```

The script explicitly reads ignored `.env.local`. This workspace is currently
configured for a local deployment, which requires Docker Desktop.

## Run locally

After the first Convex setup, use two terminals:

```powershell
# Terminal 1: Vite frontend at http://localhost:8000
npm.cmd run dev
```

```powershell
# Terminal 2: sync and watch Convex functions
npm.cmd run convex:dev
```

Register the first account to bootstrap the initial administrator. The
Dashboard, Parts Tracking, Account and Admin pages then use reactive Convex
queries and mutations.

Useful checks:

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
```

## Environment variables

Local Convex configuration is generated in ignored `.env.local`:

- `CONVEX_DEPLOYMENT`: selects the development deployment for the CLI.
- `VITE_CONVEX_URL`: public deployment URL used by the browser client. Values
  with a `VITE_` prefix are public and must never contain secrets.
- `VITE_CONVEX_SITE_URL`: public URL used by Convex Auth HTTP actions.

Convex Auth also requires `SITE_URL`, `JWT_PRIVATE_KEY` and `JWKS` in the
selected Convex deployment. They are deployment secrets and do not belong in
`.env.local` or Git.

Vercel requires:

- `CONVEX_DEPLOY_KEY`: secret production deploy key with
  `deployment:deploy`; configure it only in Vercel's Production environment.
  For preview backends, use a separate preview deploy key in the Preview
  environment.

`npx convex deploy --cmd 'npm run build'` supplies the correct frontend URL at
build time. OAuth secrets, API tokens and future server credentials belong in
Convex deployment environment variables, not `VITE_*` variables and not the
repository.

`.env.example` contains placeholders only. `.env`, `.env.local`, Vercel state
and all `*.local` environment variants are ignored by Git.

## Vercel production setup

1. Create the Convex project and its production deployment.
2. Generate a production deploy key in Convex with `deployment:deploy`.
3. Import the Git repository into Vercel.
4. Add `CONVEX_DEPLOY_KEY` to Vercel's Production environment.
5. Keep the repository's build command and output directory from `vercel.json`.
6. Deploy. Vercel runs Convex deployment first, then builds `dist-web`.

No Vercel project, production deployment or secret is created by this
repository preparation.

## Legacy compatibility application

The old server is not part of the Vercel build. Its source remains under
`src/`, its Prisma history under `prisma/`, and its browser assets under
`public/`. It can still be run explicitly:

```powershell
npm.cmd run db:up
npm.cmd run db:migrate
npm.cmd run db:seed
npm.cmd run legacy:dev
```

The legacy server reads `.env` and defaults to port 8000. Set a different
legacy `PORT` (for example 8001) before running it beside Vite. PostgreSQL,
Prisma, Express, Argon2 and the Docker Compose database are compatibility-only
and must not be used by new product work.

## Remaining migration work

- No PostgreSQL data has been imported into Convex.
- Onshape and Notion link records are represented in the account UI, but their
  production OAuth callbacks and provider secrets still need deployment setup.
- Later manufacturing, task, inventory and meeting modules remain staged work.
- Production and preview Convex/Vercel projects still require owner setup.
