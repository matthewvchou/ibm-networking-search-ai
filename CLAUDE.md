# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An internal IBM employee-directory / org-chart tool. v1 scope is **Bluepages-backed directory search and org chart browsing** (search, employee profile, direct reports, manager chain), plus one deliberate expansion: an **AI-generated summary of one person's resume** on their profile (see "Resume summaries" below). That summary is strictly per-person. The frontend is a Carbon-based app with a light/dark theme; `ChatPanel.tsx` exists as a "Chat is not available yet" placeholder but is **not rendered anywhere** and no assistant backend exists. The README's longer-term vision (AI-driven "similar career path" matching between employees) is still out of scope — no embeddings, no cross-person comparison, don't build toward it unless asked.

Monorepo: `backend/` (Python/FastAPI) + `frontend/` (Vite/React/TypeScript). One repo, not two — the two halves are built in lockstep by a single developer.

## Commands

### Both halves at once (Windows)
```
start.bat         # repo root
```
Creates `backend/.venv` and installs requirements on first run, runs `npm install` if `frontend/node_modules` is missing, copies `backend/.env.example` to `backend/.env` if there is no `.env`, then opens the backend (`:8000`) and the Vite dev server (`:5180`) in two windows and launches the browser. It deliberately starts uvicorn **without** `--reload` (see the Windows note below). It is a launcher, not a bundle: Python 3 and Node must be on PATH.

### Backend (`backend/`)
```
python -m venv .venv
.venv/Scripts/activate        # Windows; source .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
Interactive API docs at `http://localhost:8000/docs` once running — the fastest way to manually exercise an endpoint.

Test tooling (`pytest`, `pytest-asyncio`, `respx`) is in `requirements.txt`. `backend/tests/test_employee_service.py` covers name and search-filter construction as pure functions. The resume-summary tests use `respx` for the resume proxy and ICA, and fake clients for the service's cache/dedupe/prefetch logic; `tests/resume_fixtures.py` builds synthetic PDF and DOCX files in code so no real resume is ever a fixture. Run with `pytest` from `backend/`; the empty `backend/conftest.py` is what puts `app/` on `sys.path` for a bare `pytest` invocation, so don't delete it.

Note: on Windows, `uvicorn --reload` has been flaky when many files change at once (reload fires but doesn't actually swap in the new app, so stale routes 404). If endpoints seem to not reflect recent code changes, stop the process and restart uvicorn without `--reload` to confirm, rather than assuming the code is wrong.

### Frontend (`frontend/`)
```
npm install
npm run dev       # Vite dev server on :5180 (strictPort: fails rather than picking another port)
npm run build      # tsc -b && vite build
npm run lint       # oxlint
```
The Vite dev server proxies `/api/*` to `http://localhost:8000` (see `vite.config.ts`), so the backend must be running for the frontend to work locally.

`react-d3-tree` is a real dependency (used by `OrgChart.tsx`, see below) — confirmed compatible with this repo's React 19 (peer range `16.x || 17.x || 18.x || 19.x`), no `--legacy-peer-deps` needed.

## Architecture

### Backend: Bluepages HTTP client, not LDAP

Despite "LDAP" being the original assumption, IBM's Bluepages directory is exposed as a **plain-text HTTP GET API**, not raw LDAP — there's no `ldap3` and no bind anywhere in this codebase. WSAPI access goes through `app/services/bluepages_client.py`, which calls `GET {base_url}/wsapi?{method}={value}` and parses the plain-text response. The second API, SLAPHAPI (`app/services/slaphapi_client.py`), is JSON over HTTP GET but does take a real **LDAP filter expression** in the URL, so filter escaping matters there — see the search section below.

Wire format specifics (load-bearing — get these wrong and parsing silently breaks):
- Records are `KEY: value` lines with **no blank-line separator** between records.
- A new record always starts exactly at a line beginning with `CNUM:`.
- A trailer line follows the records with no blank line before it: `# rc=0, count=N, message=Success` (or e.g. `# rc=904, message=Invalid request specified` for a malformed request). `rc != 0` is treated as a directory error, not a legitimately-empty result.

Bluepages methods used (passed as the `method` argument to `BluepagesClient.query`):
- `byCnum` — get one record by ID (**not** `bySerial`, which uses a different, incompatible ID scheme)
- `directReportsOf` — direct reports of a manager ID
- `managerChainFor` — chain of managers **above** a given ID; it excludes the employee itself and starts at their direct manager, so `EmployeeService.get_manager_chain` prepends the employee to match the documented "self → ... → top" contract.

Field/ID scheme: `CNUM` (unique employee ID, e.g. `005469897`) is `EMPNUM`+`EMPCC`. `MNUM` (manager reference, e.g. `6D9496897`) is `MGRNUM`+`MGRCC` — a plain ID string directly usable as input to `directReportsOf`/`managerChainFor`, not a DN. Other fields: `NAME` ("Last, First" — see the name-normalization note below), `DEPT`, `JOBRESPONSIB` (title), `INTERNET` (email), `COUNTRY`/`WORKLOC` (location), `MGR` (Y/N).

Work location is displayed as **one** thing, not two. `Employee.location` is the friendly *country* name (`co`/`COUNTRY`) despite the name; `city`, `state` and `address` all come from a single `ibmworklocation` lookup (`_place_from_work_location` extracts `l`/`st`; `st` is the full name, "North Carolina", and is legitimately empty for countries without states), and `building` comes free off the `ibmperson` record. `_format_address_slaphapi` deliberately builds a **purely postal** address with no `Building NNN` prefix, because that string's only jobs are to be a Google Maps query and a hover title, and an internal building number degrades Google's geocoding — the building name is shown via `Employee.building` instead. **The city is always followed by the state.** The profile card renders `City, State` as a Maps hyperlink (`EmployeeProfile.tsx`) and search cards render `City, ST, CC` as a single `Tag`. The search card ends in `Employee.country_code` — the ISO alpha-2 code straight off `hrcountrycode`, populated on 322/322 records measured — and **not** `location`, because the friendly name is both long and inconsistent for one country: the US arrives as "United States of America" (170) *and* "United States" (51), and the UK as "United Kingdom" (46) *and* "N.Ireland & England & Scotland & Wales (United Kingdom)" (6). `location` keeps the friendly name, which is what the profile falls back to when a person has no city. Both join on `.filter(Boolean)` so a missing state leaves no empty segment (a UK record reads "Hursley, GB", a city-less one just "NZ"), both fall back to the country alone when there is no city, and the profile falls back to plain text when there is no address to point Maps at.

Name search runs on **SLAPHAPI**, not WSAPI `allByNameFuzzy`. `_compose_filter` assembles the filter from one predicate per criterion in a fixed order (`hractive` → name → title); `_name_predicate` contributes `(|(sn=q*)(givenname=q*))`, so surname and first name are equally first-class — the old WSAPI path matched surnames only for a bare word ("Laura" found people *surnamed* Laura) and reached first names solely through a `"query %"` wildcard quirk. A multi-token query tries both orders, so "Laura Smith" and "Smith, Laura" resolve to the same person; the token pair is sorted only to keep the filter string canonical.

Two hard-won constraints live in that filter, and removing either one hurts:
- **A one- or two-character query matches exactly, not by prefix.** SLAPHAPI enforces no server-side size limit, and short prefixes are ruinous: `(sn=a*)` measured **108MB** before timing out and `(sn=ma*)` ~66MB, while three characters lands at 2–12MB. Truncation to `limit` is therefore client-side and happens *after* the whole payload is parsed. Search gets its own longer `slaphapi_search_timeout_seconds` (10s) because a legitimately broad 3-char prefix can take most of 5s.
- **Values are escaped (RFC 4515) before interpolation** — `_LDAP_FILTER_ESCAPES`. Search is the only place a user-supplied string reaches a filter expression; the WSAPI client never needed this.

**Job title search** (`title=` on the search endpoint) adds `_title_predicate`, matching `jobresponsibilities` as a substring. Three things about it are load-bearing:

- **The field is sparse.** Measured across live slices: 14%, 17%, 32%, 36% of records carry a `jobresponsibilities` value — call it a quarter. `title` and `description` on `ibmperson` are **0% populated** and are dead ends; don't reach for them. The UI says so next to the input, because a title search silently cannot see most people. (SLAPHAPI's arbitrary result order happens to cluster populated records early, so the first page can look 100% populated while the full match set is a third — don't infer the rate from a page.)
- **One assertion per token, ANDed** — `(&(jobresponsibilities=*senior*)(jobresponsibilities=*architect*))`, not `(jobresponsibilities=*senior architect*)`. The tokens may be separated by other words and given in either order; measured, the AND form matched 133 records where the single-phrase form matched 18. Repeated assertions on one attribute are valid here (verified, not assumed).
- **`TITLE_SUBSTRING_MIN_LENGTH = 2`, and only the 1-char case is actually dangerous.** Per token: `*a*` took 29s and `*e*` 29.6s — already past the 10s search budget — while `*vp*` (0.8s), `*ux*` (0.8s) and `*ai*` (1.5s) are cheap, and short real titles exist ("C#", "VP", "UX", "C++"). Note the floor bounds nothing beyond that: a substring doesn't narrow as it lengthens the way a prefix does, and `*Manager*` is 7 characters and still 16.9MB/6.7s. A broad title can legitimately time out — hence the 504 below.

A search **requires a name or a job title**; the router answers `422` otherwise. There is deliberately no "match everything" search: a bare `(&(hractive=A))` is the whole active directory, measured at 154MB+ without completing. `_compose_filter` returns `None` for that case and `EmployeeService.search` returns empty, as defence in depth behind the router's check.

**Non-person records are excluded from every people-facing path.** The live `ibmemployeetype` table (the one `_resolve_employee_type` reads) has 17 codes, and exactly two are titled "non-Person": `N` "Functional Id" — a shared group/service account, e.g. a helpdesk — and `Q` "Entry owned by specific Application". `_NON_PERSON_EMPLOYEE_TYPES` in `employee_service.py` is that pair and should stay narrow: the neighbouring codes are all people, including the *non-IBM-employee* ones (`B` business partner, `C` contractor, `V` vendor, `G` IP partner, `H` non-integrated business such as Red Hat), so widening the set hides real colleagues.

Three things about this are load-bearing:
- **Search never needed the filter; the org chart did.** Non-person records carry no `hractive` attribute at all, so the existing `(&(hractive=A)…)` already excluded them — verified, `(&(hractive=A)(uid=C-X8YF897))` returns `count: 0`, and no `N`/`Q` record anywhere carries `hractive=A`. The path that actually leaked them into the UI was the WSAPI org chart, where `directReportsOf` takes no filter expression, so the exclusion has to happen client-side after parsing. `search` applies it anyway as defence in depth, but it is a measured no-op — **don't add a conjunct to `_compose_filter` for this**, it would rewrite a dozen exact-filter-string tests for nothing.
- **The exclusion lives inside `get_direct_reports`, not at its call sites.** `_build_org_node` derives `has_more_reports` from whatever that method returns, so filtering there is what makes a manager whose only remaining reports were functional IDs a real leaf, instead of a node offering a "click to load more" affordance that expands into nothing.
- **Match on the code, not the name marker.** These records also label themselves in the name (`"ISV Recaptcha *FUNCTIONAL-ID*"`, `"XForceExchange *APPLICATION-ID*"`), but the marker is redundant: measured live, no record carries the marker without the code or the code without the marker. Those are also the only two non-person markers — sweeping for any `*MARKER*` turns up exactly five, and `*CONTRACTOR*`, `*VENDOR*` and `*PARTNER*` are people, so a name-based rule invites exactly the wrong generalization.

`get_by_id` and `get_enriched_by_id` return `None` for these records, so a direct hit on `/api/employees/C-X8YF897` is a **404** — the same answer as a bad ID, which keeps the frontend's existing `'not-found'` state as the only thing it needs to render. `get_enriched_by_id` checks before its five concurrent label lookups, so a non-person costs one request rather than six. Note the test tier additionally carries ~25% `entrytype=test` junk records; those are deliberately *not* filtered, since they won't exist in production and the rule would become dead code on a tier swap.

Also load-bearing for SLAPHAPI queries generally: **the attribute list is `&`-delimited, not comma-delimited.** `byjson?cn&sn` works; `byjson?cn,sn` answers with an empty `attribute` array and `code: 0` — a silent empty parse, not an error — which is why a comma-separated list once looked like proof that projection was impossible. It isn't: projecting shrinks a response roughly 9x (`(sn=ma*)` is 33MB/15s at `*` and 3.6MB/2.2s projected). **The code still requests `*` everywhere** — adopting projection is a deliberate separate change, and it is the real fix for the job-title tail latency noted above.

**Every filter is percent-encoded before it reaches the URL** (`_SAFE_FILTER_CHARS` in `slaphapi_client.py`), which matters now that a free-text job title reaches a filter. Raw values break the URL in two ways that are easy to miss: `+` is decoded back to a space server-side (a search for `C++` answered 14 where the correct answer is 16), and `#` truncates the URL as a fragment, so SLAPHAPI never sees the trailing `/byjson` and replies in the wrong format. The `safe=` set keeps the filter's own grammar (`()&|=!*,`) intact so only values are escaped. This is a separate layer from the RFC 4515 escaping above — both are needed.

Names are normalized in the backend, and `display_name` is **"First Last" on every endpoint**. The frontend renders it verbatim; there is deliberately no display-time reformatting. `_wsapi_name` splits WSAPI `NAME` ("Last, First" — reliably one comma, surname first) and `_slaphapi_name` composes `preferredfirstname`/`givenname` + `preferredlastname`/`sn`. **Never derive a name from `cn`, and never reorder a name on a comma** — that was a real bug: `cn` is usually "First Last", but ~1–2% of live records carry a stray comma in first-then-last order (`cn="Jinkwang, Kim"` where `sn=Kim`), which is indistinguishable from the "Last, First" format, so a comma-triggered swap rendered exactly those records surname-first. `preferred*` wins over `sn`/`givenname` because `givenname` is sometimes multi-valued (`["Huan", "Huan B"]`) where `preferred*` is not, and `SlaphapiClient` keeps `value[0]` arbitrarily. `Employee.last_name` carries the surname separately because it cannot be recovered from the display name (real records have multi-word surnames, e.g. `sn="Nguyen Duc"`) and the search results table sorts on it.

`app/services/employee_service.py` is the only place that maps raw Bluepages field dicts to the `Employee` Pydantic model (`app/models/employee.py`) — routers never touch raw Bluepages records directly.

`EmployeeService.get_org_chart` recursively builds an `OrgNode` tree (`{ employee, direct_reports: OrgNode[], has_more_reports: bool }`) by calling `get_direct_reports` at each level. Depth is capped server-side (clamped to 1–3 in the router) — nodes at the depth boundary that still have reports get `has_more_reports=True` instead of being expanded further, so the frontend can show them as expandable rather than silently truncating. Recursive fan-out uses `asyncio.gather` bounded by an `asyncio.Semaphore` (`_ORG_CHART_CONCURRENCY = 16` in `employee_service.py`) — sibling subtrees are fetched concurrently, not sequentially, which matters a lot once an org is more than ~1-2 people wide (a fully sequential version of this was measured at 18s+ for a ~144-person org; concurrent is ~8s for the same query).

`BluepagesClient` holds one reused `httpx.AsyncClient` for the lifetime of the instance rather than creating a new client (and paying a fresh TCP/TLS handshake) per call — this was a real, measured bottleneck once org-chart requests started firing many concurrent Bluepages calls. Keep reusing that shared client for any new methods added to `bluepages_client.py`; don't reintroduce a per-call `async with httpx.AsyncClient(...)`.

Currently pointed at the **unauthenticated test tier** (`bluepagestst.cpc.ibm.com`, set via `Settings.bluepages_base_url` in `app/core/config.py`, `.env`-overridable). Production host/auth is unknown and deliberately deferred; swapping tiers should stay a config change, not a code change. There is no application-level auth in v1 by design — see decisions in the plan file if one exists under `.claude/plans/`.

Caching is deliberately absent in v1 with **two narrow exceptions**, both process-lifetime maps of immutable reference data with no personal data in them. (A third, separate cache — resume summaries, which *are* personal data — is bounded and expiring; see "Resume summaries" below.) First, `EmployeeService._place_cache` memoizes `workLoc → (city, state)` for the process lifetime. Search needs both per row, WSAPI person records only carry the office *code*, and a result page usually spans far fewer distinct offices than people — so `_attach_places` resolves each distinct code once (concurrently, bounded by `_CITY_LOOKUP_CONCURRENCY`) and remembers it. Office locations are immutable reference data with no personal data in them. **Only successes are cached** (keyed on a resolved city, so an office with no state still caches) — storing a miss from a transient directory outage would poison every later search touching that office. Don't widen this into a general response cache without revisiting the decision.

Second, `_org_unit_cache` memoizes `hrOrganizationCode -> sector` for the same reason: the search card shows the sector ("Consulting") in place of the raw `dept` code ("BDO", "870361"), which means nothing to a reader. `_attach_org_units` resolves it from `ibmorganization.hrorganizationdisplay` in **one batched OR filter** over the page's uncached codes, not one request per code — a 50-row page spans ~41 distinct codes measured, so a fan-out would roughly triple a search's request count, while the batch answers all of them in ~0.7s. It needs no chunking because the page is capped at `search_max_results`, which bounds the filter to ~1.2KB. The whole table is only 584 rows collapsing to 70 display values, so a few searches warm the cache and later pages resolve for free. Note `hrgroupid` looks like a tidier sector (10 values) but is **not** usable: it holds `F&O`, `GF`, `CHQ/OTH`, i.e. exactly the codes this change exists to remove. `Employee.org_unit` is therefore the one resolved label populated on the search endpoint as well as the profile.

`BluepagesUnavailableException` (`app/core/exceptions.py`) is raised on `httpx` errors or a non-zero `rc`, and is mapped to a `503` by the exception handler registered in `app/main.py` — this is the only place a directory outage should surface as an HTTP status.

`DirectoryTimeoutException` subclasses it and is raised specifically on `httpx.TimeoutException`, mapped to **`504`**. The distinction exists because a broad job-title substring can time out *legitimately*, and reporting that as 503 told the user the directory was down when it wasn't. It stays a subclass so `_lookup`'s `except BluepagesUnavailableException` keeps degrading a failed label lookup to "no label". Starlette picks a handler by walking the exception's MRO, so the more specific handler wins regardless of registration order.

### Profile photos: a separate w3 service, not Bluepages

**Photos are not in the directory.** `ibmperson` carries no photo attribute at all — `?*&+`
(every populated *and* operational attribute) returns 75 names, none of them photo-related, and
explicit requests for `jpegphoto`/`photo`/`thumbnailphoto`/`photourl`/`hasphoto`/`picture` each
answer `"attribute": []` with `code: 0`. The documentation agrees: the IBMPERSON schema's only
binary attributes are `notesPublicKey`, `userCertificate` and `userPassword`, "photo" appears
once as a generic example in the Base64 rule, and the adverb set is closed
(`bytext|byldif|byxml|bydsml|byjson|byhtml`) — there is no `byphoto`. Don't re-probe this.

They come from `https://w3-unified-profile-api.ibm.com/v3/image/{CNUM}` instead, which needs
**no auth**, also accepts an email, and sends `cache-control: max-age=86400` so the browser
holds a photo for a day. `frontend/src/api/photos.ts` is the only place that knows this URL;
the backend is not involved and `Employee.photo_url` is deliberately left unused, because the
URL derives from the employee id the frontend already has. Measured coverage is ~92% (37 of 40
live `(&(hractive=A)(sn=smit*))` records).

Two things about the URL are load-bearing:
- **`?s=N` is a real server-side resize**, and the source is a 400x400 square, so the response
  is exactly NxN (`s=48` is 995B against 21KB unsized). Callers request twice their rendered
  box for HiDPI. Without it a 10-row result page would pull ~200KB of full-size JPEG.
- **`?def=none` is what makes the initials fallback possible.** By default an employee with no
  photo gets a grey silhouette at `200 image/jpeg`, and no header distinguishes it from a real
  photo, so "has a photo" is undecidable without comparing bytes. `def=none` answers `404`
  instead, which is the `<img onError>` hook. It is implemented but *undocumented* — the
  service's own validation message lists only `avatar|init|blue|null`, and every unrecognised
  value (`xyz`, `404`, `nil`, even `NONE`) is a `400` — so if it is ever tightened the symptom
  is a grey silhouette where initials belong, not an error. (`def=init` is not an alternative:
  it returns an empty blue circle, no initials.)

`AvatarCircle.tsx` is the circular avatar — photo over an initials circle, which shows through
on a 404 — and is shared by the search rows and the org-chart nodes (it owns `initialsOf`,
which used to live in `OrgChart.tsx`). The profile card does **not** use it: it renders the
square uncropped, and shows nothing at all when there is no photo. Node avatars are pinned at
28px because `CARD_HEIGHT`/`LINK_CLEARANCE`/`NODE_SIZE` are one coupled set of constants. Don't
set `crossOrigin` on these images: a plain `<img>` needs no CORS, and the service answers with
`access-control-allow-credentials: true` plus a specific origin, which `"anonymous"` would break.

### Resume summaries: w3 resume proxy → MarkItDown → ICA writer → ICA grader

`GET /api/employees/{id}/summary` returns a `ResumeSummary` (`app/models/resume_summary.py`): a 2-sentence `summary`, then `skills` (≤5 groups), `experience` (≤8 roles), `education`, `certifications`, and a `verification` (below). There is no headline, specialties or "ask them about" any more, and no `cv` wrapper. It is a separate endpoint so the profile never waits on it. The pipeline:

1. **Cache** (`TtlLruCache`, 500 entries): a summary lives 24h, a confirmed "no resume" 1h. Keyed on uid only. **Failures are never cached**, but an *ungraded* summary (grader failed) is. Concurrent requests for one person share a single in-flight task (`asyncio.shield`ed so a navigated-away browser doesn't cancel it).
2. **Fetch** (`ResumeClient`): `https://w3-ui-unified-profile-proxy.w3-ui.dal.app.cirrus.ibm.com/up-api-proxy/v3/resume/{uid}`, no auth, `404` = no resume. Call https directly; http only 302s. It needs **`truststore`** — the host is signed by an internal IBM CA that certifi lacks.
3. **Convert** (MarkItDown, in a thread, no length cap by decision). **The file is whatever the employee uploaded, not necessarily a PDF**: measured over 80 people, 12 had one — 9 PDF, 2 DOCX, 1 legacy DOC — and one DOCX arrived as `application/octet-stream`, so the format comes from the `content-disposition` filename first. `_resume_format` is an **allowlist** (PDF, DOCX) because MarkItDown does not reject what it can't parse.
4. **Write** (`SummaryGenerator`, model `gpt-6-luna` via `ICA_MODEL`): two calls **in parallel** — a prose call (the 2 sentences) and an extraction call (the structured lists, copied not composed). `POST {ICA_BASE_URL}/chat-models/chat/completions`, OpenAI-compatible, bearer `ICA_API_KEY` (a personal developer key); `chat-models` because the assistant/agent namespaces carry hidden instructions. `response_format: json_object` is accepted but **not enforced** (Claude Haiku fences its JSON), so every reply is fence-stripped and Pydantic-validated, with one retry that is separate from the grading loop. Models emit years as JSON numbers, hence `coerce_numbers_to_str`. The resume goes in `<resume>` tags as untrusted data and the UI renders every field as plain text.
5. **Grade** (`SummaryVerifier`, model `claude-haiku-5-5` via `ICA_VERIFIER_MODEL` — deliberately a different vendor from the writer). Code lists every structured claim (each skill, role, employer, dates, degree, institution, certification) and accepts those whose text it finds in the normalized resume. Haiku judges only the *unmatched* ones plus the atomic claims of the 2 summary sentences, and must back every "supported" verdict with a verbatim quote that **code then looks for in the resume** (case/whitespace/punctuation-insensitive, ≥8 chars); a quote that isn't there, or a missing id, counts as unsupported. **The score is `round(100 × supported / total)` computed in code**, never a number the model wrote, with equal weight per claim; it is `null` when there is nothing to check. Quotes stay on the server and are never logged. The prompt is adversarial on purpose (inference, generalization, "contributed"→"led", merged facts and shifted dates are all unsupported). One retry on an invalid reply; a second failure is a grader failure.
6. **Loop**: pass mark `VERIFICATION_PASS_SCORE = 80`, `MAX_ATTEMPTS = 4` (one cold attempt + three regenerations), in `summary_generator.py`. Below 80 the **prose only** is rewritten with the rejected summary claims as feedback; the extraction is reused. Structured items the grader rejected are **dropped** from the output (and flagged `removed`), and still count against the score of later attempts so dropping isn't a way to score higher. More than 3 drops re-runs the extraction. The best-scoring attempt is returned, not the last. **A grader failure never fails the summary**: it ends the loop and returns the best graded attempt, or the draft with `verification: null` ("Not verified"). Writer concurrency is `_ICA_CONCURRENCY = 4` (two calls per attempt), the grader has its own pool of 3.
7. **Progress and regeneration**: `GET .../summary/progress` reads an in-memory `ProgressBoard` (attempt, phase, per-attempt scores, and the first ungraded draft so the panel can show it at ~15s). The frontend polls it once a second while `/summary` is pending. `POST .../summary/regenerate` bypasses the cache with a fresh 4-attempt budget and replaces the cached summary only if the new score is **no lower**; the response carries `replaced` and `attempted_score`. Concurrent regenerations share one run.
8. **Prefetch**: serving a summary queues the person's manager and direct reports (≤20) in the background, running the same full grade loop. Prefetch is capped at 2 of the 4 writer slots so an on-screen request always finds two free; it publishes no drafts, and prefetched summaries don't prefetch further.

Errors are `SummaryUnavailableException(reason, message, status)` → `{reason, detail}` from the handler in `main.py`: `no_resume` 404, `unreadable_resume` 422, `bad_output`/`ica_rejected` 502, `ica_timeout` 504, and `not_configured`/`key_invalid`/`not_entitled`/`rate_limited`/`ica_unavailable`/`resume_unavailable` 503. It is deliberately not a `BluepagesUnavailableException`, and `/health` stays Bluepages-only. Validation errors are logged as field paths only, because pydantic's default message quotes resume content.

Measured on synthetic resumes only: `gpt-6-luna` returns valid unfenced JSON for both schemas (2–3s warm, ~9s cold); a planted-errors summary scored 33 and every planted error was flagged; a clean full loop took ~19s. **Not measured: a worst-case 4-attempt run on a real, long resume**, which is estimated at 100s+ and rides on one blocking `GET` — if a browser or proxy cuts it, move generation behind a `POST` and poll. The model catalog is `GET {ICA_BASE_URL}/chat-models/models`. Only ~15% of people have a resume at all.

### Frontend: Carbon UI, router, no data-fetching library

`frontend/src/App.tsx` is a **router** (`react-router`, no React Query) wrapped in `ColorThemeProvider`: `/` renders `AppLayout` (Carbon `Theme` + `AppHeader` + `<Outlet/>` + `ThemeToggleButton`), with `SearchPage` at the index, `EmployeeDetailPage` at `/employee/:id`, and `NotFoundPage` as the catch-all. The search state lives in the URL (`?q=` for name, `?title=` for job title), and clicking a search card or an org-chart node navigates by id — the detail page always re-fetches rather than carrying an employee object over from the list payload, and it carries the whole search string through so the filters survive a trip into a profile and back. `AppHeader` shows a compact search box on every page except `/`, and a "Back to search" link on profiles.

Theming: Carbon `g10` (light) / `g100` (dark), chosen by `theme/ColorTheme.tsx` from `localStorage` (`ibm-directory-theme`, every access guarded because it throws in some privacy modes), else `prefers-color-scheme`. The zone class goes on `<html>` as well as the `Theme` wrapper so the page background and portalled elements match. Carbon styles are pulled in by `styles/carbon.scss`; `index.css` maps Carbon tokens to `--accent`/`--bg`/`--border`/`--text`/`--text-h`, which the inline-styled components read.

`frontend/src/api/client.ts` is a thin typed `fetch` wrapper, one function per backend endpoint, and is the only place that knows the backend's JSON response shapes.

Search results are a **card grid**, not a list: `EmployeeSearchResults.tsx` lays the page's cards out with `grid-template-columns: repeat(auto-fill, minmax(260px, 1fr))`, which is what makes the column count fall out of the available width — 4 on a full desktop, then 3 / 2 / 1 as it narrows — with no media queries and no resize listener. That matters because the components are styled inline and inline styles cannot express a media query; `index.css` holds only the token aliases plus the few rules that need a real selector (the profile sector tag, the org-chart link colour and spinner). The 260px floor is paired with `SearchPage.tsx`'s `maxWidth: 1200` wrapper: four tracks plus three 16px gaps is 1088, a fifth would need 1364, so a full desktop lands on exactly 4 — move one of those two numbers and the column count changes. Note Carbon's `Content` adds 2rem of its own padding on top of the page's 24px. The form keeps its own `maxWidth: 700` so the inputs don't stretch the full width. `PAGE_SIZE` is 32 (eight rows of four) against a 50-result response, so a broad search is two pages (32 + 18); the frontend sends no `limit`, and the route would accept up to 100 (`clamped_limit`). The endpoint still returns `truncated` and `total_matched` and `SearchResponse` still types them, but **nothing in the UI reads them** — the "Showing 50 of 374 matches" notice they fed was removed deliberately, so don't wire it back in as a fix for the numbers looking unused.

`EmployeeDetailPage` is two rows: the profile card and `ResumeSummaryPanel` share the top row 2:3 (flex-wrap stacks them when narrow), and the org chart takes the full width below. The panel is keyed on the route id and fetches on its own, so the slow summary call starts alongside the profile fetch rather than after it; `no_resume` renders as a plain "No resume on file", any other reason as a warning with the backend's message.

`EmployeeDetailPage` fetches the profile (`getEmployee`), manager chain and a **depth-1** org chart in parallel, then fetches the direct manager's reports (`getDirectReports`) as the "peers" row. A failed peer lookup is swallowed on purpose: it costs the peer row, not the page. The profile's manager comes from `managerChain[1]` (index 0 is the person).

`frontend/src/components/OrgChart.tsx` (the largest component) renders one `react-d3-tree` tree built by `buildTreeData` from four sources: the person (`orgNodeToRaw`), their reports, their peers, and the manager chain above them. Layout rules that are easy to break:
- **Peers are leaves**, laid out by `rowAround` around the selected person (others sorted by surname, split either side so the spine stays centred). A peer's reports load only when its chevron is clicked; don't rebuild the row from `getOrgChart`.
- **The manager chain folds**: the direct manager and skip-level manager stay as nodes and anything above collapses into one "N more managers" node that expands to the full chain. The skip-level manager can itself be expanded to show the manager's peers.
- **Expansion state is `ExpandedMap`** (`loading | error | empty | done` per employee id), fetched via `getDirectReports` on chevron click. `empty` is remembered so a flagged manager with no reports isn't refetched. At the payload edge `has_more_reports` decides whether a chevron is drawn; for peers and on-demand children it falls back to `is_manager`, which is an HR flag and over-reports (11 of 20 flagged vs 8 with reports on the org measured).
- **Clicking a card** calls `onSelect(id)`, which navigates to that person's page; the chart is keyed on the employee id, so expansions, folding and viewport reset per person. Only the chevron expands in place.
- Node size, separation, zoom limits and the card constants (`CARD_WIDTH`, `CARD_HEIGHT`, `LINK_CLEARANCE`, `NODE_SIZE`) are one coupled set; changing one without the others clips labels or breaks link routing. The view is anchored on the selected card (`SELECTED_Y_FRACTION`) and re-anchored around an expansion so the card you clicked doesn't jump.

The remaining components are `EmployeeProfile` (photo, contact, location as a Maps link, sector tag), `EmployeeSearchResults` + `AvatarCircle` (card grid), and the summary UI: `ResumeSummaryPanel` (state machine: loading / loaded / no-resume / error, polls `/summary/progress` once a second while busy, owns the regenerate button), `AttemptProgress` (one row per attempt), `SummaryBody`, and `VerificationBanner` (score tag and flagged claims, `PASS_SCORE` mirrors the backend's 80).

## Endpoint contract

| Method | Route | Response |
|---|---|---|
| GET | `/api/employees/search?q={term}&title={substr}&limit=50` | `{ results: Employee[], truncated: boolean, total_matched: int }`; at least one of `q`/`title` required (else `422`), `title` min 2 chars, `504` if the search times out |
| GET | `/api/employees/{id}` | `Employee` or `404` |
| GET | `/api/employees/{id}/direct-reports` | `{ reports: Employee[] }` |
| GET | `/api/employees/{id}/manager-chain` | `{ chain: Employee[] }` (self → ... → top) |
| GET | `/api/employees/{id}/org-chart?depth=2` | `OrgNode` (`{ employee, direct_reports: OrgNode[], has_more_reports }`); `depth` clamped to 1–3 server-side |
| GET | `/api/employees/{id}/summary` | `{ summary: ResumeSummary, resume_url, replaced, attempted_score }`; failures are `{ reason, detail }` (`404 no_resume`, `422`, `502`, `503`, `504`) |
| GET | `/api/employees/{id}/summary/progress` | `SummaryProgress` (`status`, `attempt`, `phase`, `scores`, `draft`); `idle` when nothing is running |
| POST | `/api/employees/{id}/summary/regenerate` | same as `/summary`; `replaced=false` when the new run scored lower and the old summary was kept |
| GET | `/health` | `200`/`503` based on real Bluepages reachability |

## Sensitive data note

The test-tier Bluepages API returns **real IBM employee data** (names, emails, real org structure) — it isn't synthetic. Don't commit captured sample responses or fixtures containing this real PII; sanitize (fake names/emails) before checking in any test fixtures derived from live queries.
