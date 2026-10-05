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
