# On The Road Again 🚗💨

**On The Road Again** is a private, mobile-first field-sales prospecting tool for restaurant outreach and route planning.

---

## Current Phase 1 Scope

Phase 1 provides a streamlined mobile-first interface for field sales reps to:
- Enter and permanently save restaurant/business prospect names and addresses.
- Manage field prospect status (**Dropped Off** / **Not Dropped Off**) with instant persistence and undo support.
- Store canonical prospect data in Turso (libSQL database).
- Prepare data structures for future geocoding (Geoapify), MapLibre GL mapping, and Google Maps mobile handoff routing.

> **Note:** Advanced features such as full CRM systems, automated route optimization, mileage tracking, and multi-user collaboration are explicitly out of scope for Phase 1.

---

## System Architecture

```text
Browser (Vite + TypeScript SPA)
   ↓ HTTP / REST API
Netlify Function (/api/prospects -> netlify/functions/prospects.ts)
   ↓ Server-side @libsql/client
Turso Database (libSQL)
```

### Security & Secret Isolation
- **CRITICAL:** All Turso database operations occur strictly server-side within Netlify Functions.
- `TURSO_AUTH_TOKEN` and `TURSO_DATABASE_URL` are never exposed to browser/client code, never bundled into frontend assets, and never prefixed with `VITE_`.

---

## Database Schema

The application manages the `prospects` table in Turso:

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `TEXT PRIMARY KEY` | Stable UUID primary key |
| `restaurant_name` | `TEXT NOT NULL` | Business name |
| `address_input` | `TEXT NOT NULL` | Raw address as entered by user |
| `address_normalized` | `TEXT` | Geocoder-normalized address (future) |
| `latitude` | `REAL` | Latitude coordinate (future) |
| `longitude` | `REAL` | Longitude coordinate (future) |
| `geocode_provider` | `TEXT` | Geocoding service identifier (future) |
| `geocode_reference` | `TEXT` | Geocoder reference ID (future) |
| `dropped_off` | `INTEGER` (0/1) | Boolean flag indicating if prospect was visited/dropped off |
| `dropped_off_at` | `TEXT` | ISO timestamp of drop-off |
| `archived` | `INTEGER` (0/1) | Archive status flag |
| `created_at` | `TEXT NOT NULL` | ISO creation timestamp |
| `updated_at` | `TEXT NOT NULL` | ISO update timestamp |

Database initialization is completely **idempotent** (`CREATE TABLE IF NOT EXISTS`).

---

## Environment Variables

Server-side environment variables configured on Netlify:

```text
TURSO_DATABASE_URL=libsql://<your-db-name>.turso.io
TURSO_AUTH_TOKEN=<your-turso-auth-token>
```

Optional future keys:
```text
GEOAPIFY_API_KEY=<your-geoapify-api-key>
```

> **Warning:** Never commit `.env` files or expose authentication tokens.

---

## Local Development & Build Instructions

### Prerequisites
- Node.js (v18+)
- npm
- Netlify CLI (`npx netlify`)

### Installation
```bash
npm install
```

### Running Locally with Netlify Dev (Functions + Vite)
```bash
npx netlify dev
```

### Typechecking & Production Build
```bash
npm run typecheck
npm run build
```

---

## Deployment Behavior

The repository is linked to Netlify project **`on-the-road-a`** (`https://on-the-road-a.netlify.app`).

Commits pushed to the `main` branch trigger automated Netlify production builds (`npm run build`), deploying the static frontend assets (`dist`) alongside serverless endpoints (`netlify/functions`).
