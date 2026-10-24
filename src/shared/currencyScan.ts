// currencyScan.ts — what a scan of the in-game currency window answers across IPC.
// The counts are statements about held items; confirming one writes an ItemCountOverride per
// vocabulary item (an item the window did not list is stated as 0).

export type CurrencyScanResult =
  // `zeroed`: vocabulary items the window did not list — a confirm states them as 0.
  | { ok: true; counts: Record<string, number>; unmatched: string[]; zeroed: string[] }
  | { ok: false; error: CurrencyScanError }

export type CurrencyScanError = 'eq-window-not-found' | 'not-currency-window' | 'cancelled'
