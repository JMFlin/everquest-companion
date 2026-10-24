// heldMotes — how many of each mote you hold, for the Motes tab and the motes overlay alike.
// A mote with a statement (every scan states all ten) counts from it: the stated count, plus what
// the log shows looted after it, less what it shows destroyed after it. A mote never stated counts
// from the whole log. Hand-ins (condensing at the Constructed Potential) are not subtracted; the
// next scan states the truth again.

import type { LootEvent } from '@shared/types'
import type { ItemCountOverride } from '@shared/itemOverrides'
import { itemOverrideInstants } from '@shared/itemOverrides'
import { MOTES, type MoteName } from '@shared/planner/motes'
import { computeDestroyedAfterPerKey, computeHeldCounts, computeHeldCountsAfterPerKey } from '../posky/heldCounts'

export function heldMotes(
  loot: readonly LootEvent[],
  statements: readonly ItemCountOverride[]
): Record<MoteName, number> {
  const since = itemOverrideInstants(statements)
  const lootedAfter = computeHeldCountsAfterPerKey(loot, since)
  const destroyedAfter = computeDestroyedAfterPerKey(loot, since)
  const fromLog = computeHeldCounts(loot)
  const held = {} as Record<MoteName, number>
  for (const { name } of MOTES) {
    const key = name.toLowerCase()
    const stated = statements.find((s) => s.key === key)
    held[name] = stated
      ? Math.max(0, stated.count + (lootedAfter[key] ?? 0) - (destroyedAfter[key] ?? 0))
      : (fromLog[key] ?? 0)
  }
  return held
}
