// DSH's main view opens only a Session that its client list already holds; any other id
// throws `sessions.retain: unknown session`. A part the Host made a moment ago, or any part
// before the first list arrives, waits for the list; a newer navigation — through here or
// elsewhere — drops the wait.
export function listedOpener({ list, open, refresh, current, subscribe }) {
  let drop = () => {}
  let pending = false, revision = 0
  const cancel = () => { revision++; drop(); drop = () => {}; pending = false }
  const show = (resolve, { isCurrent = () => true, beforeOpen } = {}) => {
    cancel()
    const intent = revision
    const from = current?.()
    const targetOf = typeof resolve === 'function' ? resolve : () => resolve
    const attempt = () => {
      // A source may already have copied this listener when a newer navigation
      // unsubscribed it. That old callback must not cancel the new wait.
      if (intent !== revision) return true
      if (!isCurrent() || current?.() !== from) { cancel(); return true }
      const target = targetOf()
      if (!target || list.getSnapshot().byId?.[target] === undefined) return false
      cancel()
      beforeOpen?.(target)
      open(target)
      return true
    }
    if (attempt()) return
    pending = true
    const offList = list.subscribe(attempt), offOther = subscribe?.(attempt)
    drop = () => { offList(); offOther?.() }
    // Close the check/subscribe gap, including synchronously arriving refreshes.
    if (!attempt()) refresh?.()
  }
  show.cancel = cancel
  Object.defineProperty(show, 'pending', { get: () => pending })
  return show
}
