# Motes: currency-window scan and upgrade planner

The player wants to know how many motes and Wind Runes they hold, and the cheapest way to spend
motes on a spell or gear upgrade. The log can't answer the first question: it shows loot, but
never which mote went into an upgrade. The currency window can.

## Modules

| Module | Owns |
|---|---|
| `src/main/currencyScan/captureEqWindow.ts` | The EverQuest window as a PNG (Electron `desktopCapturer`). It runs in main because renderer media permissions are denied. |
| `src/main/currencyScan/index.ts` `readCurrencyWindow` | PNG → `{counts, unmatched}` or `not-currency-window`. It fingerprints the `Name / Expansion / Quantity` header, then runs a name-column OCR pass and a binarized digit-only quantity pass. Names are matched against the closed vocabulary in `vocabulary.ts`. tesseract.js runs in-process with the bundled `resources/ocr/eng.traineddata`, read through a read-only cache path; nothing is fetched. PNG handling is pure TS (`png.ts`, `raster.ts`), with no native deps. |
| `src/main/ipc/currency.ts` | `currency:scan` (capture + read) and `currency:applyScan`. Applying a scan states **every** vocabulary item as an `ItemCountOverride` dated now, and an item the window did not list is stated as 0. |
| `src/shared/planner/motes.ts` | The `MOTES` catalog (eqlwiki Mote_Guide values) and `planMotes`. |
| `src/renderer/src/features/motes/` | The Motes tab: held counts from `reconcile`, scan preview and confirm, and two rank pickers. |
| `src/renderer/src/overlay/MotesOverlay.tsx` | The `motes` overlay kind: Scan, preview and Confirm on top of the game. |

## Why it is shaped this way

- **No engine module or view.** A scan is a hand statement, so `reconcile` already does
  "count at `setAt`, loot after it adds, destroys and turn-ins subtract". The engine's parity
  goldens also reject new fold modules.
- **The seam is the PNG buffer.** Capture needs a live game. Reading is golden-tested on
  `tests/fixtures/currency-window.png`, which must read 24 of 24 rows.
- **One shared mote pool.** When both a spell and a gear target are picked, gear is planned first
  with an exact tier-capped DP. It applies motes in ascending cap order, condenses only to unlock
  a cap, and spends the least spell-equivalent value. The spell then takes what is left,
  largest-first. Spell XP values are powers of two, so greedy filling is exact.
- **Gear takes spare copies and banked progress.** The gear picker also accepts XP already banked
  at the current tier (default 0) and spare copies of the same item. A +t copy merges in for 2^t
  XP (eqlwiki Gear Merge Experience) with no tier cap, so copies are merged after every capped
  mote. They cost no mote, so they are used first.
- **Game rules the owner confirmed:**
  - XP past rank or tier 10 is impossible.
  - Two motes of tier n condense into one of tier n+1.
  - The currency window shows every row, so one capture is enough.

## Known limits

- The log never names the mote used in an upgrade, so held counts drift down silently. The UI
  says to rescan after upgrading.
- **Screen and UI size.** The goldens are 9–12 px text: a laptop screenshot, a live capture with a
  selected row, and a background PrintWindow capture. Larger UIs are covered by rescaled goldens:
  - at 1.5x, 2x and 1.75x they must read 24/24;
  - at 0.8x, 1.5x and 2.5x (selected-row cases) they may leave one row unreadable but never read a
    wrong number.
  How each step handles size:
  - digit cells are sized by the measured row pitch, and the vote upscales shrink as pitch grows;
  - names under 14 px are read enlarged;
  - one fingerprint is kept per UI size (up to 4), and the newest is also searched at 0.6–2.5x
    (~1 s), so switching screens skips the ~20 s OCR header search.
  Text much smaller than the laptop's 9 px is not supported: the OCR header search does not find it.
- Window skins other than the default are untested. The preview step catches misreads before
  anything is stored.
- `motes` is fork-only in the telemetry enums. The upstream ingest Lambda refuses batches that
  carry it.
