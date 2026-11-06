// Tool approvals answered from a phone the owner allowed. DSH asks every approval through its
// "approval/request" waterfall; for a Bot's own chat and for DSH Agent Sessions this broker
// joins that waterfall ahead of the computer's own approval card:
// - the card still appears and still works; whichever answers first decides;
// - a phone answer closes the card (its request signal is aborted);
// - with no computer window open DSH has no answerer ('unavailable'), so the request waits for
//   the phone instead of failing.
// Group member approvals are answered by the Dabots engine itself (approval-answer); they do not
// reach this broker. Nothing here runs unless some phone holds the approvals grant.
import { randomUUID } from 'node:crypto'

const OUTCOMES = { allow: 'allowed-once', reject: 'rejected' }
const MAX_PENDING = 64

export function createApprovalBroker({ on, owner, available = () => false }) {
  const pending = new Map()
  const inflight = new Set()
  const waiters = new Set()
  const notify = () => { for (const wake of waiters) wake() }
  const eligible = target => { try { return available(target) === true } catch { return false } }
  const reconcile = () => { for (const entry of pending.values()) if (!eligible(entry)) entry.withdraw() }

  const dispose = on('approval/request', async (request, next) => {
    const sessionId = request?.agent?.session?.id ?? request?.agent?.id
    if (typeof sessionId !== 'string' || inflight.size >= MAX_PENDING) return next()
    const original = request.signal
    if (original?.aborted) return 'cancelled'
    let place = null
    try { place = await owner(sessionId, original) } catch { place = null }
    if (original?.aborted) return 'cancelled'
    if (!place || !eligible(place) || inflight.size >= MAX_PENDING) return next()
    // A combined signal lets a phone answer close the computer's card. The request is a plain
    // object DSH builds per call; the original signal is restored once the request settles.
    const closing = new AbortController()
    const combined = original ? AbortSignal.any([original, closing.signal]) : closing.signal
    let swapped = false
    try { request.signal = combined; swapped = request.signal === combined } catch { swapped = false }
    const entry = { id: randomUUID(), sessionId, conversationId: place.conversationId, agent: place.agent === true,
      // Private, untruncated text. Only the adapter's host-redacted projection may leave.
      tool: String(request.toolName ?? ''), reason: String(typeof request.displayReason === 'string' ? request.displayReason : request.reason ?? ''), at: Date.now() }
    return await new Promise((resolve, reject) => {
      let done = false
      let phone = true, desktopDone = false
      const finish = (outcome, problem) => {
        if (done) return
        done = true
        pending.delete(entry.id)
        inflight.delete(entry)
        original?.removeEventListener('abort', onAbort)
        closing.abort()
        if (swapped) { try { request.signal = original } catch { /* kept combined; it aborts with the original */ } }
        notify()
        if (problem) reject(problem); else resolve(outcome)
      }
      const onAbort = () => finish('cancelled')
      original?.addEventListener('abort', onAbort, { once: true })
      entry.answer = finish
      entry.withdraw = () => {
        phone = false
        pending.delete(entry.id)
        notify()
        // The existing computer waterfall stays alive, with its original outcome.
        // Only a confirmed unavailable result needs completing here.
        if (desktopDone) finish('unavailable')
      }
      pending.set(entry.id, entry)
      inflight.add(entry)
      notify()
      if (original?.aborted) { onAbort(); return }
      reconcile()
      Promise.resolve().then(next).then(outcome => {
        desktopDone = true
        // No computer answerer (no window open): keep waiting for the phone.
        if (outcome !== 'unavailable' || !phone || !eligible(entry)) finish(outcome)
      }, problem => finish(undefined, problem))
    })
  }, { prepend: true })

  return {
    reconcile,
    list: conversationId => { reconcile(); return [...pending.values()].filter(entry => entry.conversationId === conversationId)
      .map(({ id, conversationId: owner, tool, reason, at, sessionId }) => ({ id, conversationId: owner, sessionId, tool, reason, at }))
    },
    get: id => {
      reconcile()
      const entry = pending.get(String(id ?? ''))
      return entry ? { id: entry.id, conversationId: entry.conversationId, sessionId: entry.sessionId, agent: entry.agent } : null
    },
    answer(id, choice) {
      reconcile()
      const entry = pending.get(String(id ?? ''))
      if (!entry) return false
      const outcome = OUTCOMES[choice]
      if (!outcome) throw Object.assign(new Error('Choose allow or reject.'), { code: 'INVALID_CHOICE' })
      entry.answer(outcome)
      return true
    },
    /** Resolves after the next change, or after `ms`. */
    changed(ms, signal) {
      return new Promise(resolve => {
        const wake = () => { clearTimeout(timer); waiters.delete(wake); signal?.removeEventListener('abort', wake); resolve() }
        const timer = setTimeout(wake, ms)
        waiters.add(wake)
        signal?.addEventListener('abort', wake, { once: true })
      })
    },
    get size() { return pending.size },
    dispose() {
      try { dispose?.() } catch { /* already disposed with its context */ }
      for (const entry of inflight) entry.answer('cancelled')
    },
  }
}
