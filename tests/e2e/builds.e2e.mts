/**
 * Headless Electron integration test for THE BUILDS TAB AND OVERLAY (src/shared/builds.ts).
 *
 * The chain only a real app has: build files in `<userData>/builds` → `builds:get` in main (folder
 * read, validation, corpus sources, the active character's dump) → the tab's table and the
 * overlay's list. The comparison itself is unit-tested (tests/builds.test.mts); this spec pins that
 * the pieces meet:
 *
 *   * Larlen's imported build (the committed loadoutlegends page, through the real importer) against
 *     the dev character's committed dump: SHOULDERS is the same item (Pauldrons of Power) and its
 *     row is NOT yellow; FACE differs (Darkbrood Mask vs Polished Mithril Mask) and IS.
 *   * a build cell shows where its item comes from, out of the committed corpus.
 *   * a broken build file is listed with its reason, not skipped.
 *   * a hand-written build matching the dump in two cells (item AND named exaltation) and differing
 *     in one: the summary says 1 of 3, and the overlay, following the tab's selection, lists only
 *     that one. (Against Larlen every cell differs: the build names exaltations the dev character's
 *     sockets do not hold, and a named socket that differs is a difference.)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright-core'
import { buildIfStale, check, countOf, dumpArtifacts, failures, reportRun, settleCount } from './appHarness.mjs'
import { mainWindow, overlayWindow } from './appWindow.mjs'
import { launchOnFixture } from './logFixture.mjs'
import { settleGone } from './settle.mjs'
import { parseLoadoutPage } from '../../scripts/builds/loadoutLegends'

const DUMP = 'Primitive_freeport-Inventory.txt'
const PAGE = join(import.meta.dirname, '..', 'fixtures', 'loadoutlegends-larlen.html')
const URL = 'https://www.loadoutlegends.com/characters/larlen-rivervale?quick=1'

async function answerNotice(page: Page): Promise<void> {
  const notice = '[data-testid="telemetry-notice"]'
  if ((await countOf(page, notice)) === 0) return
  await page.click('[data-testid="telemetry-notice-off"]')
  await settleGone(page, notice, { timeoutMs: 8_000 })
}

/** Write the builds folder the way a user (or the importer) would, into this launch's userData. */
async function stageBuilds(app: ElectronApplication): Promise<void> {
  const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
  const dir = join(userData, 'builds')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'larlen-rivervale.json'), JSON.stringify(parseLoadoutPage(readFileSync(PAGE, 'utf8'), URL)))
  const match = {
    name: 'Match test',
    slots: {
      SHOULDERS: { name: 'Pauldrons of Power' },
      FACE: { name: 'Polished Mithril Mask +3', exaltations: { focus: 'Polished Mithril Mask' } },
      NECK: { name: 'Amulet of the Void' }
    }
  }
  writeFileSync(join(dir, 'match.json'), JSON.stringify(match))
  writeFileSync(join(dir, 'broken.json'), JSON.stringify({ slots: { CHARM: { name: 'Nope' } } }))
}

function rowAttr(page: Page, cell: string): Promise<string | null> {
  return page.getAttribute(`[data-testid="build-row-${cell}"]`, 'data-differs').catch(() => null)
}

async function stepLarlen(page: Page): Promise<void> {
  await page.click('[data-testid="nav-builds"]', { timeout: 60_000 })
  await page.click('[data-testid="builds-reload"]', { timeout: 30_000 })
  const rows = await settleCount(page, '[data-testid^="build-row-"]', 22, { timeoutMs: 20_000 })
  check('the imported build draws one row per cell', rows === 22, `${String(rows)} rows`)
  check('SHOULDERS: same item as worn, row not marked', (await rowAttr(page, 'SHOULDERS')) === 'false')
  check('FACE: a different item, row marked', (await rowAttr(page, 'FACE')) === 'true')
  const faceBg = await page.$eval('[data-testid="build-row-FACE"]', (el) => getComputedStyle(el).backgroundColor)
  check('…and the mark is a visible background', faceBg !== 'rgba(0, 0, 0, 0)' && faceBg !== 'transparent', faceBg)
  const shoulders = (await page.textContent('[data-testid="build-row-SHOULDERS"]')) ?? ''
  check('a cell shows where its item comes from', shoulders.includes('Innoruuk @ Plane of Hate'), shoulders.slice(0, 160))
  const body = (await page.textContent('body')) ?? ''
  check('a broken build file is listed with its reason', body.includes('broken.json') && body.includes('unknown cell "CHARM"'))
}

async function stepMatch(page: Page): Promise<void> {
  await page.click('[data-testid="build-select"]')
  await page.click('li[role="option"]:has-text("Match test")')
  const rows = await settleCount(page, '[data-testid^="build-row-"]', 3, { timeoutMs: 10_000 })
  check('picking another build redraws the table', rows === 3, `${String(rows)} rows`)
  const summary = (await page.textContent('[data-testid="builds-summary"]')) ?? ''
  check('the summary counts only the differing cell', summary === '1 of 3 cells differ', summary)
}

async function stepOverlay(app: ElectronApplication, page: Page): Promise<void> {
  await page.evaluate(() =>
    (window as unknown as { eq: { toggleOverlay: (k: string) => Promise<boolean> } }).eq.toggleOverlay('builds')
  )
  const overlay = await overlayWindow(app, 'builds', 20_000)
  if (overlay === null) {
    check('the builds overlay opens', false)
    return
  }
  const selected = await overlay.$eval('[data-testid="builds-overlay-select"]', (el) => (el as HTMLSelectElement).value)
  check('the overlay is on the tab’s build', selected === 'match', selected)
  const rows = await settleCount(overlay, '[data-testid^="builds-overlay-row-"]', 1, { timeoutMs: 20_000 })
  check('the overlay lists exactly the differing cells', rows === 1, `${String(rows)} rows`)
  check('…which is NECK', (await countOf(overlay, '[data-testid="builds-overlay-row-NECK"]')) === 1)
}

async function main(): Promise<void> {
  buildIfStale()
  console.log('launch: staged log + the dev character’s dump, builds written into userData…')
  const { app, close } = await launchOnFixture('e2e-planner.log', { inventory: DUMP })
  let page: Page | null = null
  try {
    page = await mainWindow(app)
    const consoleErrors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })
    page.on('pageerror', (e) => consoleErrors.push(String(e)))
    await page.waitForSelector('[data-testid="nav-overview"]', { timeout: 60_000 })
    await answerNotice(page)
    await stageBuilds(app)
    await stepLarlen(page)
    await stepMatch(page)
    await stepOverlay(app, page)
    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    if (failures.length) await dumpArtifacts(page, 'builds-FAIL')
  } finally {
    await close()
  }
  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  process.exitCode = 1
})
