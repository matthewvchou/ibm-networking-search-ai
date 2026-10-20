export interface Employee {
  id: string
  // Always "First Last". `last_name` carries the surname on its own, for sorting -
  // it can't be recovered from display_name (multi-word surnames exist).
  display_name: string
  last_name: string
  email: string | null
  title: string | null
  department: string | null
  location: string | null
  // ISO alpha-2 (hrcountrycode). The search card's location tag ends in this; `location`
  // is the full country name the profile falls back to.
  country_code: string | null
  manager_id: string | null
  // WSAPI's MGR flag. True for people who manage someone, so the org chart can show
  // an expand chevron only where there is something to expand. Always false on the
  // search endpoint, which reads SLAPHAPI.
  is_manager: boolean
  photo_url: string | null
  office_phone: string | null
  mobile_phone: string | null
  address: string | null
  org_unit: string | null
  city: string | null
  state: string | null
  building: string | null
  // Only populated by the enriched single-employee endpoint; `department` is the raw code.
  employee_type: string | null
  company: string | null
  department_name: string | null
}

export interface SearchResponse {
  results: Employee[]
  truncated: boolean
  // Match count before the server truncated to `limit`. A broad job-title filter
  // collapses thousands of people into an arbitrary page, so the UI reports
  // "50 of 4,109" rather than a bare "truncated".
  total_matched: number
}

export interface SearchFilters {
  // Substring match against the directory's job-title field. Sparse - only about a
  // quarter of records carry one - so the UI says so next to the input.
  title?: string
}

interface DirectReportsResponse {
  reports: Employee[]
}

interface ManagerChainResponse {
  chain: Employee[]
}

export interface OrgNode {
  employee: Employee
  direct_reports: OrgNode[]
  has_more_reports: boolean
}

// An AI-generated digest of the employee's resume. Every field may be empty - a sparse
// resume yields empty fields, not invented ones. `evidence` points back into the resume
// ("Cloud Architect, 2021-present") so a reader can check the claim.
export interface ResumeSummary {
  headline: string
  summary: string
  specialties: { name: string; evidence: string }[]
  ask_them_about: { topic: string; evidence: string }[]
  cv: {
    // Most recent first; `end` null means the current role.
    experience: { role: string; organization: string; start: string | null; end: string | null }[]
    skills: { category: string; items: string[] }[]
    education: { degree: string; institution: string; year: string | null }[]
    certifications: { name: string; year: string | null }[]
  }
}

export interface ResumeSummaryResponse {
  summary: ResumeSummary
  resume_url: string
}

/**
 * A summary request that failed, carrying the backend's machine-readable `reason`
 * ("no_resume", "ica_timeout", ...) alongside a message fit to show the user.
 */
export class SummaryError extends Error {
  readonly reason: string

  constructor(reason: string, message: string) {
    super(message)
    this.reason = reason
  }
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal })
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error('not-found')
    }
    if (res.status === 503) {
      throw new Error('unavailable')
    }
    if (res.status === 504) {
      throw new Error('timeout')
    }
    // 422 was unreachable before filters existed; now it carries the reason a search
    // was rejected, so surface the backend's message instead of a bare status code.
    const detail = await res
      .json()
      .then((body: { detail?: string }) => body.detail)
      .catch(() => undefined)
    throw new Error(detail ?? `request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export function searchEmployees(
  query: string,
  filters: SearchFilters = {},
  signal?: AbortSignal,
): Promise<SearchResponse> {
  // Only set values are sent, so a name-only search produces the same request it
  // always did.
  const params = new URLSearchParams()
  if (query.trim()) params.set('q', query.trim())
  if (filters.title?.trim()) params.set('title', filters.title.trim())
  return get<SearchResponse>(`/api/employees/search?${params.toString()}`, signal)
}

export function getEmployee(id: string): Promise<Employee> {
  return get<Employee>(`/api/employees/${encodeURIComponent(id)}`)
}

export function getDirectReports(id: string): Promise<DirectReportsResponse> {
  return get<DirectReportsResponse>(`/api/employees/${encodeURIComponent(id)}/direct-reports`)
}

export function getManagerChain(id: string): Promise<ManagerChainResponse> {
  return get<ManagerChainResponse>(`/api/employees/${encodeURIComponent(id)}/manager-chain`)
}

export function getOrgChart(id: string, depth = 2): Promise<OrgNode> {
  return get<OrgNode>(`/api/employees/${encodeURIComponent(id)}/org-chart?depth=${depth}`)
}

/**
 * Fetches the employee's resume summary. Slow on a cold cache (~10s, an LLM call).
 *
 * Doesn't go through `get`: every failure here carries a `reason` the panel needs in
 * order to tell "no resume on file" from an outage, so all of them throw SummaryError.
 */
export async function getSummary(id: string, signal?: AbortSignal): Promise<ResumeSummaryResponse> {
  const res = await fetch(`/api/employees/${encodeURIComponent(id)}/summary`, { signal })
  if (res.ok) return res.json() as Promise<ResumeSummaryResponse>
  const body = await res
    .json()
    .then((b: { reason?: string; detail?: string }) => b)
    .catch(() => ({}) as { reason?: string; detail?: string })
  throw new SummaryError(body.reason ?? 'unknown', body.detail ?? `Request failed: ${res.status}`)
}
