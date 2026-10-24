// currencyScan.ts — what a scan of the in-game currency window answers across IPC.
// A fully read scan is saved as an ItemCountOverride per vocabulary item (an item the window did
// not list is stated as 0).

export type CurrencyScanResult =
  // `zeroed`: vocabulary items the window did not list (saved as 0). `saved`: false when a row
  // was unreadable, so nothing was stored.
  | { ok: true; counts: Record<string, number>; unmatched: string[]; zeroed: string[]; saved: boolean }
  | { ok: false; error: CurrencyScanError }

export type CurrencyScanError = 'eq-window-not-found' | 'eq-minimized' | 'not-currency-window' | 'cancelled'

/**
 * Background rescans: on/off, when one last saved counts (null = not this session), and when the
 * next one starts (null while off). Times are epoch ms.
 */
export interface AutoRescanState {
  enabled: boolean
  updatedAt: number | null
  nextAt: number | null
}
