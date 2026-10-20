# ibm-networking-search-ai

Personal internal IBM search tool. Intended use is for internal IBM employees (specifically new hires) to find other IBM employees that might interest them (similar career paths, managers, etc.).

The long-term vision includes AI-driven "similar career path" matching between employees. That is **not built**. Today the app does directory search, org chart browsing, and an AI summary of one person's resume.

## What it does

- **Search** by name (first or last name, either order) and/or job title substring. Results are a responsive card grid with photo, sector, title, and `City, ST, CC`.
- **Profile** with photo, contact details, work location (linked to Google Maps), and manager.
- **Org chart**: the person, their direct reports, their peers, and their manager chain. Cards expand in place to load more reports. Clicking a card opens that person.
- **Resume summary** (only ~15% of people have a resume on file): a 2-sentence summary plus skills, experience, education and certifications, each checked against the resume by a second model and given a verification score. Can be regenerated.
- Light and dark themes (IBM Carbon).

A chat panel component exists as a placeholder but is not shown and has no backend.

## Architecture

Monorepo: `backend/` (Python/FastAPI) and `frontend/` (Vite, React 19, TypeScript, Carbon).

### Backend

Data sources:

| Source | Used for |
|---|---|
| Bluepages WSAPI (plain-text HTTP, not LDAP) | Lookup by ID, direct reports, manager chain |
| SLAPHAPI (JSON over HTTP, takes LDAP filters) | Name and job-title search, work location, sector and other labels |
| w3 unified-profile resume proxy | The resume file (PDF or DOCX) |
| IBM Consulting Advantage (ICA) | Summary writer model and a separate grader model |

Both directory APIs point at the unauthenticated **test tier** (`bluepagestst.cpc.ibm.com`), which returns real employee data. The production host and auth are not decided. Switching tiers is a config change (`Settings.bluepages_base_url`).

Resume summary pipeline: fetch resume -> convert with MarkItDown -> write (two parallel model calls) -> grade (a different vendor's model, with every "supported" verdict backed by a quote that code finds in the resume) -> regenerate up to 4 attempts until the score is 80 or higher. Results are cached for 24 hours. Progress is exposed for the UI to poll.

Layout under `backend/app/`:

- `api/routers/` — `employees.py` (REST endpoints), `health.py`
- `services/` — `bluepages_client.py`, `slaphapi_client.py`, `employee_service.py` (the only place raw records become `Employee` models), `resume_client.py`, `resume_summary_service.py`, `summary_generator.py`, `summary_verifier.py`, `summary_prompt.py`, `summary_progress.py`, `ica_client.py`, `ttl_cache.py`
- `models/` — `employee.py`, `resume_summary.py`
- `core/` — `config.py` (settings from env / `.env`), `exceptions.py`

### Endpoints

| Method | Route | Response |
|---|---|---|
| GET | `/api/employees/search?q={name}&title={substr}&limit=50` | `{ results, truncated, total_matched }`. At least one of `q`/`title` is required (else `422`). `title` needs 2+ characters. `504` if the search times out. |
| GET | `/api/employees/{id}` | `Employee` or `404` |
| GET | `/api/employees/{id}/direct-reports` | `{ reports: Employee[] }` |
| GET | `/api/employees/{id}/manager-chain` | `{ chain: Employee[] }` (self -> ... -> top) |
| GET | `/api/employees/{id}/org-chart?depth=2` | `OrgNode` tree. `depth` is clamped to 1-3. |
| GET | `/api/employees/{id}/summary` | Resume summary with verification. Failures return `{ reason, detail }`. |
| GET | `/api/employees/{id}/summary/progress` | Attempt, phase and scores for a running summary |
| POST | `/api/employees/{id}/summary/regenerate` | Same as `/summary`, bypassing the cache. Keeps the old summary if the new one scores lower. |
| GET | `/health` | `200`/`503` based on real Bluepages reachability |

Interactive docs are at `http://localhost:8000/docs` when the backend is running.

### Frontend

React Router app (`/` search, `/employee/:id` profile, catch-all not-found). Search filters live in the URL. There is no data-fetching library. `src/api/client.ts` is the only place that knows the backend's JSON shapes. Profile photos come straight from the w3 image service (`src/api/photos.ts`), not the backend.

## Running locally

Requires Python 3 and Node.js on PATH.

**Windows, one step:** run `start.bat` from the repo root. It sets up the venv and dependencies on first run, creates `backend/.env` from the example, starts both servers, and opens `http://localhost:5180`.

**Manually:**

Backend:
```
cd backend
python -m venv .venv
.venv/Scripts/activate  # or source .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
uvicorn app.main:app --port 8000
```

Frontend:
```
cd frontend
npm install
npm run dev
```

Open `http://localhost:5180`. The dev server proxies `/api` to the backend on port 8000. On Windows, `uvicorn --reload` can serve stale routes; restart without it if endpoints look out of date.

### Configuration

Set in `backend/.env` (see `backend/.env.example`):

- `ICA_API_KEY` — your personal ICA developer key. **Resume summaries do not work without it.** Search and the org chart do.
- `BLUEPAGES_BASE_URL`, `ICA_BASE_URL`, `ICA_MODEL`, `ICA_VERIFIER_MODEL` and the timeout settings have working defaults in `backend/app/core/config.py`.

### Tests and checks

```
cd backend && pytest        # backend tests; resume fixtures are synthetic, no real resumes
cd frontend && npm run lint && npm run build
```

## Data handling

The test tier returns real IBM employee data. Do not commit captured responses or fixtures containing real names or emails. Resume text is sent to ICA and rendered in the UI as plain text only. Verification quotes stay on the server and are not logged.

## Deployment

Runs locally for now. `start.bat` runs the Vite dev server, not a production build. It is designed to be Azure-friendly later (config via env vars, logs to stdout), but there is no deployment yet. There is also no application-level auth.
