// shared/uiLayouts.ts — saved EverQuest UI layouts (fork feature, see FORK.md).
//
// EverQuest keeps one window layout per character in `<eqRoot>\UI_<Char>_<server>.ini`, with
// pixel widths and heights, so a layout made on a big monitor does not fit a laptop screen. A
// saved layout is a named copy of every `UI_*.ini` in the install folder; applying one copies
// them back. EverQuest rewrites these files when you camp or quit, so both operations are
// refused while it is running.

/** One saved layout, as the Preferences card lists it. */
export interface UiLayout {
  name: string
  /** Epoch ms of the save. */
  savedAt: number
  /** The `UI_*.ini` file names the layout holds. */
  files: string[]
}

/** Every answer from the ui-layouts channels: the current list, plus why the operation failed. */
export interface UiLayoutsResult {
  layouts: UiLayout[]
  error?: string
}

export const UI_LAYOUT_NAME_MAX = 32

/** `UI_<anything>.ini`, the files EverQuest stores window layouts in. */
export function isUiLayoutFile(fileName: string): boolean {
  return /^UI_.+\.ini$/i.test(fileName)
}

/**
 * The layout name, trimmed, or null when it cannot be a folder name. The name becomes a directory
 * under userData, so it is limited to letters, digits, spaces, `_` and `-`.
 */
export function normalizeUiLayoutName(name: unknown): string | null {
  if (typeof name !== 'string') return null
  const trimmed = name.trim()
  if (trimmed.length === 0 || trimmed.length > UI_LAYOUT_NAME_MAX) return null
  return /^[A-Za-z0-9 _-]+$/.test(trimmed) ? trimmed : null
}
