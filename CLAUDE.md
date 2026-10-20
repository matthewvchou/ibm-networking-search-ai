# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An internal IBM employee-directory / org-chart tool. v1 scope is **Bluepages-backed directory search and org chart browsing** (search, employee profile, direct reports, manager chain), plus one deliberate expansion: an **AI-generated summary of one person's resume** on their profile (see "Resume summaries" below). That summary is strictly per-person. The README's longer-term vision (AI-driven "similar career path" matching between employees) is still out of scope — no embeddings, no cross-person comparison, don't build toward it unless asked.

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

Test tooling (`pytest`, `pytest-asyncio`, `respx`) is in `requirements.txt`. `backend/tests/test_employee_service.py` covers name and search-filter construction as pure functions. The resume-summary tests use `respx` for the resume proxy and ICA, and fake clients for the service's cache/dedupe/prefetch logic; `tests/resume_fixtures.py` builds synthetic PDF and DOCX files in code so no real resume is ever a fixture. Run with `pytest` from `backend/`; the empty `backend/conftest.py` is what puts `app/` on `sys.path` for a bare `pytest` invocation, so don't delete it.

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

### Resume summaries: w3 resume proxy → MarkItDown → ICA

`GET /api/employees/{id}/summary` returns a structured `ResumeSummary` (`app/models/resume_summary.py`): headline, summary, up to 5 `specialties` and 3 `ask_them_about` items each with a short `evidence` pointer, and a `cv` digest (≤8 roles, ≤5 skill groups, education, certifications). It is a separate endpoint so the profile never waits on it. The pipeline, in `ResumeSummaryService`:

1. **Cache** (`TtlLruCache`, 500 entries): a summary lives 24h, a confirmed "no resume" 1h. Keyed on uid only — no file hash, since checking one would mean fetching the file on every hit. **Failures are never cached.** Concurrent requests for one person share a single in-flight task (`asyncio.shield`ed so a navigated-away browser doesn't cancel it).
2. **Fetch** (`ResumeClient`): `https://w3-ui-unified-profile-proxy.w3-ui.dal.app.cirrus.ibm.com/up-api-proxy/v3/resume/{uid}`, no auth, `404` = no resume. Call https directly; http only 302s. It needs **`truststore`** — the host is signed by an internal IBM CA that certifi lacks, so plain httpx fails `CERTIFICATE_VERIFY_FAILED` while curl works.
3. **Convert** (MarkItDown, in a thread, no length cap by decision). **The file is whatever the employee uploaded, not necessarily a PDF**: measured over 80 people, 12 had one — 9 PDF, 2 DOCX, 1 legacy DOC — and one DOCX arrived as `application/octet-stream`, so the format comes from the `content-disposition` filename first. `_resume_format` is an **allowlist** (PDF, DOCX) because MarkItDown does not reject what it can't parse: it falls back to decoding raw bytes as text, which would send a `.doc` to the model as garbage.
4. **ICA** (`IcaClient`): `POST {ICA_BASE_URL}/chat-models/chat/completions`, OpenAI-compatible, bearer `ICA_API_KEY` (a *personal* developer key). `chat-models` rather than the assistant/agent namespaces because those carry hidden instructions. Model `gpt-5.6-luna` (best of four fast models probed). `response_format: json_object` is **accepted but not enforced** — Claude Haiku fenced its JSON regardless, and Granite in JSON mode silently dropped most of the CV — so the reply is always fence-stripped and Pydantic-validated, with one retry. Models emit years as JSON numbers despite the schema, hence `coerce_numbers_to_str`. The resume goes in `<resume>` tags as untrusted data, and the UI renders every field as plain text.
5. **Prefetch**: serving a summary queues the person's manager and direct reports (≤10) in the background. Prefetch is capped at 2 of the 3 ICA slots, so an on-screen request always finds one free; prefetched summaries don't prefetch further.

Errors are `SummaryUnavailableException(reason, message, status)` → `{reason, detail}` from the handler in `main.py`: `no_resume` 404, `unreadable_resume` 422, `bad_output`/`ica_rejected` 502, `ica_timeout` 504, and `not_configured`/`key_invalid`/`not_entitled`/`rate_limited`/`ica_unavailable`/`resume_unavailable` 503. It is deliberately not a `BluepagesUnavailableException`, and `/health` stays Bluepages-only. Validation errors are logged as field paths only, because pydantic's default message quotes resume content.

Measured: cold summaries take **12–22s** end to end with real resumes (the ICA call dominates; input size barely matters — 16k input tokens took 6.8s), cache hits ~5ms. Only ~15% of people have a resume at all.

### Frontend: intentionally minimal test harness, plus one real component

`frontend/src/App.tsx` is a thin **router** (`react-router`, no React Query): `/` renders `AppLayout` (header + `<Outlet/>`), with `SearchPage` at the index and `EmployeeDetailPage` at `/employee/:id`. The search query lives in the URL (`?q=`), and clicking a search row or an org-chart node navigates by id — the detail page always re-fetches rather than carrying an employee object over from the list payload. It's still a thin harness rather than the eventual product structure. `frontend/src/api/client.ts` is a thin typed `fetch` wrapper, one function per backend endpoint, and is the only place that knows the backend's JSON response shapes.

Search results are a **card grid**, not a list: `EmployeeSearchResults.tsx` lays the page's cards out with `grid-template-columns: repeat(auto-fill, minmax(260px, 1fr))`, which is what makes the column count fall out of the available width — 4 on a full desktop, then 3 / 2 / 1 as it narrows — with no media queries and no resize listener. That matters because the app has no stylesheet to put a media query in (`index.css` is five custom properties plus three org-chart rules) and inline styles cannot express one. The 260px floor is paired with `SearchPage.tsx`'s `maxWidth: 1200` wrapper: four tracks plus three 16px gaps is 1088, a fifth would need 1364, so a full desktop lands on exactly 4 — move one of those two numbers and the column count changes. Note Carbon's `Content` adds 2rem of its own padding on top of the page's 24px. The form keeps its own `maxWidth: 700` so the inputs don't stretch the full width. `PAGE_SIZE` is 32 (eight rows of four) against a 50-result response, so a broad search is two pages (32 + 18); the frontend sends no `limit`, and the route would accept up to 100 (`clamped_limit`). The endpoint still returns `truncated` and `total_matched` and `SearchResponse` still types them, but **nothing in the UI reads them** — the "Showing 50 of 374 matches" notice they fed was removed deliberately, so don't wire it back in as a fix for the numbers looking unused.

`EmployeeDetailPage` is two rows: the profile card and `ResumeSummaryPanel` share the top row 2:3 (flex-wrap stacks them when narrow), and the org chart takes the full width below. The panel is keyed on the route id and fetches on its own, so the slow summary call starts alongside the profile fetch rather than after it; `no_resume` renders as a plain "No resume on file", any other reason as a warning with the backend's message.

`frontend/src/components/OrgChart.tsx` is the main piece of real, dedicated UI in the frontend. It renders a single `react-d3-tree` tree combining the ancestor chain (from `getManagerChain`) and the descendant subtree (from `getOrgChart`) into one `RawNodeDatum` tree — there's no in-place expand/collapse state; clicking any node (ancestor or descendant) just calls `onSelect(id)`, which re-runs `App.tsx`'s `selectEmployee` and re-centers the whole view on that person. Nodes at the `has_more_reports` boundary get a dashed accent border as a "click to load more" affordance. If you need to tune layout, `nodeSize`/`separation`/the container's fixed height are the levers — increasing tree depth or org width without adjusting these will clip labels against the container's bottom edge.

## Endpoint contract

| Method | Route | Response |
|---|---|---|
| GET | `/api/employees/search?q={term}&title={substr}&limit=50` | `{ results: Employee[], truncated: boolean, total_matched: int }`; at least one of `q`/`title` required (else `422`), `title` min 2 chars, `504` if the search times out |
| GET | `/api/employees/{id}` | `Employee` or `404` |
| GET | `/api/employees/{id}/direct-reports` | `{ reports: Employee[] }` |
| GET | `/api/employees/{id}/manager-chain` | `{ chain: Employee[] }` (self → ... → top) |
| GET | `/api/employees/{id}/org-chart?depth=2` | `OrgNode` (`{ employee, direct_reports: OrgNode[], has_more_reports }`); `depth` clamped to 1–3 server-side |
| GET | `/api/employees/{id}/summary` | `{ summary: ResumeSummary, resume_url }`; failures are `{ reason, detail }` (`404 no_resume`, `422`, `502`, `503`, `504`) |
| GET | `/health` | `200`/`503` based on real Bluepages reachability |

## Sensitive data note

The test-tier Bluepages API returns **real IBM employee data** (names, emails, real org structure) — it isn't synthetic. Don't commit captured sample responses or fixtures containing this real PII; sanitize (fake names/emails) before checking in any test fixtures derived from live queries.
