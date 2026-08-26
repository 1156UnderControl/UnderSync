# UnderSync

UnderSync is the operations platform for FRC Team 1156 — Under Control.

The active application now includes:

- React + Vite frontend, prepared for Vercel;
- Convex authentication and a reactive application database;
- member registration/login, account management and password changes;
- admin user controls, including access, disable/delete and password reset;
- configurable Parts Tracking with subsystem, designer, method and compatible material;
- a responsive interface using the official UnderSync logo and palette.

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
npm.cmd run convex:dev
```

Open <http://localhost:8000>. Register the first account to make it the initial
administrator; later accounts are Members until an Admin promotes them.

See [DEVELOPMENT.md](DEVELOPMENT.md) for first-time Convex setup, environment
variables, Vercel configuration, verification commands and the legacy fallback.
The architecture decisions and staged product plan remain in
[ARCHITECTURE_REVIEW.md](ARCHITECTURE_REVIEW.md).
