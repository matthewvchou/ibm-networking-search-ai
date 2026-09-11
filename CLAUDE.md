# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An internal IBM employee-directory / org-chart tool. v1 scope is **just Bluepages-backed directory search and org chart browsing** (search, employee profile, direct reports, manager chain). The README's longer-term vision (AI-driven "similar career path" matching between employees) is explicitly out of scope for v1 — don't build toward it unless asked.

Monorepo: `backend/` (Python/FastAPI) + `frontend/` (Vite/React/TypeScript). One repo, not two — the two halves are built in lockstep by a single developer.

## Commands

### Backend (`backend/`)
```
python -m venv .venv
.venv/Scripts/activate        # Windows; source .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
Interactive API docs at `http://localhost:8000/docs` once running — the fastest way to manually exercise an endpoint.

Test tooling (`pytest`, `pytest-asyncio`, `respx`) is in `requirements.txt`, but **no test files exist yet**. When adding tests, run with `pytest` from `backend/`.

Note: on Windows, `uvicorn --reload` has been flaky when many files change at once (reload fires but doesn't actually swap in the new app, so stale routes 404). If endpoints seem to not reflect recent code changes, stop the process and restart uvicorn without `--reload` to confirm, rather than assuming the code is wrong.

### Frontend (`frontend/`)
```
npm install
npm run dev       # Vite dev server, default :5173 (falls back to next free port if occupied)
npm run build      # tsc -b && vite build
npm run lint       # oxlint
```
The Vite dev server proxies `/api/*` to `http://localhost:8000` (see `vite.config.ts`), so the backend must be running for the frontend to work locally.

`react-d3-tree` is a real dependency (used by `OrgChart.tsx`, see below) — confirmed compatible with this repo's React 19 (peer range `16.x || 17.x || 18.x || 19.x`), no `--legacy-peer-deps` needed.

## Architecture

### Backend: Bluepages HTTP client, not LDAP

Despite "LDAP" being the original assumption, IBM's Bluepages directory is exposed as a **plain-text HTTP GET API**, not raw LDAP — there's no `ldap3`/bind/filter-escaping anywhere in this codebase. All directory access goes through `app/services/bluepages_client.py`, which calls `GET {base_url}/wsapi?{method}={value}` and parses the plain-text response.

Wire format specifics (load-bearing — get these wrong and parsing silently breaks):
- Records are `KEY: value` lines with **no blank-line separator** between records.
- A new record always starts exactly at a line beginning with `CNUM:`.
- A trailer line follows the records with no blank line before it: `# rc=0, count=N, message=Success` (or e.g. `# rc=904, message=Invalid request specified` for a malformed request). `rc != 0` is treated as a directory error, not a legitimately-empty result.

Bluepages methods used (passed as the `method` argument to `BluepagesClient.query`):
- `allByNameFuzzy` — name search
- `byCnum` — get one record by ID (**not** `bySerial`, which uses a different, incompatible ID scheme)
- `directReportsOf` — direct reports of a manager ID
- `managerChainFor` — chain of managers **above** a given ID; it excludes the employee itself and starts at their direct manager, so `EmployeeService.get_manager_chain` prepends the employee to match the documented "self → ... → top" contract.

Field/ID scheme: `CNUM` (unique employee ID, e.g. `005469897`) is `EMPNUM`+`EMPCC`. `MNUM` (manager reference, e.g. `6D9496897`) is `MGRNUM`+`MGRCC` — a plain ID string directly usable as input to `directReportsOf`/`managerChainFor`, not a DN. Other fields: `NAME` ("Last, First"), `DEPT`, `JOBRESPONSIB` (title), `INTERNET` (email), `COUNTRY`/`WORKLOC` (location), `MGR` (Y/N).

`app/services/employee_service.py` is the only place that maps raw Bluepages field dicts to the `Employee` Pydantic model (`app/models/employee.py`) — routers never touch raw Bluepages records directly.

`EmployeeService.get_org_chart` recursively builds an `OrgNode` tree (`{ employee, direct_reports: OrgNode[], has_more_reports: bool }`) by calling `get_direct_reports` at each level. Depth is capped server-side (clamped to 1–3 in the router) — nodes at the depth boundary that still have reports get `has_more_reports=True` instead of being expanded further, so the frontend can show them as expandable rather than silently truncating. Recursive fan-out uses `asyncio.gather` bounded by an `asyncio.Semaphore` (`_ORG_CHART_CONCURRENCY = 16` in `employee_service.py`) — sibling subtrees are fetched concurrently, not sequentially, which matters a lot once an org is more than ~1-2 people wide (a fully sequential version of this was measured at 18s+ for a ~144-person org; concurrent is ~8s for the same query).

`BluepagesClient` holds one reused `httpx.AsyncClient` for the lifetime of the instance rather than creating a new client (and paying a fresh TCP/TLS handshake) per call — this was a real, measured bottleneck once org-chart requests started firing many concurrent Bluepages calls. Keep reusing that shared client for any new methods added to `bluepages_client.py`; don't reintroduce a per-call `async with httpx.AsyncClient(...)`.

Currently pointed at the **unauthenticated test tier** (`bluepagestst.cpc.ibm.com`, set via `Settings.bluepages_base_url` in `app/core/config.py`, `.env`-overridable). Production host/auth is unknown and deliberately deferred; swapping tiers should stay a config change, not a code change. There is no cache and no application-level auth in v1 by design — see decisions in the plan file if one exists under `.claude/plans/`.

`BluepagesUnavailableException` (`app/core/exceptions.py`) is raised on `httpx` errors or a non-zero `rc`, and is mapped to a `503` by the exception handler registered in `app/main.py` — this is the only place a directory outage should surface as an HTTP status.

### Frontend: intentionally minimal test harness, plus one real component

`frontend/src/App.tsx` is still a **single-page manual test UI** — no router, no React Query. It's not meant to represent the eventual product structure; it exists to exercise the backend endpoints by clicking around: search, select an employee, and view their org chart. `frontend/src/api/client.ts` is a thin typed `fetch` wrapper, one function per backend endpoint, and is the only place that knows the backend's JSON response shapes.

`frontend/src/components/OrgChart.tsx` is the one piece of real, dedicated UI in the frontend so far. It renders a single `react-d3-tree` tree combining the ancestor chain (from `getManagerChain`) and the descendant subtree (from `getOrgChart`) into one `RawNodeDatum` tree — there's no in-place expand/collapse state; clicking any node (ancestor or descendant) just calls `onSelect(id)`, which re-runs `App.tsx`'s `selectEmployee` and re-centers the whole view on that person. Nodes at the `has_more_reports` boundary get a dashed accent border as a "click to load more" affordance. If you need to tune layout, `nodeSize`/`separation`/the container's fixed height are the levers — increasing tree depth or org width without adjusting these will clip labels against the container's bottom edge.

## Endpoint contract

| Method | Route | Response |
|---|---|---|
| GET | `/api/employees/search?q={term}&limit=50` | `{ results: Employee[], truncated: boolean }` |
| GET | `/api/employees/{id}` | `Employee` or `404` |
| GET | `/api/employees/{id}/direct-reports` | `{ reports: Employee[] }` |
| GET | `/api/employees/{id}/manager-chain` | `{ chain: Employee[] }` (self → ... → top) |
| GET | `/api/employees/{id}/org-chart?depth=2` | `OrgNode` (`{ employee, direct_reports: OrgNode[], has_more_reports }`); `depth` clamped to 1–3 server-side |
| GET | `/health` | `200`/`503` based on real Bluepages reachability |

## Sensitive data note

The test-tier Bluepages API returns **real IBM employee data** (names, emails, real org structure) — it isn't synthetic. Don't commit captured sample responses or fixtures containing this real PII; sanitize (fake names/emails) before checking in any test fixtures derived from live queries.
