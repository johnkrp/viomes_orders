# VIOMES Order Form

This project now uses:

- `site/` for the public static frontend
- `backend/` for the active FastAPI backend

`site/server.js` is legacy and should not receive new features.

## Backend status

The backend has been reshaped into:

- public API routes for catalog and order creation
- admin auth routes with cookie sessions
- protected admin customer stats endpoint
- SQLite schema extended for admin sessions and future customer-code based stats

Current admin login defaults are for local development only:

- username: `admin`
- password: `change-me-now`

Change them with environment variables before any shared deployment.

## Run backend

From `backend/`:

```powershell
.\.venv\Scripts\python.exe -m uvicorn main:app --reload
```

## Next integration step

Replace the local customer stats implementation with an Entersoft adapter under `backend/app/services/`.

