// usePlanner — the upgrade planner's state and plan, shared by the Motes tab (MUI) and the motes
// overlay (plain divs): rank picks for a spell and a gear piece, the gear's banked progress,
// spare copies and whether to condense. Each surface only draws it.

import { useMemo, useState } from 'react'
import { planMotes } from '@shared/planner/motes'
import type { MoteName, MotePlan, Selection, Step } from '@shared/planner/motes'

export interface RankPick {
  sel?: Selection
  pending: number | null
}

export const RANKS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

/** First click picks the current rank, the second the goal; a click at or below `from` restarts. */
function nextPick(pick: RankPick, n: number): RankPick {
  if (pick.pending !== null && n > pick.pending) return { sel: { from: pick.pending, to: n }, pending: null }
  if (n === 10) return { sel: pick.sel, pending: null }
  return { pending: n }
}

export interface Planner {
  spell: RankPick
  gear: RankPick
  /** XP already banked at the spell's current rank (0 unless set). */
  spellFraction: number
  /** XP already banked at the gear's current tier (0 unless set). */
  fraction: number
  spares: number[]
  /** Whether the gear plan may condense motes (off unless ticked). */
  condense: boolean
  plan: MotePlan
  pickSpell: (n: number) => void
  pickGear: (n: number) => void
  setSpellFraction: (fraction: number) => void
  setFraction: (fraction: number) => void
  setSpares: (spares: number[]) => void
  setCondense: (condense: boolean) => void
}

export function usePlanner(held: Partial<Record<MoteName, number>>): Planner {
  const [spell, setSpell] = useState<RankPick>({ pending: null })
  const [gear, setGear] = useState<RankPick>({ pending: null })
  // Banked XP belongs to the rank/tier it was entered for; picking a new current one resets it to 0.
  const [spellFraction, setSpellFraction] = useState(0)
  const [fraction, setFraction] = useState(0)
  const [spares, setSpares] = useState<number[]>([])
  const [condense, setCondense] = useState(false)
  const plan = useMemo(
    () =>
      planMotes(held, {
        spell: spell.sel ? { ...spell.sel, fraction: spellFraction } : undefined,
        gear: gear.sel ? { ...gear.sel, fraction, spares, condense } : undefined
      }),
    [held, spell, gear, spellFraction, fraction, spares, condense]
  )
  return {
    spell,
    gear,
    spellFraction,
    fraction,
    spares,
    condense,
    plan,
    pickSpell: (n) => {
      const next = nextPick(spell, n)
      if ((next.sel?.from ?? next.pending) !== (spell.sel?.from ?? spell.pending)) setSpellFraction(0)
      setSpell(next)
    },
    setSpellFraction,
    pickGear: (n) => {
      const next = nextPick(gear, n)
      if ((next.sel?.from ?? next.pending) !== (gear.sel?.from ?? gear.pending)) setFraction(0)
      setGear(next)
    },
    setFraction,
    setSpares,
    setCondense
  }
}

/** Whether rank `n` is lit in a picker: inside the chosen range, or the pending first click. */
export function inPick(pick: RankPick, n: number): boolean {
  return pick.sel ? n >= pick.sel.from && n <= pick.sel.to : pick.pending === n
}

export function pickLabel(pick: RankPick): string {
  if (pick.sel) return `${pick.sel.from} → ${pick.sel.to}`
  return pick.pending !== null ? `from ${pick.pending}, pick goal` : 'pick current rank'
}

export function shortMote(name: MoteName): string {
  return name.replace(/^Mote of /, '').replace(/ Potential$/, '')
}

export function stepText(s: Step): string {
  if (s.kind === 'condense') return `Condense ${s.pairs * 2}× ${shortMote(s.mote)} → ${s.pairs}× ${shortMote(s.into)}`
  const what =
    s.kind === 'merge'
      ? `Merge ${s.count}× spare +${s.tier} copy`
      : s.kind === 'level'
        ? `Spare ${s.spare + 1} (+${s.from}): apply ${s.count}× ${shortMote(s.mote)}`
        : `Apply ${s.count}× ${shortMote(s.mote)}`
  const progress = s.after.full < 10 ? ` (${s.after.fraction}/${2 ** s.after.full})` : ''
  return `${what} → rank ${s.after.full}${progress}`
}

/** The section's closing line: how far it gets, or what it wastes. */
export function outcomeText(p: NonNullable<MotePlan['gear']>): { ok: boolean; text: string } {
  if (p.shortfallXp > 0) {
    return {
      ok: false,
      text: `Not enough: stops at rank ${p.reached.full} (${p.reached.fraction}/${2 ** p.reached.full}), ${p.shortfallXp} XP short.`
    }
  }
  return { ok: true, text: `Reaches ${p.to}${p.overshootXp > 0 ? `, ${p.overshootXp} XP carries past it` : ', nothing wasted'}.` }
}
