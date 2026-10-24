// merge.ts — several captures of one currency window (game window, Chromium window, screen) are
// independent reads of the same list; where one misreads a row, another usually doesn't.

export interface WindowRead {
  readonly counts: Record<string, number>
  readonly unmatched: readonly string[]
}

export interface MergedRead {
  counts: Record<string, number>
  /** Rows no capture resolved, and items the captures disagree on. Empty when `complete`. */
  unmatched: string[]
  complete: boolean
}

/**
 * An item is kept only when every capture that read it agrees on its count. The merge is
 * complete when some capture's unreadable rows are all covered by items the others read (a ghost
 * row one capture invents does not block a capture that saw the window cleanly), and nothing
 * conflicts.
 */
export function mergeReads(reads: readonly WindowRead[]): MergedRead {
  const values = new Map<string, Set<number>>()
  for (const r of reads) {
    for (const [name, n] of Object.entries(r.counts)) values.set(name, (values.get(name) ?? new Set()).add(n))
  }
  const counts: Record<string, number> = {}
  const conflicts: string[] = []
  for (const [name, seen] of values) {
    if (seen.size === 1) counts[name] = [...seen][0]
    else conflicts.push(`${name}: ${[...seen].join(' vs ')}`)
  }
  const covered = (r: WindowRead): boolean =>
    Object.keys(counts).filter((name) => !(name in r.counts)).length >= r.unmatched.length
  const complete = conflicts.length === 0 && reads.some(covered)
  const unmatched = complete ? [] : [...conflicts, ...(reads.at(-1)?.unmatched ?? [])]
  return { counts, unmatched, complete }
}
