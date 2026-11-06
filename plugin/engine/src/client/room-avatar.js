// The phone shows at most four members in a centered, non-overlapping two-column
// layout. Keep this renderer independent of React so the branding pipeline can
// also upgrade prebuilt compatibility clients without changing their platform imports.
export function renderRoomAvatar(h, BotMark, room, roster, size) {
  const ids = [...new Set(room.members)].filter(id => typeof id === 'string' && id.length > 0).slice(0, 4)
  const gap = Math.min(2, size / 12)
  const cell = (size - gap * 3) / 2
  const rows = Math.ceil(ids.length / 2)
  const top = (size - rows * cell - Math.max(0, rows - 1) * gap) / 2
  return h('span', {
    className: 'bt-cluster', 'aria-hidden': true,
    style: { width: size, height: size, overflow: 'hidden', flexShrink: 0 },
  }, ids.length ? ids.map((id, index) => {
    const columns = Math.min(2, ids.length - Math.floor(index / 2) * 2)
    const left = (size - columns * cell - (columns - 1) * gap) / 2
    // A roster refresh may briefly omit a Bot. Keep its stable identity/slot;
    // BotMark provides the same generated fallback as it does for a missing photo.
    const bot = roster.byId[id] ?? { id }
    return h('span', { key: id, className: 'bt-cluster-member', 'data-member-id': id,
      style: { left: left + index % 2 * (cell + gap), top: top + Math.floor(index / 2) * (cell + gap), width: cell, height: cell, overflow: 'hidden' },
    }, h(BotMark, { bot, size: cell }))
  }) : h('svg', { width: size * 0.56, height: size * 0.56, viewBox: '0 0 20 20',
    style: { left: size * 0.22, top: size * 0.22 }, fill: 'none', stroke: 'var(--bt-ink-3)', strokeWidth: 1.5,
  }, h('path', { d: 'M2.5 6V4.5h6l2 2h7V16h-15Z', strokeLinejoin: 'round' })))
}
