import type { Employee } from '../api/client'

export const MAX_PEOPLE_PER_PHRASE = 10
export const MAX_ROW_PEOPLE = 60
// Searches run this many at a time. Also the unit the row is interleaved in.
export const SEARCH_BATCH_SIZE = 4

/** Round-robin across lists: every list's first item, then every list's second, and so on. */
export function interleave<T>(lists: T[][]): T[] {
  const merged: T[] = []
  const longest = Math.max(0, ...lists.map((list) => list.length))
  for (let index = 0; index < longest; index++) {
    for (const list of lists) {
      if (index < list.length) merged.push(list[index])
    }
  }
  return merged
}

/**
 * Returns `order` extended with the people in a finished batch of searches.
 *
 * The batch is interleaved so its first screen mixes phrases. Anyone already in `order`
 * (matched by another phrase) and the person themselves are skipped, and `order` itself is
 * never reordered: a card the user can see must not move while they scroll.
 */
export function appendBatch(order: string[], batch: Employee[][], excludeId: string): string[] {
  const seen = new Set([...order, excludeId])
  const added: string[] = []
  for (const person of interleave(batch)) {
    if (seen.has(person.id)) continue
    seen.add(person.id)
    added.push(person.id)
  }
  return added.length === 0 ? order : [...order, ...added]
}
