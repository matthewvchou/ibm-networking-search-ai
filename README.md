# ibm-networking-search-ai

Personal internal IBM search tool. Intended use is for internal IBM employees (specifically new hires) to search for other IBM (or ex-IBM) employees that might interest them (i.e. similar career paths, managers, etc.).

The long-term vision includes AI-driven "similar career path" matching, but that's out of scope for v1. **v1 is just Bluepages-backed employee directory search and org chart browsing.**

## Status

Backend (M1) and a basic test frontend are done and working against IBM's real Bluepages test-tier API.

### Backend

Python/FastAPI, calling IBM's Bluepages directory over its HTTP API (`BpHttpApisv3/wsapi`) — not raw LDAP as originally planned; the API locator revealed it's a plain-text HTTP GET API, which simplified things considerably. Currently pointed at the unauthenticated test tier (`bluepagestst.cpc.ibm.com`); production host/auth is unknown and deferred — swapping it is just a config change (`Settings.bluepages_base_url`).

- `app/services/bluepages_client.py` — raw HTTP client + text-response parser for `wsapi`
- `app/services/employee_service.py` — maps raw Bluepages records to `Employee` models; implements search, get-by-id, direct-reports, manager-chain
- `app/api/routers/employees.py` — REST endpoints
- `app/api/routers/health.py` — `/health`, checks real Bluepages reachability
- `app/core/config.py` — settings via `pydantic-settings` / `.env`

Endpoints (all verified against real data):

| Method | Route | Response |
|---|---|---|
| GET | `/api/employees/search?q={term}&limit=50` | `{ results: Employee[], truncated: boolean }` |
| GET | `/api/employees/{id}` | `Employee` or `404` |
| GET | `/api/employees/{id}/direct-reports` | `{ reports: Employee[] }` |
| GET | `/api/employees/{id}/manager-chain` | `{ chain: Employee[] }` (self → ... → top) |
| GET | `/health` | `200`/`503` based on Bluepages reachability |

Not yet built: `/api/employees/{id}/org-chart`, rate limiting, structured logging, automated tests.

### Frontend

Vite + React + TypeScript. Currently just a **basic single-page test harness** (no router, no React Query yet) — a search box, clickable results, and a detail panel showing profile + manager chain + direct reports, all clickable so you can navigate the org chart manually. Good enough to exercise the backend end-to-end; will grow into proper pages/routing later.

- `src/api/client.ts` — typed fetch wrapper for the backend endpoints
- `src/App.tsx` — the single-page test UI
- Vite dev server proxies `/api` to the backend to avoid CORS in dev

## Running locally

Backend:
```
cd backend
python -m venv .venv
.venv/Scripts/activate  # or source .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Frontend:
```
cd frontend
npm install
npm run dev
```

Then open the Vite dev URL (default `http://localhost:5173`).

## Deployment

Runs locally for now. Designed to be Azure-friendly later (config via env vars, stateless, logs to stdout) — no Azure deployment yet.
