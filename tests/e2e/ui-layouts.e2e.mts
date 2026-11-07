/**
 * Headless Electron test for SAVED UI LAYOUTS (fork, src/shared/uiLayouts.ts): through the real
 * Preferences card, save the staged install's UI_*.ini as "Big monitor", change the file on disk,
 * apply the layout, and read the file back.
 *
 * Run: `npm run test:e2e -- ui-layouts`
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { buildIfStale, check, countOf, dumpArtifacts, failures, reportRun, settleGone } from './appHarness.mjs'
import { settle } from './settle.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture, stageFixture } from './logFixture.mjs'
import { openPrefs } from './prefsFirstPaintSteps.mjs'

const ROW = '[data-testid="ui-layouts-row"]'

async function dismissFirstRunNotice(page: Page): Promise<void> {
  const notice = '[data-testid="telemetry-notice"]'
  await page.waitForSelector(notice, { timeout: 30_000 }).catch(() => undefined)
  if ((await countOf(page, notice)) === 0) return
  await page.click('[data-testid="telemetry-notice-off"]')
  await settleGone(page, notice, { timeoutMs: 8_000 })
}

async function main(): Promise<void> {
  buildIfStale()
  const log = stageFixture('e2e-telemetry.log')
  const ui = join(log.installDir, 'UI_Primitive_freeport.ini')
  writeFileSync(ui, 'big monitor layout')
  const app = await launchOnFixture(log)
  try {
    const page = await mainWindow(app.app)
    await dismissFirstRunNotice(page)
    await openPrefs(page)
    await page.waitForSelector('[data-testid="ui-layouts"]', { timeout: 20_000 })

    await page.fill('[data-testid="ui-layouts-name"]', 'Big monitor')
    await page.click('[data-testid="ui-layouts-save"]')
    const rows = await settle(() => countOf(page, ROW), (n) => n === 1)
    check('saving lists the layout', rows === 1, String(rows))

    writeFileSync(ui, 'laptop layout')
    await page.click(`${ROW} button:has-text("Apply")`)
    const restored = await settle(
      () => Promise.resolve(readFileSync(ui, 'utf8')),
      (s) => s === 'big monitor layout'
    )
    check('applying copies the saved file back into the install folder', restored === 'big monitor layout', restored)
    if (failures.length) await dumpArtifacts(page, 'ui-layouts-FAIL')
  } finally {
    await app.close()
    await log.dispose()
  }
  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  process.exitCode = 1
})
