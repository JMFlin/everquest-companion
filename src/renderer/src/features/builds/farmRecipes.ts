// farmRecipes: the Plane of Sky quests as Farm view recipes. A Sky reward has no drop row in the
// item database, so without this the Farm view had nothing to say about it; the turn-in items
// one copy takes, how many of each you hold, and who drops them are the tracker's own progress.
// Relative imports: node-tested (tests/farmRecipes.test.mts), outside the renderer bundler alias.

import { itemNameKey } from '../../../../shared/builds'
import type { QuestRecipe } from '../../../../shared/buildFarm'
import { zonePlace } from '../../../../shared/zones'
import { SKY_ZONE, islandOf, isRandomDropWho } from '../posky/poskyDroppers'
import type { QuestProgress } from '../posky/useProgress'

/** Who to kill for one turn-in item: its droppers on their island, else "any Plane of Sky mob". */
function mobsFor(it: QuestProgress['items'][number]): string[] {
  const island = islandOf(it.where)
  if (it.droppers.length > 0) return it.droppers.map((d) => (island === undefined ? d.name : `${d.name} (${island})`))
  return isRandomDropWho(it.who) ? [`any ${SKY_ZONE} mob`] : []
}

/** Reward `itemNameKey` -> the quest that gives it. */
export function skyRecipes(quests: readonly QuestProgress[]): Map<string, QuestRecipe> {
  const zone = zonePlace(SKY_ZONE)
  const out = new Map<string, QuestRecipe>()
  for (const q of quests) {
    if (q.reward === undefined) continue
    out.set(itemNameKey(q.reward), {
      quest: q.name,
      components: q.items.map((it) => ({ item: it.name, count: it.need, held: it.held, zone, mobs: mobsFor(it) }))
    })
  }
  return out
}
