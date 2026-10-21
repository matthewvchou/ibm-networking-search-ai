const STORAGE_PREFIX = 'ibm-directory-suggestion-phrases:'

// localStorage throws in some privacy modes, so every access is guarded. Without it the
// edits just last until the page is reloaded.

/** The phrases the person edited down to, or null when they have never edited their list. */
export function readSavedPhrases(employeeId: string): string[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + employeeId)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return null
    return value.filter((phrase): phrase is string => typeof phrase === 'string')
  } catch {
    return null
  }
}

export function writeSavedPhrases(employeeId: string, phrases: string[]): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + employeeId, JSON.stringify(phrases))
  } catch {
    // Not remembered across visits.
  }
}

export function clearSavedPhrases(employeeId: string): void {
  try {
    localStorage.removeItem(STORAGE_PREFIX + employeeId)
  } catch {
    // Nothing stored that could be left behind.
  }
}
