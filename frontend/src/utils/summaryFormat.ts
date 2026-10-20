const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Uppercases the first letter of every whitespace-separated word and leaves the rest
 * of each word alone, so "machine learning" becomes "Machine Learning" while "AWS" and
 * "PostgreSQL" keep their casing.
 */
export function capitalizeWords(text: string): string {
  return text.replace(/(^|\s)(\S)/g, (_match, space: string, letter: string) => space + letter.toUpperCase())
}

/** Formats a "YYYY" or "YYYY-MM" resume date as "Mar 2021" or "2021"; anything else is returned as given. */
function formatDate(value: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(value)
  if (!match) return value
  const monthName = MONTH_NAMES[Number(match[2]) - 1]
  return monthName ? `${monthName} ${match[1]}` : value
}

/** Formats a role's date range as "Mar 2021 – Present"; a null end means the role is current. */
export function formatPeriod(start: string, end: string | null): string {
  return `${formatDate(start)} – ${end ? formatDate(end) : 'Present'}`
}
