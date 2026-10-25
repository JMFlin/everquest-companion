// The Alt+Shift+0 overlay toggle (src/main/overlayHotkey.ts): hide everything open, then restore
// exactly that set.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createOverlayToggle } from '../src/main/overlayHotkey'
import type { OverlayKind } from '../src/shared/types'

function harness(initiallyOpen: OverlayKind[]) {
  const open = new Set<OverlayKind>(initiallyOpen)
  const toggle = createOverlayToggle({
    openKinds: () => [...open],
    setOpen: (kind, isOpen) => {
      if (isOpen) open.add(kind)
      else open.delete(kind)
    }
  })
  return { open, toggle }
}

test('a press closes every open overlay', () => {
  const { open, toggle } = harness(['fight', 'buffs'])
  toggle()
  assert.deepEqual([...open], [])
})

test('the next press reopens exactly what was closed', () => {
  const { open, toggle } = harness(['fight', 'buffs'])
  toggle()
  toggle()
  assert.deepEqual([...open].sort(), ['buffs', 'fight'])
})

test('opening one by hand while hidden makes the next press hide again, not restore', () => {
  const { open, toggle } = harness(['fight', 'buffs'])
  toggle()
  open.add('xp')
  toggle()
  assert.deepEqual([...open], [])
  toggle()
  assert.deepEqual([...open], ['xp'])
})

test('a press with nothing open and nothing remembered does nothing', () => {
  const { open, toggle } = harness([])
  toggle()
  assert.deepEqual([...open], [])
})
