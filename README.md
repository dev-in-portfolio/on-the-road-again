# On The Road Again 🚗💨

**On The Road Again** is a private, mobile-first field-sales prospecting tool for restaurant outreach and route planning.

---

## Current Phase 1 Scope

The current app provides a streamlined mobile-first interface for field sales reps to:

- Enter and permanently save restaurant/business prospect names and addresses.
- **Address autocomplete** using Geoapify (server-mediated via Netlify Functions).
- **Geocode and persist** latitude/longitude coordinates for every saved prospect.
- **Duplicate detection** — warns before creating entries matching existing prospects.
- **Search** saved prospects by name, address, or address fragments.
- **Edit** prospect names and addresses (with re-geocoding when address changes).
- **Archive/restore** prospects.
- **Dropped Off / Not Dropped Off** status with instant persistence and undo.
- Store canonical prospect data in **Turso** (libSQL database).
- Use a MapLibre GL map with saved prospect pins.
- Build a persistent Current Route from map pins or prospect details.
- Reorder and remove route stops manually; route order survives search, status updates, refreshes, and returning from Google Maps.
- Mark a stop Dropped Off without removing it from the current route.
- Open the ordered route in Google Maps for editable directions and navigation.

> **Note:** Advanced features such as full CRM systems, automated route optimization, mileage tracking, and multi-user collaboration remain explicitly out of scope.

---

## System Architecture

```text
Browser (Vite + TypeScript SPA)
   ↓ HTTP / REST API
Netlify Functions
   ├── /api/prospects  →  netlify/functions/prospects.ts
   └── /api/geocode    →  netlify/functions/geocode.ts (Geoapify proxy)
       ↓ Server-side @libsql/client + fetch
Turso Database (libSQL)  +  Geoapify Geocoding API
```

### Security & Secret Isolation
- **CRITICAL:** All Turso database operations occur strictly server-side within Netlify Functions.
- `TURSO_AUTH_TOKEN` and `TURSO_DATABASE_URL` are never exposed to browser/client code.
- `GEOAPIFY_API_KEY` is kept server-side in the Netlify Function — never bundled into frontend assets.
- No environment variables are prefixed with `VITE_`.

---

## Database Schema

The application manages the `prospects` table in Turso:

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `TEXT PRIMARY KEY` | Stable UUID primary key |
| `restaurant_name` | `TEXT NOT NULL` | Business name |
| `address_input` | `TEXT NOT NULL` | Raw address as entered by user |
| `address_normalized` | `TEXT` | Geocoder-normalized address |
| `latitude` | `REAL` | Latitude coordinate |
| `longitude` | `REAL` | Longitude coordinate |
| `geocode_provider` | `TEXT` | Geocoding service identifier (e.g. "Geoapify") |
| `geocode_reference` | `TEXT` | Geocoder reference/place ID |
| `dropped_off` | `INTEGER` (0/1) | Boolean flag indicating if prospect was visited |
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
npm test
```

## Field workflow

1. Use the map to inspect prospect pins.
2. Add the restaurants receiving leave-behinds to **Current Route**.
3. Open **ROUTE · n** to review, reorder, remove, or mark a stop Dropped Off.
4. Open the completed route in Google Maps, where final directions and any last-mile rearranging remain editable.

Current Route is stored locally on the device. Search and list filters only change what is displayed; they never alter saved route membership or ordering.

## Private access

The app uses one shared private access code, checked only by the server. Configure these Netlify environment variables before deploying the access-control update:

```text
OTRA_ACCESS_CODE=<shared field-tool access code>
OTRA_SESSION_SECRET=<long random signing secret>
```

Authenticated sessions use a signed, HTTP-only cookie. The prospects API and Geoapify proxy reject unauthenticated requests and apply basic request-rate limits.

---

## Deployment Behavior

The repository is linked to Netlify project **`on-the-road-a`** (`https://on-the-road-a.netlify.app`).

Commits pushed to the `main` branch trigger automated Netlify production builds (`npm run build`), deploying the static frontend assets (`dist`) alongside serverless endpoints (`netlify/functions`).

---

## API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/prospects` | List active prospects |
| `GET` | `/api/prospects?search=...` | Search prospects by name/address |
| `GET` | `/api/prospects?archived=true` | List with archived |
| `POST` | `/api/prospects` | Create prospect (with duplicate detection) |
| `PATCH` | `/api/prospects` | Update prospect (status, name, address, archive) |
| `DELETE` | `/api/prospects?id=...` | Permanently delete prospect |
| `GET` | `/api/geocode?action=autocomplete&text=...` | Address autocomplete suggestions |
| `GET` | `/api/geocode?action=search&text=...` | Direct geocoding lookup |
