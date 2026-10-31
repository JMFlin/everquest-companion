# Motes: currency-window scan and upgrade planner

The player wants to know how many motes and Wind Runes they hold, and the cheapest way to spend
motes on a spell or gear upgrade. The log can't answer the first question: it shows loot, but
never which mote went into an upgrade. The currency window can.

## Modules

| Module | Owns |
|---|---|
| `src/main/currencyScan/captureEqWindow.ts` | The EverQuest window as a PNG (Electron `desktopCapturer`). It runs in main because renderer media permissions are denied. |
| `src/main/currencyScan/index.ts` `readCurrencyWindow` | PNG → `{counts, unmatched}` or `not-currency-window`. It fingerprints the `Name / Expansion / Quantity` header, then runs a name-column OCR pass and a binarized digit-only quantity pass. Names are matched against the closed vocabulary in `vocabulary.ts`. tesseract.js runs in-process with the bundled `resources/ocr/eng.traineddata`, read through a read-only cache path; nothing is fetched. PNG handling is pure TS (`png.ts`, `raster.ts`), with no native deps. |
| `src/main/ipc/currency.ts` | `currency:scan` (capture + read). A scan that reads every row is saved at once: **every** vocabulary item becomes an `ItemCountOverride` dated now, and an item the window did not list is stated as 0. A scan with an unreadable row saves nothing. `currency:getStatements` serves the statements to the overlay. Auto rescan (`currency:getAutoRescan` / `setAutoRescan`, persisted as `autoRescan`, off by default) rescans as soon as it is ticked, then captures the game every 45 s (both surfaces count down to the next one), and runs OCR only on captures where a saved header fingerprint matches by pixels (`showsCurrencyWindow`, about 0.5 s). A save pushes `currency:autoRescanChanged` to both surfaces, which then show "Counts updated". The background check needs one manual scan first, because that scan saves the fingerprint. |
| `src/shared/planner/motes.ts` | `planMotes`: the public planner API and the spell plan. |
| `src/shared/planner/moteXp.ts` | The `MOTES` catalog (eqlwiki Mote_Guide values) and the XP curve. |
| `src/shared/planner/moteGearSearch.ts` | The gear search: which motes go on the piece and on each spare copy. |
| `src/renderer/src/features/motes/` | The Motes tab. `heldMotes` (statement + loot since − destroyed since) and `usePlanner` (rank picks, banked progress, spare copies) are shared with the overlay, and so is `useAutoRescan`, the auto-rescan checkbox state. Both surfaces draw a gear plan with spare copies as blocks per copy (`stepGroups` in `motes.ts`): condensing, each levelled spare, then the main item with its merges. Runes are scanned and saved for the Sky tracker but not shown. |
| `src/renderer/src/overlay/MotesOverlay.tsx` | The `motes` overlay kind: Scan, the auto-rescan checkbox, held motes and the same planner on top of the game, in plain divs. |

## Why it is shaped this way

- **No engine module or view.** A scan is a hand statement, so `reconcile` already does
  "count at `setAt`, loot after it adds, destroys and turn-ins subtract". The engine's parity
  goldens also reject new fold modules.
- **The seam is the PNG buffer.** Capture needs a live game. Reading is golden-tested on
  `tests/fixtures/currency-window.png`, which must read 24 of 24 rows.
- **One shared mote pool.** When both a spell and a gear target are picked, gear is planned first
  with an exact tier-capped DP. It applies motes in ascending cap order and spends the least
  spell-equivalent value. Condensing is off by default; a top-level checkbox next to Auto rescan lets the plan condense,
  and then only to unlock a cap. The spell then takes what is left,
  largest-first. Spell XP values are powers of two, so greedy filling is exact.
- **Gear takes spare copies and banked progress.** The gear picker also accepts XP already banked
  at the current tier (default 0) and spare copies of the same item. A +t copy merges in for 2^t
  XP (eqlwiki Gear Merge Experience) with no tier cap, so copies are merged after every capped
  mote. They cost no mote, so they are used first. A spare can also take motes before it merges:
  levelling a +0 copy reopens the low-cap windows the piece has outgrown. All copies are planned
  together, so cheap low-cap motes spread over many copies (one Infinitesimal per +0 copy) rather
  than piling onto one. The search is exact while each step stays under a fixed state budget;
  with many copies (up to 19) past it, it keeps the most promising states, about 1 s worst case.
  At equal value it spends lower-tier motes and keeps the higher ones.
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
- Window skins other than the default are untested. A scan with any unreadable row is not saved,
  so a misread row never becomes a stored 0.
- `motes` is fork-only in the telemetry enums. The upstream ingest Lambda refuses batches that
  carry it.
