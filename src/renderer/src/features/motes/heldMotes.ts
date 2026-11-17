// heldMotes — how many of each mote you hold, for the Motes tab and the motes overlay alike.
// A currency with a statement (every scan states both families) counts from it: the stated count, plus what
// the log shows looted after it, less what it shows destroyed after it. A mote never stated counts
// from the whole log. Hand-ins (condensing at the Constructed Potential) are not subtracted; the
// next scan states the truth again.

import type { LootEvent } from '@shared/types'
import type { ItemCountOverride } from '@shared/itemOverrides'
import { itemOverrideInstants } from '@shared/itemOverrides'
import { UPGRADE_CURRENCIES, type UpgradeCurrencyName } from '@shared/planner/motes'
import { computeDestroyedAfterPerKey, computeHeldCounts, computeHeldCountsAfterPerKey } from '../posky/heldCounts'

export function heldMotes(
  loot: readonly LootEvent[],
  statements: readonly ItemCountOverride[]
): Record<UpgradeCurrencyName, number> {
  const since = itemOverrideInstants(statements)
  const lootedAfter = computeHeldCountsAfterPerKey(loot, since)
  const destroyedAfter = computeDestroyedAfterPerKey(loot, since)
  const fromLog = computeHeldCounts(loot)
  const held = {} as Record<UpgradeCurrencyName, number>
  for (const { name } of UPGRADE_CURRENCIES) {
    const key = name.toLowerCase()
    const stated = statements.find((s) => s.key === key)
    held[name] = stated
      ? Math.max(0, stated.count + (lootedAfter[key] ?? 0) - (destroyedAfter[key] ?? 0))
      : (fromLog[key] ?? 0)
  }
  return held
}
