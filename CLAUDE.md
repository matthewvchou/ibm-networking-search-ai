# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An internal IBM employee-directory / org-chart tool. Scope: **Bluepages-backed directory search and org chart browsing**, plus two deliberate expansions:

- An **AI summary of one person's resume** on their profile (strictly per-person; see "Resume summaries").
- The **Profile page** (`/profile`): the user's own profile plus a scrolling row of "people you might reach out to" (see "Profile page and suggested people"). It turns one resume into job-title search terms and runs the existing title search. These are keyword searches, nothing more.

Still out of scope, don't build toward it unless asked: the README's old vision of AI "similar career path" matching (embeddings, any cross-person scoring or comparison). `ChatPanel.tsx` is a "Chat is not available yet" placeholder, **not rendered anywhere**, with no assistant backend.

Monorepo: `backend/` (Python/FastAPI) + `frontend/` (Vite/React/TypeScript, Carbon UI, light/dark theme), built in lockstep by one developer.

## Commands

### Both halves (Windows)
```
start.bat         # repo root
```
Creates `backend/.venv` if missing, runs a quiet `pip install -r requirements.txt` on **every** launch, runs `npm install` if `frontend/node_modules` is missing, copies `backend/.env.example` to `backend/.env` if absent, opens the backend (`:8000`) and Vite (`:5180`) in two windows, waits a fixed 6s, then opens the browser (a slow backend may still be starting). It starts uvicorn **without** `--reload` (see below). Python 3.10–3.14 (`markitdown` declares `<3.15`) and Node 20.19+ or 22.12+ (Vite 8) must be on PATH.

`backend/.env.example` sets `ICA_MODEL=gpt-6-luna`, matching the `config.py` default. A value in `.env` overrides the default, so keep the two in step. It omits `ICA_VERIFIER_MODEL`, `SLAPHAPI_SEARCH_TIMEOUT_SECONDS`, `RESUME_BASE_URL` and `RESUME_TIMEOUT_SECONDS`, which fall back to the `config.py` defaults. A `.env` created from the old example (`gpt-5.6-luna`) keeps that value until edited.

### Backend (`backend/`)
```
python -m venv .venv
.venv/Scripts/activate        # Windows; source .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
Interactive docs at `http://localhost:8000/docs`.

Tests: `pytest` from `backend/` (129 tests, all offline; `pytest`, `pytest-asyncio`, `respx` are in `requirements.txt`). `test_employee_service.py` covers name and filter construction as pure functions. Summary and keyword tests use `respx` for the resume proxy and ICA, and fake clients for cache/dedupe/prefetch logic. `tests/resume_fixtures.py` builds synthetic PDF/DOCX in code, so no real resume is ever a fixture. The empty `backend/conftest.py` puts `app/` on `sys.path`; don't delete it. There are no frontend tests.

Windows note: `uvicorn --reload` is flaky when many files change (reload fires but doesn't swap in the new app, so stale routes 404). If endpoints don't reflect recent changes, restart without `--reload` before assuming the code is wrong.

### Frontend (`frontend/`)
```
npm install
npm run dev       # Vite on :5180 (strictPort: fails rather than picking another port)
npm run build     # tsc -b && vite build
npm run lint      # oxlint
```
Vite proxies `/api/*` to `http://localhost:8000` (`vite.config.ts`), so the backend must be running. The browser only talks to the proxy, so CORS never applies in dev; `main.py`'s `allow_origins=["http://localhost:5173"]` names an unused port and is dead config.

`npm run lint` exits 0 with pre-existing `react(set-state-in-effect)` / `only-export-components` warnings (`EmployeeDetailView`, `SearchPage`, `OrgChart`, `SuggestionsSection`, `Identity.tsx`). `npm run build` is clean. `react-d3-tree` (used by `OrgChart.tsx`) works with React 19, no `--legacy-peer-deps`.

## Architecture

### Backend: Bluepages HTTP client, not LDAP

Bluepages is a **plain-text HTTP GET API**, not raw LDAP: no `ldap3`, no bind. WSAPI goes through `app/services/bluepages_client.py` (`GET {base_url}/wsapi?{method}={value}`, plain-text response). SLAPHAPI (`app/services/slaphapi_client.py`) is JSON over GET but takes a real **LDAP filter expression** in the URL, so filter escaping matters.

Wire format (get it wrong and parsing silently breaks):
- Records are `KEY: value` lines with **no blank line** between records; a record starts at a line beginning `CNUM:`.
- A trailer follows with no blank line: `# rc=0, count=N, message=Success`. `rc != 0` is a directory error, not an empty result.

WSAPI methods (the `method` arg of `BluepagesClient.query`):
- `byCnum` — one record by ID (**not** `bySerial`, an incompatible ID scheme)
- `directReportsOf` — a manager's direct reports
- `managerChainFor` — managers **above** an ID, excluding the employee, so `EmployeeService.get_manager_chain` prepends the employee for the "self → ... → top" contract

IDs/fields: `CNUM` (e.g. `005469897`) is `EMPNUM`+`EMPCC`. `MNUM` (e.g. `6D9496897`) is `MGRNUM`+`MGRCC`, a plain ID usable directly in `directReportsOf`/`managerChainFor`, not a DN. Others: `NAME` ("Last, First"), `DEPT`, `JOBRESPONSIB` (title), `INTERNET` (email), `COUNTRY`/`WORKLOC`, `MGR` (Y/N).

**Work location** is one thing, not two:
- `Employee.location` is the friendly *country* name (`co`/`COUNTRY`) despite the name. `city`, `state`, `address` come from one `ibmworklocation` lookup (`_place_from_work_location` takes `l`/`st`; `st` is the full name and legitimately empty for countries without states). `building` comes off the `ibmperson` record.
- `_format_address_slaphapi` builds a **purely postal** address with no `Building NNN` prefix: it only serves as a Google Maps query and hover title, and a building number degrades geocoding. The building is shown via `Employee.building`.
- The profile renders `City, State` as a Maps link; search cards render `City, ST, CC` as one `Tag`. The card ends in `Employee.country_code` (ISO alpha-2 from `hrcountrycode`, 322/322 populated), **not** `location`, because the friendly name is inconsistent (US arrives as "United States of America" ×170 *and* "United States" ×51; UK as "United Kingdom" ×46 *and* "N.Ireland & England & Scotland & Wales (United Kingdom)" ×6). `location` is the profile's fallback when there is no city.
- Both join on `.filter(Boolean)` so a missing state leaves no empty segment ("Hursley, GB", or just "NZ"), fall back to the country alone with no city, and the profile falls back to plain text with no address.

**Name search runs on SLAPHAPI**, not WSAPI `allByNameFuzzy`. `_compose_filter` joins one predicate per criterion in fixed order (`hractive` → name → title). `_name_predicate` gives `(|(sn=q*)(givenname=q*))`, so surname and first name are equal (the old path matched surnames only for a bare word). A multi-token query tries both orders ("Laura Smith" = "Smith, Laura"); the pair is sorted only to keep the filter string canonical.

Two hard-won constraints in that filter:
- **A 1–2 character query matches exactly, not by prefix.** There is no server-side size limit: `(sn=a*)` measured **108MB** before timing out, `(sn=ma*)` ~66MB, 3 characters 2–12MB. Truncation to `limit` is client-side, *after* parsing the whole payload. Search has its own `slaphapi_search_timeout_seconds` (10s) because a broad 3-char prefix can take most of 5s.
- **Values are escaped (RFC 4515)** via `_LDAP_FILTER_ESCAPES`. Search is the only place user text reaches a filter.

**Job title search** (`title=`) adds `_title_predicate`, a substring match on `jobresponsibilities`:
- **The field is sparse**: 14%, 17%, 32%, 36% across live slices, roughly a quarter. `title` and `description` on `ibmperson` are **0% populated**, dead ends. The UI says so next to the input. Don't infer the rate from a page: SLAPHAPI's order clusters populated records early.
- **One assertion per token, ANDed**: `(&(jobresponsibilities=*senior*)(jobresponsibilities=*architect*))`, not `*senior architect*`. Tokens may be non-adjacent and in either order (133 matches vs 18). Repeated assertions on one attribute are valid (verified).
- **`TITLE_SUBSTRING_MIN_LENGTH = 2`; only the 1-char case is dangerous**: `*a*` took 29s and `*e*` 29.6s (past the 10s budget); `*vp*`, `*ux*` 0.8s, `*ai*` 1.5s. Short real titles exist ("C#", "VP", "UX", "C++"). The floor bounds nothing more: `*Manager*` is still 16.9MB/6.7s. A broad title can legitimately time out, hence the 504 below.

A search **requires a name or a job title** (router answers `422`). There is no "match everything": bare `(&(hractive=A))` is the whole directory, 154MB+ without completing. `_compose_filter` returns `None` for it and `EmployeeService.search` returns empty, as defence in depth.

**Non-person records are excluded from every people-facing path.** The live `ibmemployeetype` table (17 codes, read by `_resolve_employee_type`) has exactly two "non-Person" codes: `N` "Functional Id" (shared service account, e.g. a helpdesk) and `Q` "Entry owned by specific Application". `_NON_PERSON_EMPLOYEE_TYPES` is that pair and **should stay narrow**: the other codes are people, including non-IBM ones (`B` business partner, `C` contractor, `V` vendor, `G` IP partner, `H` e.g. Red Hat).
- **Search never needed it; the org chart did.** Non-person records have no `hractive`, so `(&(hractive=A)…)` already excludes them (verified: `(&(hractive=A)(uid=C-X8YF897))` → `count: 0`). They leaked through the WSAPI org chart, where `directReportsOf` takes no filter, so exclusion is client-side after parsing. `search` applies it too, as a measured no-op. **Don't add a conjunct to `_compose_filter`**; it would rewrite a dozen exact-filter tests for nothing.
- **It lives inside `get_direct_reports`, not its callers**, because `_build_org_node` derives `has_more_reports` from that result. Otherwise a manager with only functional-ID reports would offer a "load more" that expands into nothing.
- **Match the code, not the name marker** (`*FUNCTIONAL-ID*`, `*APPLICATION-ID*`). The marker is redundant (never one without the other) and is the only non-person marker; `*CONTRACTOR*`, `*VENDOR*`, `*PARTNER*` are people.

`get_by_id` / `get_enriched_by_id` return `None` for these, so `/api/employees/C-X8YF897` is a **404**, same as a bad ID (the frontend's `'not-found'` state is all it needs). `get_enriched_by_id` checks before its five label lookups, so it costs one request, not six. The test tier's ~25% `entrytype=test` junk records are deliberately *not* filtered: they won't exist in production and the rule would become dead code.

**SLAPHAPI attribute list is `&`-delimited, not comma-delimited.** `byjson?cn&sn` works; `byjson?cn,sn` gives an empty `attribute` array with `code: 0` (a silent empty parse). Projection shrinks responses ~9x (`(sn=ma*)`: 33MB/15s at `*`, 3.6MB/2.2s projected). **The code still requests `*` everywhere**; adopting projection is a deliberate separate change and the real fix for job-title tail latency.

**Every filter is percent-encoded** before reaching the URL (`_SAFE_FILTER_CHARS` in `slaphapi_client.py`), a layer separate from RFC 4515 escaping (both needed). Raw values break the URL: `+` decodes to a space server-side (`C++` answered 14, correct 16), and `#` truncates the URL as a fragment so SLAPHAPI misses `/byjson` and replies in the wrong format. `safe=` keeps the filter grammar (`()&|=!*,`) intact so only values are escaped.

**Names are normalized in the backend; `display_name` is "First Last" on every endpoint** and the frontend renders it verbatim, with no display-time reformatting. `_wsapi_name` splits WSAPI `NAME` (one comma, surname first); `_slaphapi_name` composes `preferredfirstname`/`givenname` + `preferredlastname`/`sn`. **Never derive a name from `cn`, and never reorder on a comma**: ~1–2% of live records have a stray comma in first-then-last order (`cn="Jinkwang, Kim"`, `sn=Kim`), indistinguishable from "Last, First", so a comma swap rendered them surname-first (a real bug). `preferred*` beats `sn`/`givenname` because `givenname` can be multi-valued (`["Huan", "Huan B"]`) and `SlaphapiClient` keeps `value[0]` arbitrarily. `Employee.last_name` carries the surname separately (multi-word surnames exist, e.g. `sn="Nguyen Duc"`) for sorting.

`app/services/employee_service.py` is the only place raw Bluepages dicts become the `Employee` model (`app/models/employee.py`); routers never touch raw records.

`EmployeeService.get_org_chart` builds an `OrgNode` tree (`{ employee, direct_reports, has_more_reports }`) by calling `get_direct_reports` per level. Depth is clamped to 1–3 in the router; nodes at the boundary that still have reports get `has_more_reports=True` so the frontend shows them as expandable. Fan-out uses `asyncio.gather` under a semaphore (`_ORG_CHART_CONCURRENCY = 16`): sequential measured 18s+ for a ~144-person org, concurrent ~8s.

`BluepagesClient` holds one reused `httpx.AsyncClient` per instance (a per-call client paid a fresh TCP/TLS handshake, a measured bottleneck). Keep reusing it in new methods; don't reintroduce `async with httpx.AsyncClient(...)` per call.

Pointed at the **unauthenticated test tier** (`bluepagestst.cpc.ibm.com`, `Settings.bluepages_base_url` in `app/core/config.py`, `.env`-overridable). Production host/auth is unknown and deferred; swapping tiers must stay a config change. There is no application-level auth by design.

**Caching** is absent in v1 except for these. Two are process-lifetime maps of immutable reference data with no personal data (summary and keyword caches are separate, bounded and expiring; see their sections):
- `_place_cache`: `workLoc → (city, state)`. WSAPI person records carry only the office *code*, and a page spans far fewer offices than people, so `_attach_places` resolves each distinct code once (bounded by `_CITY_LOOKUP_CONCURRENCY`). **Only successes are cached** (keyed on a resolved city, so a state-less office still caches); caching a miss from a transient outage would poison later searches. Don't widen this into a general response cache without revisiting.
- `_org_unit_cache`: `hrOrganizationCode → sector`. The search card shows the sector ("Consulting") instead of the raw `dept` code ("BDO", "870361"). `_attach_org_units` resolves it from `ibmorganization.hrorganizationdisplay` in **one batched OR filter** over the page's uncached codes (a 50-row page spans ~41 codes; a fan-out would roughly triple the request count, the batch takes ~0.7s). No chunking needed: the page cap bounds the filter to ~1.2KB. The table is 584 rows → 70 display values, so a few searches warm it. `hrgroupid` looks tidier (10 values) but holds `F&O`, `GF`, `CHQ/OTH`, exactly what this removes. `Employee.org_unit` is the one resolved label populated on search as well as the profile.

**Exceptions:** `BluepagesUnavailableException` (`app/core/exceptions.py`) is raised on `httpx` errors or non-zero `rc` and mapped to `503` in `app/main.py`; it is the only place a directory outage should become an HTTP status. `DirectoryTimeoutException` subclasses it, is raised on `httpx.TimeoutException`, and maps to **`504`**, because a broad title substring can time out legitimately and 503 wrongly says the directory is down. It stays a subclass so `_lookup`'s `except BluepagesUnavailableException` still degrades a failed label lookup to "no label". Starlette picks handlers by MRO, so the specific one wins regardless of registration order.

### Profile photos: a separate w3 service, not Bluepages

**Photos are not in the directory.** `ibmperson` has no photo attribute: `?*&+` (every populated and operational attribute) returns 75 names, none photo-related; explicit requests for `jpegphoto`/`photo`/`thumbnailphoto`/`photourl`/`hasphoto`/`picture` return `"attribute": []` with `code: 0`; the schema's only binary attributes are `notesPublicKey`, `userCertificate`, `userPassword`; the adverb set is closed (`bytext|byldif|byxml|bydsml|byjson|byhtml`), no `byphoto`. Don't re-probe.

They come from `https://w3-unified-profile-api.ibm.com/v3/image/{CNUM}`: **no auth**, also accepts an email, `cache-control: max-age=86400`. `frontend/src/api/photos.ts` is the only place that knows the URL; the backend is not involved and `Employee.photo_url` is deliberately unused (the URL derives from the id the frontend has). Coverage ~92% (37 of 40 live records).

- **`?s=N` is a real server-side resize** of a 400x400 source, so the response is exactly NxN (`s=48` is 995B vs 21KB). Callers request 2x their rendered box for HiDPI; without it a 10-row page pulls ~200KB.
- **`?def=none` makes the initials fallback possible.** By default a person with no photo gets a grey silhouette at `200 image/jpeg`, indistinguishable from a real photo. `def=none` answers `404`, the `<img onError>` hook. It is *undocumented* (the service's message lists only `avatar|init|blue|null`; every unrecognised value, even `NONE`, is a `400`), so if tightened the symptom is a grey silhouette where initials belong, not an error. `def=init` is no substitute: an empty blue circle.

`AvatarCircle.tsx` is the circular avatar (photo over an initials circle, which shows through on 404), shared by search cards and org-chart nodes; it owns `initialsOf`. The profile card does **not** use it: it renders the square uncropped and nothing when there is no photo. Node avatars are pinned at 28px because `CARD_HEIGHT`/`LINK_CLEARANCE`/`NODE_SIZE` are one coupled set. Don't set `crossOrigin` on these images: a plain `<img>` needs no CORS, and the service sends `access-control-allow-credentials: true` with a specific origin, which `"anonymous"` would break.

### Resume summaries: w3 resume proxy → MarkItDown → ICA writer → ICA grader

`GET /api/employees/{id}/summary` returns a `ResumeSummary` (`app/models/resume_summary.py`): a 2-sentence `summary`, then `skills` (≤5 groups), `experience` (≤8 roles), `education`, `certifications`, and a `verification`. It is a separate endpoint so the profile never waits on it.

1. **Cache** (`TtlLruCache`, 500 entries): summary 24h, confirmed "no resume" 1h, keyed on uid. **Failures are never cached**, but an *ungraded* summary (grader failed) is. Concurrent requests for one person share one in-flight task (`asyncio.shield`ed so a navigated-away browser doesn't cancel it).
2. **Fetch** (`ResumeClient`): `https://w3-ui-unified-profile-proxy.w3-ui.dal.app.cirrus.ibm.com/up-api-proxy/v3/resume/{uid}`, no auth, `404` = no resume. Use https (http only 302s). Needs **`truststore`**: the host uses an internal IBM CA that certifi lacks.
3. **Convert** (MarkItDown, in a thread, no length cap by decision). The file is whatever was uploaded: of 12 resumes among 80 people, 9 PDF, 2 DOCX, 1 legacy DOC, and one DOCX arrived as `application/octet-stream`, so format comes from the `content-disposition` filename first. `_resume_format` is an **allowlist** (PDF, DOCX) because MarkItDown doesn't reject what it can't parse.
4. **Write** (`SummaryGenerator`, `gpt-6-luna` via `ICA_MODEL`): two **parallel** calls, prose (the 2 sentences) and extraction (structured lists, copied not composed). `POST {ICA_BASE_URL}/chat-models/chat/completions`, OpenAI-compatible, bearer `ICA_API_KEY` (a personal developer key); `chat-models` because assistant/agent namespaces carry hidden instructions. `response_format: json_object` is accepted but **not enforced** (Claude Haiku fences its JSON), so replies are fence-stripped and Pydantic-validated with one retry, separate from the grading loop. Models emit years as numbers, hence `coerce_numbers_to_str`. The resume goes in `<resume>` tags as untrusted data and the UI renders every field as plain text.
5. **Grade** (`SummaryVerifier`, `claude-haiku-5-5` via `ICA_VERIFIER_MODEL`, deliberately a different vendor from the writer). Code lists every structured claim (skill, role, employer, dates, degree, institution, certification) and accepts those whose text it finds in the normalized resume. Haiku judges only the *unmatched* ones plus the atomic claims of the 2 summary sentences, and must back each "supported" verdict with a verbatim quote that **code then finds in the resume** (case/whitespace/punctuation-insensitive, ≥8 chars); a missing quote or id counts as unsupported. **The score is `round(100 × supported / total)` computed in code**, equal weight per claim, `null` when there is nothing to check. Quotes stay on the server and are never logged. The prompt is adversarial on purpose (inference, generalization, "contributed"→"led", merged facts, shifted dates are unsupported). One retry on an invalid reply; a second failure is a grader failure.
6. **Loop**: `VERIFICATION_PASS_SCORE = 80`, `MAX_ATTEMPTS = 4` (one cold + three regenerations), in `summary_generator.py`. Below 80, **prose only** is rewritten with the rejected summary claims as feedback; the extraction is reused. Structured items the grader rejected are **dropped** (flagged `removed`) and still count against later scores so dropping isn't a way to score higher. More than 3 drops re-runs the extraction. The best-scoring attempt is returned, not the last. **A grader failure never fails the summary**: it ends the loop and returns the best graded attempt, or the draft with `verification: null` ("Not verified"). Writer concurrency `_ICA_CONCURRENCY = 4`; grader pool of 3.
7. **Progress and regeneration**: `GET .../summary/progress` reads an in-memory `ProgressBoard` (attempt, phase, per-attempt scores, the first ungraded draft so the panel can show it at ~15s); the frontend polls it every second while `/summary` is pending. `POST .../summary/regenerate` bypasses the cache with a fresh 4-attempt budget and replaces the cached summary only if the new score is **no lower** (response carries `replaced`, `attempted_score`). Concurrent regenerations share one run. The previous summary's text goes into the prose prompt (`previous_summary`) asking for different wording and emphasis, since the same prompt otherwise returns the same text; every statement must still be stated outright in the resume, and the result is graded as usual. A regeneration publishes no draft, since the old summary stays on screen.
8. **Prefetch**: serving a summary queues the person's manager and direct reports (≤20) in the background, running the full grade loop. Prefetch is capped at 2 of the 4 writer slots so an on-screen request always finds two free; it publishes no drafts and doesn't prefetch further.

Errors are `SummaryUnavailableException(reason, message, status)` → `{reason, detail}` via `main.py`: `no_resume` 404, `unreadable_resume` 422, `bad_output`/`ica_rejected` 502, `ica_timeout` 504, and `not_configured`/`key_invalid`/`not_entitled`/`rate_limited`/`ica_unavailable`/`resume_unavailable` 503. It is deliberately not a `BluepagesUnavailableException`, and `/health` stays Bluepages-only. Validation errors are logged as field paths only, because pydantic's default message quotes resume content.

Measured on synthetic resumes only: `gpt-6-luna` returns valid unfenced JSON for both schemas (2–3s warm, ~9s cold); a planted-errors summary scored 33 with every planted error flagged; a clean full loop ~19s. **Not measured: a worst-case 4-attempt run on a real, long resume**, estimated 100s+ on one blocking `GET`; if a browser or proxy cuts it, move generation behind a `POST` and poll. Model catalog: `GET {ICA_BASE_URL}/chat-models/models`. Only ~15% of people have a resume.

### Profile page and suggested people

**There is no login; "the user" is self-declared.** `frontend/src/identity/Identity.tsx` keeps `{id, name}` in `localStorage` (`ibm-directory-me`) plus a `sessionStorage` flag for "Skip for now"; all access is guarded like the theme key. `AppLayout` shows `IdentityPicker` (a name search whose result cards pick that person on click) instead of the routed page when there is neither an identity nor the skip flag, leaving the URL alone so a pasted deep link opens after the pick. `/profile` ignores the skip flag. A saved id that answers `404` is dropped (`EmployeeDetailView`'s `onNotFound`), returning the user to the gate. "Not you?" is a button beside "W3 Page" on the profile card, shown only on `/profile` (`EmployeeProfile`'s `onNotYou`), so identity can only be changed there. The header's `/profile` link is a person icon. Anyone can pick anyone: "my view", not security.

`/profile` renders `EmployeeDetailView` (also the body of `EmployeeDetailPage`, taking `id` as a prop) then `SuggestionsSection`, both keyed on the identity id so switching identity resets them.

**Suggestions are keyword searches.** `GET /api/employees/{id}/suggestions/keywords` (`KeywordSuggestionService`) asks the writer model for ~20 job-title phrases (1–3 words) from the converted resume, or from the profile's job title and sector when there is no resume (`source: "resume" | "title" | "none"`; `none` makes no model call). It's separate from `/summary` so it never waits on grading, and it does **not** grade: phrases are search terms, not claims. `clean_phrases` trims, drops anything under `TITLE_SUBSTRING_MIN_LENGTH`, dedupes ignoring case and caps at 20, because the strings end up in a directory filter. Cached per employee in a `TtlLruCache` (24h from a resume, 1h otherwise, failures never cached). The resume is fetched and converted again rather than cached, on purpose: raw resume text is personal data and a text cache would need its own bounds.

The browser runs one `/api/employees/search?title=<phrase>&limit=10` per phrase, 4 at a time (`useSuggestedPeople`), and merges the results into one horizontally scrolling row (`PeopleRow`, 260px cards stretched to the tallest, capped at 60). The merge is append-only: each finished batch is interleaved round-robin and added at the end, so a visible card never moves. A failed or timed-out phrase is skipped; the row errors only if every phrase failed. Removing a chip removes only that phrase's people. Each phrase is searched once per mount. The merge logic is pure functions in `utils/suggestionMerge.ts`.

Chips (`PhraseChips`) are editable and saved per person in `localStorage` (`utils/suggestionStorage.ts`). Once saved, the model isn't asked again; "Reset to suggestions" clears them and asks again. Title search sees ~a quarter of people and ~15% have a resume, so an empty or thin row is normal and the section says so.

**Cost:** a cold `/profile` load fires up to 20 title searches; a broad phrase can take 10s or `504`. Not measured: phrase quality on a real, long resume.

### Frontend: Carbon UI, router, no data-fetching library

`frontend/src/App.tsx` is a `react-router` router (no React Query) inside `ColorThemeProvider` and `IdentityProvider`. `/` renders `AppLayout` (Carbon `Theme` + `AppHeader` + `<Outlet/>` + `ThemeToggleButton`, or the `IdentityPicker` gate instead), with `SearchPage` at the index, `ProfilePage` at `/profile`, `EmployeeDetailPage` at `/employee/:id`, `NotFoundPage` as catch-all. Search state is in the URL (`?q=` name, `?title=` job title). Clicking a card or org-chart node navigates by id; the detail page always re-fetches (no employee object carried from the list) and carries the whole search string so filters survive a trip into a profile and back. `AppHeader` shows a compact search box on every page except `/`, and "Back to search" on profiles.

Theming: Carbon `g10` (light) / `g100` (dark), chosen by `theme/ColorTheme.tsx` from `localStorage` (`ibm-directory-theme`, guarded because it throws in some privacy modes), else `prefers-color-scheme`. The zone class goes on `<html>` as well as the `Theme` wrapper so the page background and portalled elements match. `styles/carbon.scss` pulls in Carbon; `index.css` maps tokens to `--accent`/`--bg`/`--border`/`--text`/`--text-h`, which the inline-styled components read.

`frontend/src/api/client.ts` is a thin typed `fetch` wrapper, one function per endpoint, and the only place that knows the backend's JSON shapes.

**Search results are a card grid**: `EmployeeSearchResults.tsx` lays out `EmployeeCard`s (also used by the identity picker and suggestions row; your own card opens `/profile`, others `/employee/:id`) with `grid-template-columns: repeat(auto-fill, minmax(260px, 1fr))`. The column count falls out of the width (4 / 3 / 2 / 1) with no media queries, which matters because inline styles can't express them; `index.css` holds only token aliases plus the few rules needing a real selector (profile sector tag, org-chart link colour and spinner). The 260px floor is paired with `SearchPage.tsx`'s `maxWidth: 1200`: four tracks + three 16px gaps = 1088, a fifth needs 1364. **Move one number and the column count changes.** Carbon's `Content` adds 2rem padding on top of the page's 24px. The form keeps its own `maxWidth: 700`. `PAGE_SIZE` is 32 (eight rows of four) against a 50-result response, so a broad search is two pages (32 + 18); the frontend sends no `limit`, the route accepts up to 100 (`clamped_limit`). The endpoint still returns `truncated` and `total_matched` and `SearchResponse` types them, but **nothing in the UI reads them**; the "Showing 50 of 374 matches" notice was removed deliberately, so don't wire it back in.

`EmployeeDetailPage` is a thin wrapper (reads `:id` and the search string) around `EmployeeDetailView`, also used by `ProfilePage`. The view is two rows: profile card and `ResumeSummaryPanel` share the top row 2:3 (flex-wrap stacks them when narrow), and the org chart takes the full width below. The panel is keyed on the route id and fetches itself, so the slow summary call starts alongside the profile fetch; `no_resume` renders "No resume on file", any other reason a warning with the backend's message.

`EmployeeDetailView` fetches the profile, manager chain and a **depth-1** org chart in parallel, then the direct manager's reports (`getDirectReports`) as the "peers" row. A failed peer lookup is swallowed on purpose: it costs the peer row, not the page. The manager id is `managerChain[1]` (index 0 is the person), used only to find peers; the profile card shows no "Reports to" line.

**`OrgChart.tsx`** (the largest component) renders one `react-d3-tree` tree from `buildTreeData` over four sources: the person (`orgNodeToRaw`), their reports, their peers, and the manager chain. Rules that are easy to break:
- **Peers are leaves**, laid out by `rowAround` around the selected person (others sorted by surname, split either side so the spine stays centred). A peer's reports load only on chevron click; don't rebuild the row from `getOrgChart`.
- **The manager chain folds**: direct and skip-level managers stay as nodes; anything above collapses into one "N more managers" node that expands to the full chain. The skip-level manager can itself expand to show the manager's peers.
- **Expansion state is `ExpandedMap`** (`loading | error | empty | done` per id), fetched via `getDirectReports` on chevron click. `empty` is remembered so a flagged manager with no reports isn't refetched. At the payload edge `has_more_reports` decides whether a chevron is drawn; for peers and on-demand children it falls back to `is_manager`, an HR flag that over-reports (11 of 20 flagged vs 8 with reports, measured).
- **Clicking a card** calls `onSelect(id)` and navigates; the chart is keyed on the employee id so expansions, folding and viewport reset per person. Only the chevron expands in place.
- Node size, separation, zoom limits and the card constants (`CARD_WIDTH`, `CARD_HEIGHT`, `LINK_CLEARANCE`, `NODE_SIZE`) are **one coupled set**; changing one alone clips labels or breaks link routing. The view is anchored on the selected card (`SELECTED_Y_FRACTION`) and re-anchored around an expansion so the clicked card doesn't jump.

Other components: `EmployeeProfile` (photo, contact, location as a Maps link, sector tag, "W3 Page", optional "Not you?"), `EmployeeCard` (one person as a tile, with title-term highlighting), `AvatarCircle`, `PeopleRow`, `PhraseChips`, `SuggestionsSection`, and the summary UI: `ResumeSummaryPanel` (loading / loaded / no-resume / error; polls `/summary/progress` each second while busy; owns Regenerate), `AttemptProgress` (one row per attempt), `SummaryBody`, `VerificationBanner` (`ScoreTag` with claim count and an (i) toggletip explaining the score; `VerificationDetails`, an accordion of flagged claims, empty when none; `PASS_SCORE` mirrors the backend's 80).

## Endpoint contract

| Method | Route | Response |
|---|---|---|
| GET | `/api/employees/search?q={term}&title={substr}&limit=50` | `{ results: Employee[], truncated: boolean, total_matched: int }`; at least one of `q`/`title` required (else `422`), `title` min 2 chars, `504` on timeout |
| GET | `/api/employees/{id}` | `Employee` or `404` |
| GET | `/api/employees/{id}/direct-reports` | `{ reports: Employee[] }` |
| GET | `/api/employees/{id}/manager-chain` | `{ chain: Employee[] }` (self → ... → top) |
| GET | `/api/employees/{id}/org-chart?depth=2` | `OrgNode`; `depth` clamped to 1–3 |
| GET | `/api/employees/{id}/summary` | `{ summary: ResumeSummary, resume_url, replaced, attempted_score }`; failures `{ reason, detail }` (`404 no_resume`, `422`, `502`, `503`, `504`) |
| GET | `/api/employees/{id}/summary/progress` | `SummaryProgress` (`status`, `attempt`, `phase`, `scores`, `draft`); `idle` when nothing runs |
| GET | `/api/employees/{id}/suggestions/keywords` | `{ phrases: string[], source: "resume" \| "title" \| "none" }`; failures `{ reason, detail }` like `/summary` |
| POST | `/api/employees/{id}/summary/regenerate` | same as `/summary`; `replaced=false` when the new run scored lower and the old summary was kept |
| GET | `/health` | `200`/`503` on real Bluepages reachability |

## Sensitive data note

The test-tier Bluepages API returns **real IBM employee data** (names, emails, org structure), not synthetic. Don't commit captured responses or fixtures containing real PII; sanitize (fake names/emails) any fixture derived from live queries.
