# Site Layer

This is the active runtime application.

## What runs in production

- `server.js`: main Node/Express backend + static hosting
- `public/`: customer/admin frontend files served by Node
- `lib/`: DB and customer-stats provider logic
- `scripts/`: operational scripts (import/reset/nightly)

## Runtime DB mode

Expected env on server:

- `DB_CLIENT=mysql`
- `MYSQL_HOST`
- `MYSQL_PORT`
- `MYSQL_DATABASE`
- `MYSQL_USER`
- `MYSQL_PASSWORD`

Health check:

- `GET /api/health`

## Key API contract

- `GET /api/admin/customers/:code/stats` (must remain stable)

## Notes

- This folder is the deployment target for Node on Plesk.
- Import scheduling is handled through `scripts/nightly-import.sh`.
