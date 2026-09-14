export interface Employee {
  id: string
  display_name: string
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
