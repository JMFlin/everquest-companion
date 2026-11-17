import assert from 'node:assert/strict'
import type { Page } from 'playwright-core'
import { UPGRADE_CURRENCIES } from '../../src/shared/planner/motes'
import { buildIfStale, settle } from './appHarness.mjs'
import { mainWindow, overlayWindow } from './appWindow.mjs'
import { launchOnFixture } from './logFixture.mjs'

interface CurrencyBridge {
  setItemOverride: (key: string, name: string, count: number) => Promise<unknown>
  toggleOverlay: (kind: string) => Promise<boolean>
}

async function pick(page: Page, selector: string): Promise<void> {
  const picker = page.locator(selector)
  for (const rank of ['0', '5']) await picker.getByRole('button', { name: rank, exact: true }).evaluate((b) => (b as HTMLElement).click())
}

async function plansUseFragments(page: Page, prefix: string): Promise<void> {
  await pick(page, `[data-testid="${prefix}-pick-spell"]`)
  const spell = await settle(() => page.locator('body').innerText(), (t) => t.includes('Apply 1× Major fragment'))
  assert.ok(spell.includes('Apply 1× Major fragment'), spell)
  await pick(page, `[data-testid="${prefix}-pick-gear"]`)
  const text = await settle(() => page.locator('body').innerText(), (t) => t.includes('Apply 4× Major fragment'))
  assert.ok(text.includes('Apply 4× Major fragment'), text)
  assert.ok(text.includes('Other fragment gear XP is unverified'), text)
}

await buildIfStale()
const { app, close } = await launchOnFixture('e2e-leveling.log')
try {
  const page = await mainWindow(app)
  await page.evaluate(async (currencies) => {
    const eq = (window as unknown as { eq: CurrencyBridge }).eq
    for (const { name } of currencies) await eq.setItemOverride(name.toLowerCase(), name, name === 'Fragment of Major Potential' ? 6 : 0)
  }, UPGRADE_CURRENCIES)
  await page.locator('[data-testid="nav-motes"]').evaluate((b) => (b as HTMLElement).click())
  assert.equal(await settle(() => page.getByTestId('motes-fragments-4').innerText(), (t) => t === '6'), '6')
  await plansUseFragments(page, 'motes')
  await page.evaluate(() => (window as unknown as { eq: CurrencyBridge }).eq.toggleOverlay('motes'))
  const overlay = await overlayWindow(app, 'motes')
  assert.ok(overlay, 'motes overlay opens')
  assert.equal(await settle(() => overlay.getByTestId('motes-overlay-fragments-4').innerText(), (t) => t === '6'), '6')
  await plansUseFragments(overlay, 'motes-overlay')
  console.log('Mote fragments: counts and mixed plans pass on tab and overlay.')
} finally {
  await close()
}
