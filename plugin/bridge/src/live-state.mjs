// Public DS Bot state contains tool arguments, paths and hidden member Sessions.
// Keep only finite clocks, known activity labels and visible team relationships.
const clock = value => Number.isSafeInteger(value) && value >= 0
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const activities = new Set(['thinking', 'sending', 'orbit', 'searching', 'working', 'alert', 'waiting'])
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 256
const workFields = value => ({ ...(clock(value.since) ? { since: value.since } : {}), ...(value.switching === true ? { switching: true } : {}) })

export function projectLiveState(state, conversations) {
  const bots = new Map(conversations.filter(item => item.kind === 'bot').map(item => [item.id, item]))
  const rooms = new Map(conversations.filter(item => item.kind === 'room').map(item => [item.id, item]))
  const source = object(state.work)
  const activity = Object.fromEntries(Object.entries(object(state.activity)).filter(([key, value]) => bots.has(key) && activities.has(value)))
  const work = { bots: {}, rooms: {}, approvals: [], waiting: {} }
  for (const [key, value] of Object.entries(object(source.bots))) {
    if (!bots.has(key) || !value || typeof value !== 'object') continue
    if (value.roomId !== undefined && !rooms.get(value.roomId)?.members.includes(key)) continue
    Object.defineProperty(work.bots, key, { enumerable: true, value: { ...workFields(value), ...(value.roomId ? { roomId: value.roomId } : {}) } })
  }
  for (const [key, entries] of Object.entries(object(source.rooms))) {
    const room = rooms.get(key)
    if (!room || !Array.isArray(entries)) continue
    const seen = new Set()
    const safe = entries.filter(value => value && room.members.includes(value.botId) && !seen.has(value.botId) && seen.add(value.botId))
      .map(value => ({ botId: value.botId, ...workFields(value), ...(value.speaking === true ? { speaking: true } : {}) }))
    if (safe.length) Object.defineProperty(work.rooms, key, { enumerable: true, value: safe })
  }
  const approvalIds = new Set()
  for (const entry of Array.isArray(source.approvals) ? source.approvals : []) {
    const bot = bots.get(entry?.botId)
    if (!bot || !id(entry.id) || approvalIds.has(entry.id)) continue
    if (entry.roomId !== undefined) {
      const room = rooms.get(entry.roomId)
      const raw = (state.rooms ?? []).find(item => item.id === entry.roomId)
      if (!room?.members.includes(bot.id) || !raw?.parts?.includes(entry.sessionId)) continue
    } else if (entry.sessionId !== bot.sessionId) continue
    approvalIds.add(entry.id)
    work.approvals.push({ id: entry.id, botId: bot.id, ...(entry.roomId ? { roomId: entry.roomId } : {}),
      ...(clock(entry.at) ? { at: entry.at } : {}), answerable: false })
  }
  for (const [key, entry] of Object.entries(object(source.waiting))) {
    if (!bots.has(key) || !entry || typeof entry !== 'object') continue
    const safe = Object.fromEntries(['bots', 'rooms', 'for'].map(field => [field,
      [...new Set((Array.isArray(entry[field]) ? entry[field] : []).filter(value => (field === 'rooms' ? rooms : bots).has(value)))]]))
    if (safe.bots.length || safe.rooms.length) Object.defineProperty(work.waiting, key, { enumerable: true, value: safe })
  }
  return { activity, work }
}

export function conversationStatus(item, work) {
  const ownWork = work.bots[item.id]
  const approvalRequired = work.approvals.some(entry => item.kind === 'room' ? entry.roomId === item.id : entry.botId === item.id && !entry.roomId)
  const waiting = item.kind === 'bot' && !!work.waiting[item.id]
  const busy = approvalRequired || (item.kind === 'room' ? !!work.rooms[item.id]?.length : !!ownWork && !ownWork.roomId)
  return { busy, phase: approvalRequired ? 'waiting-approval' : busy ? 'running' : waiting ? 'waiting' : 'idle', approvalRequired }
}

export function recentConversation(item, rows, work) {
  const owned = new Set([item.sessionId, ...item.parts])
  const times = rows.filter(row => owned.has(row?.sessionId) && clock(row.updatedAt)).map(row => row.updatedAt)
  const status = conversationStatus(item, work)
  const busy = status.busy || rows.some(row => row?.sessionId === item.sessionId && row.running === true)
  return { ...item, ...status, busy, phase: status.approvalRequired ? status.phase : busy ? 'running' : status.phase,
    ...(times.length ? { updatedAt: Math.max(...times) } : {}) }
}
