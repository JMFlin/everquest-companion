import { test } from 'node:test'
import assert from 'node:assert/strict'
import { skyRecipes } from '../src/renderer/src/features/builds/farmRecipes'
import { skyDroppersFor } from '../src/renderer/src/features/posky/poskyDroppers'
import type { QuestProgress } from '../src/renderer/src/features/posky/useProgress'

const item = (name: string, who: string[], where: string, held: number) => ({
  name,
  who,
  where,
  droppers: skyDroppersFor(name, who),
  need: 1,
  have: Math.min(held, 1),
  held
})

test("sky recipes: Ton Po's Shoulder Wraps takes a Silken Wrap from the Bazzt Zzzt and a random-drop rune", () => {
  const quest = {
    name: 'Monk Test of Tears',
    reward: "Ton Po's Shoulder Wraps",
    items: [
      item('Silken Wrap', ['BZ'], 'Island 6', 2),
      item('Wind Rune Beza', ['random drop — any Plane of Sky mob'], 'Plane of Sky', 0)
    ]
  } as unknown as QuestProgress
  const recipe = skyRecipes([quest]).get("ton po's shoulder wraps")
  assert.equal(recipe?.quest, 'Monk Test of Tears')
  const [wrap, rune] = recipe?.components ?? []
  assert.deepEqual([wrap.item, wrap.count, wrap.held, wrap.zone], ['Silken Wrap', 1, 2, 'The Plane of Sky'])
  assert.deepEqual(wrap.mobs, ['Bazzt Zzzt (Island 6)', 'Bzzazzt (Island 6)'])
  assert.deepEqual(rune.mobs, ['any Plane of Sky mob'])
})
