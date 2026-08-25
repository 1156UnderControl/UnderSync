# UnderSync

UnderSync is the operations platform for FRC Team 1156 — Under Control.

The active application foundation is now:

- React + Vite frontend, prepared for Vercel;
- Convex backend, functions and future database;
- no product-specific Convex schema yet.

The previous Express/PostgreSQL implementation has not been deleted. It remains
isolated as a legacy compatibility application while later phases migrate its
behavior intentionally. New product work should target Convex rather than
PostgreSQL or the local Express API.

## Start development

```powershell
npm.cmd install
```

Then run these in separate terminals:

```powershell
npm.cmd run dev
```

```powershell
npx.cmd convex dev
```

Open <http://localhost:8000>. The page displays **Connected to Convex** when
the frontend has reached the development backend successfully.

See [DEVELOPMENT.md](DEVELOPMENT.md) for first-time Convex setup, environment
variables, Vercel configuration, verification commands and the legacy fallback.
The architecture decisions and staged product plan remain in
[ARCHITECTURE_REVIEW.md](ARCHITECTURE_REVIEW.md).
