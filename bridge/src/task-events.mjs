const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 512
const nonnegative = value => Number.isSafeInteger(value) && value >= 0
const outcomes = new Map([
  ['completed', 'completed'], ['error', 'failed'], ['aborted', 'cancelled'],
  ['blocked', 'blocked'], ['max-tokens', 'max-tokens'], ['interrupted', 'interrupted'], ['forked', 'forked'],
])

// Only turn facts cross this boundary. Failure messages, tool arguments and
// cancellation details remain on the computer. The caller proves ownership.
export function projectTaskEvent(event, { conversationId, sessionId, hiddenTurns = [] } = {}) {
  if (!identity(conversationId) || !identity(sessionId) || !nonnegative(event?.seq)
    || !['turn/start', 'turn/end'].includes(event.type) || hiddenTurns.includes(event.data?.turn)) return null
  const busy = event.type === 'turn/start'
  return {
    type: 'status', conversationId, sessionId, busy, phase: busy ? 'running' : 'idle', eventSeq: event.seq,
    taskEvent: {
      id: JSON.stringify(['turn', sessionId, event.seq]),
      kind: busy ? 'running' : outcomes.get(event.data?.reason?.kind) ?? 'ended',
      ...(nonnegative(event.data?.turn) ? { turn: event.data.turn } : {}),
      ...(nonnegative(event.time) ? { createdAt: event.time } : {}),
    },
  }
}

// Call only after the state projection has verified the request's Session and
// conversation ownership. This signals attention; it never grants approval.
export function projectApprovalEvent({ conversationId, sessionId, approvalId, createdAt } = {}) {
  if (![conversationId, sessionId, approvalId].every(identity)) return null
  return {
    type: 'status', conversationId, sessionId, busy: true, phase: 'running', approvalRequired: true,
    taskEvent: { id: JSON.stringify(['approval', sessionId, approvalId]), kind: 'approval-required',
      ...(nonnegative(createdAt) ? { createdAt } : {}) },
  }
}
