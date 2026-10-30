# Gear builds (Builds tab + overlay)

A **build** is a saved loadout, one item per equipment cell plus the exaltations socketed in it.
The Builds tab compares the selected build cell by cell against what the active character wears
(their newest `/outputfile inventory` dump) and shows where each build piece comes from. The
Builds overlay shows only the cells that still differ.

## Modules

| Module | Owns |
|---|---|
| [`src/shared/builds.ts`](../../src/shared/builds.ts) | The build file format and its one validator (`parseBuildFile`), the worn cells read off a dump (`wornCells`), the comparison (`compareBuild`), source lines. Pure, node-tested. |
| [`src/main/ipc/builds.ts`](../../src/main/ipc/builds.ts) | `builds:get`: reads `<userData>/builds/*.json`, validates each file, resolves every named item's source from the committed corpus, adds the active character's worn cells. |
| [`src/renderer/src/features/builds/`](../../src/renderer/src/features/builds/) | `useBuilds` (payload + selection, shared with the overlay) and the tab. |
| [`src/renderer/src/overlay/BuildsOverlay.tsx`](../../src/renderer/src/overlay/BuildsOverlay.tsx) | The overlay: differing cells only. |
| [`scripts/import-build.mts`](../../scripts/import-build.mts) over [`scripts/builds/loadoutLegends.ts`](../../scripts/builds/loadoutLegends.ts) | Imports a loadoutlegends.com character page as a build file. |

Data flow: build files + dump → `builds:get` → `useBuilds` → `compareBuild` → tab / overlay.

## Decisions

- **One JSON file per build, in a folder.** Not the retired `ProgressState.gearSets` (JOS-325):
  builds must be editable outside the app (by hand or by an agent), they are not tied to one
  character, and the app-owned store would clobber external edits.
- **Cells are the planner's `PlanSlotId`.** loadoutlegends slot indexes follow the client's
  equipment order: Charm (0) and Power (21) are the dump's two `Any Slot` rows (`ANY1`, `ANY2`).
  Worn cells use the planner's own assignment (`equippedEntries`), so both sides agree on which
  ring is `FINGER2`.
- **A cell differs when the item differs**, by base name, case-insensitively. `+N` is never
  compared and build files do not carry it.
- **Exaltations compare by socket kind**: dump child slot 7 focus, 8 click, 9 worn, 10 proc.
  Only the kinds a build names are compared.
- **Sources are not stored in build files.** Main resolves them from the committed corpus on
  every read, so a corpus correction reaches every build. An item the corpus lacks shows
  "source unknown".
- **The importer is a script, not an in-app fetch.** loadoutlegends.com is third party; its
  parser is pinned to a saved page (`tests/fixtures/loadoutlegends-larlen.html`) and throws on
  any shape it does not recognise.
- **No cache, no file watcher.** The tab and overlay re-read on open, on Reload, on a dump
  re-read and (overlay) on a character switch.

## Build file format

```json
{
  "name": "Larlen (WIZ/BRD/ENC)",
  "url": "https://www.loadoutlegends.com/characters/larlen-rivervale",
  "slots": {
    "FACE": { "name": "Darkbrood Mask", "exaltations": { "focus": "Polished Mithril Mask", "click": "Guise of the Deceiver" } },
    "ANY2": { "name": "Nargon's Staff" }
  }
}
```

`name` defaults to the file name; `url` is optional. Cells: `HEAD FACE EAR EAR2 NECK SHOULDERS
BACK CHEST ARMS WRIST WRIST2 HANDS FINGER FINGER2 WAIST LEGS FEET PRIMARY SECONDARY RANGE AMMO
ANY1 ANY2`. Exaltation kinds: `focus click worn proc`. A file that fails validation is listed in
the tab with the reason.
