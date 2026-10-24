// currencyScan.ts — what a scan of the in-game currency window answers across IPC.
// The counts are statements about held items; confirming one writes an ItemCountOverride per
// vocabulary item (an item the window did not list is stated as 0).

export type CurrencyScanResult =
  | { ok: true; counts: Record<string, number>; unmatched: string[] }
  | { ok: false; error: 'eq-window-not-found' | 'not-currency-window' }
