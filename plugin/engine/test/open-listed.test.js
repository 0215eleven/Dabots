import assert from 'node:assert/strict'
import { test } from 'node:test'
import { listedOpener } from '../src/client/open-listed.js'

const store = (ids = []) => {
  const listeners = new Set()
  const snapshot = { byId: {} }
  const notify = () => { for (const fn of listeners) fn() }
  const put = (id, main) => { snapshot.byId[id] = main ? { id, retainedBy: { mainView: 1 } } : { id } }
  for (const id of ids) put(id)
  return {
    getSnapshot: () => snapshot,
    subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    listeners: () => [...listeners],
    set: (id) => { put(id); notify() },
    setMain: (id) => { for (const row of Object.values(snapshot.byId)) delete row.retainedBy; put(id, true); notify() },
  }
}

const mainViewOf = list => Object.values(list.getSnapshot().byId).find(row => (row?.retainedBy?.mainView ?? 0) > 0)?.id

const rig = (list) => {
  const opened = []
  let refreshes = 0
  const show = listedOpener({ list, open: id => opened.push(id), refresh: () => { refreshes += 1 }, current: () => mainViewOf(list) })
  return { show, opened, refreshes: () => refreshes }
}

test('a listed Session opens at once and no refresh is asked for', () => {
  const { show, opened, refreshes } = rig(store(['a']))
  show('a')
  assert.deepEqual(opened, ['a'])
  assert.equal(refreshes(), 0)
})

test('an unlisted Session opens when the list reaches it, only once', () => {
  const list = store()
  const { show, opened, refreshes } = rig(list)
  show('a')
  assert.deepEqual(opened, [])
  assert.equal(refreshes(), 1)
  list.set('a')
  assert.deepEqual(opened, ['a'])
  list.set('b')
  assert.deepEqual(opened, ['a'])
})

test('a newer navigation drops the wait for the old one', () => {
  const list = store(['b'])
  const { show, opened } = rig(list)
  show('a')
  show('b')
  assert.deepEqual(opened, ['b'])
  list.set('a')
  assert.deepEqual(opened, ['b'])
})

test('two waits in a row keep only the last one', () => {
  const list = store()
  const { show, opened } = rig(list)
  show('a')
  show('b')
  list.set('a')
  list.set('b')
  assert.deepEqual(opened, ['b'])
})

test('a navigation elsewhere drops the wait', () => {
  const list = store(['x'])
  list.setMain('x')
  const { show, opened } = rig(list)
  show('a')
  list.setMain('y')
  list.set('a')
  assert.deepEqual(opened, [])
})

test('cancel releases every subscription and a copied old listener cannot cancel the next wait', () => {
  const list = store(), other = store(), opened = []
  const show = listedOpener({ list, subscribe: other.subscribe, open: id => opened.push(id) })
  show('a')
  const stale = list.listeners()[0]
  show('b')
  stale()
  assert.equal(show.pending, true)
  assert.equal(list.listeners().length, 1)
  assert.equal(other.listeners().length, 1)
  list.set('b')
  assert.deepEqual(opened, ['b'])
  assert.equal(show.pending, false)
  assert.equal(other.listeners().length, 0)
  show('c'); show.cancel(); list.set('c')
  assert.deepEqual(opened, ['b'])
  assert.equal(list.listeners().length, 0)
})

test('a changing target is resolved on both roster and list arrival and guarded before commit', () => {
  const list = store(['new']), roster = store(), opened = []
  let target = 'old', valid = true
  const show = listedOpener({ list, subscribe: roster.subscribe, open: id => opened.push(id) })
  show(() => target, { isCurrent: () => valid })
  target = 'new'; roster.set('ready')
  assert.deepEqual(opened, ['new'])
  show('late', { isCurrent: () => valid })
  valid = false; list.set('late')
  assert.deepEqual(opened, ['new'])
  assert.equal(show.pending, false)
})
