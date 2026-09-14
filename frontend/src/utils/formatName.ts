/** Bluepages NAME field is "Last, First" — reformat for display as "First Last". */
export function formatDisplayName(displayName: string): string {
  const commaIndex = displayName.indexOf(',')
  if (commaIndex === -1) return displayName

  const last = displayName.slice(0, commaIndex).trim()
  const first = displayName.slice(commaIndex + 1).trim()
  if (!last || !first) return displayName

  return `${first} ${last}`
}
