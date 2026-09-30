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

interface SearchResponse {
  results: Employee[]
  truncated: boolean
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
    throw new Error(`request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export function searchEmployees(query: string, signal?: AbortSignal): Promise<SearchResponse> {
  return get<SearchResponse>(`/api/employees/search?q=${encodeURIComponent(query)}`, signal)
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
