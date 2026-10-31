import { canPair, httpsOrigin, pairingContext, pairingMode, relayMode, relayOrigin, remoteErrorMessage } from './remote-model.mjs'

const RELAY_ID = /^[A-Za-z0-9_-]{22}$/, RELAY_KEY = /^[A-Za-z0-9_-]{43}$/

export function createDeviceController({ call, now = Date.now, uuid = () => crypto.randomUUID() }) {
  const listeners = new Set(), requests = new Set()
  let state = { status: null, pairing: null, busy: false, operation: null, error: '', confirmRevoke: null, confirmAgents: null, copied: false }
  let disposed = false, generation = 0, refreshEpoch = 0, refreshFlight = null, operating = false, pairingEpoch = 0
  let leaseId = null, autoAttempted = false
  function cancelLease() {
    const id = leaseId
    leaseId = null
    if (!id) return Promise.resolve()
    // This request outlives the page. A scoped tombstone also cancels a create
    // that reached the server after the close request.
    return Promise.resolve(call('pairing.cancel', { leaseId: id })).catch(() => {})
  }
  const emit = patch => { if (disposed) return; state = { ...state, ...patch }; for (const listener of listeners) listener() }
  const invoke = async (method, payload) => {
    const request = new AbortController(); requests.add(request)
    try { return await call(method, payload, request.signal) } finally { requests.delete(request) }
  }
  function refresh({ afterCurrent = false } = {}) {
    if (disposed) return Promise.resolve()
    // Polls share one request even when its RTT exceeds the poll interval.
    // Mutations explicitly wait for a new request after any older flight.
    if (refreshFlight) return afterCurrent ? refreshFlight.then(() => refresh()) : refreshFlight
    const issued = refreshEpoch
    refreshFlight = (async () => {
      try {
        const status = await invoke('status', {})
        if (!disposed && issued === refreshEpoch) {
          const changed = state.status !== null && pairingContext(status) !== pairingContext(state.status)
          if (changed) { pairingEpoch++; void cancelLease() }
          const consumed = leaseId && status.pairingLease?.leaseId === leaseId && ['claimed', 'paired'].includes(status.pairingLease.state)
          if (consumed) { pairingEpoch++; if (status.pairingLease.state === 'paired') leaseId = null }
          emit({ status, error: '', ...(changed || consumed || !canPair(status) ? { pairing: null, copied: false } : {}), ...(consumed ? { pairingResult: status.pairingLease.state } : {}) })
        }
      } catch (error) { if (!disposed && issued === refreshEpoch) { pairingEpoch++; void cancelLease(); emit({ status: null, pairing: null, copied: false, error: error.message || '无法刷新设备状态，请检查电脑连接。' }) } }
    })().finally(() => { refreshFlight = null })
    return refreshFlight
  }
  async function operation(method, payload = {}, { interrupt = false } = {}) {
    if (disposed || operating && !interrupt) return
    if (interrupt && state.operation === method) return
    operating = true
    const issued = ++generation
    refreshEpoch++
    const changesTransport = method.startsWith('remote.') || method.startsWith('relay.')
    if (changesTransport) { pairingEpoch++; void cancelLease() }
    const pairingIssued = pairingEpoch
    emit({ busy: true, operation: method, error: '', ...(method === 'pairing.create' || changesTransport ? { pairing: null, copied: false, pairingResult: null } : {}) })
    try {
      const value = await invoke(method, payload)
      if (disposed || issued !== generation) return
      if (method === 'pairing.create' && value?.v === 2) {
        // Relay pairing carries the computer's relay identity instead of an address.
        const relay = relayOrigin(value.relay), relayStatus = state.status?.relay
        if (!RELAY_ID.test(value.computerId ?? '') || !RELAY_KEY.test(value.computerKey ?? '') || !value.code || !value.serverId || !(value.expiresAt > now())) throw Error('Bridge 返回的配对资料无效，请刷新后重试。')
        if (pairingIssued === pairingEpoch && (!state.status || canPair(state.status) && pairingMode(state.status) === 'relay') && (!relayStatus || relayStatus.relay === relay && relayStatus.computerId === value.computerId) && (!state.status?.serverId || state.status.serverId === value.serverId)) {
          emit({ pairing: { v: 2, relay, computerId: value.computerId, computerKey: value.computerKey, serverId: value.serverId, code: value.code, expiresAt: value.expiresAt } })
        }
      } else if (method === 'pairing.create') {
        const url = httpsOrigin(value.url)
        if (!value.code || !value.serverId || !(value.expiresAt > now())) throw Error('Bridge 返回的配对资料无效，请刷新后重试。')
        if (pairingIssued === pairingEpoch && (!state.status || canPair(state.status) && pairingMode(state.status) === 'direct') && (!state.status?.url || state.status.url === url) && (!state.status?.serverId || state.status.serverId === value.serverId)) {
          emit({ pairing: { url, code: value.code, serverId: value.serverId, expiresAt: value.expiresAt } })
        }
      }
      emit({ confirmRevoke: null, confirmAgents: null })
      refreshEpoch++
      await refresh({ afterCurrent: true })
    } catch (error) { if (method === 'pairing.create' && issued === generation) void cancelLease(); if (!disposed && issued === generation) emit({ error: error.message || (changesTransport ? remoteErrorMessage(error.code) : '设备操作未完成，请刷新后重试。') }) }
    finally { if (issued === generation) { operating = false; if (!disposed) emit({ busy: false, operation: null }) } }
  }
  function createPairing() {
    if (disposed || operating) return Promise.resolve()
    autoAttempted = true
    void cancelLease()
    leaseId = uuid()
    return operation('pairing.create', { automatic: true, leaseId })
  }
  function autoPair() {
    const status = state.status
    if (disposed || operating || autoAttempted || state.pairing || !canPair(status) || status?.relay?.mode !== 'relay' || status.relay.official !== true) return Promise.resolve()
    return createPairing()
  }
  return {
    snapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    refresh,
    create: createPairing,
    autoPair,
    async useOfficial() {
      if (disposed || operating) return
      autoAttempted = false
      await operation('relay.official')
      if (!state.error) await autoPair()
    },
    configureRemote(mode, value, token = '') {
      if (!['existing', 'fixed', 'quick', 'named'].includes(mode)) { emit({ error: '请选择支持的远程连接方式。' }); return Promise.resolve() }
      let url
      try { if (mode !== 'quick') url = httpsOrigin(value) }
      catch (error) { emit({ error: error.message }); return Promise.resolve() }
      return operation('remote.configure', { mode, ...(url ? { url } : {}), ...(mode === 'named' && token ? { token } : {}) })
    },
    startRemote(confirmed) {
      if (confirmed !== true) { emit({ error: remoteErrorMessage('CONFIRMATION_REQUIRED') }); return Promise.resolve() }
      return operation('remote.start', { confirmed: true })
    },
    stopRemote: () => operation('remote.stop', {}, { interrupt: true }),
    // The optional secret is passed straight through and never kept in controller state.
    // Without one, a saved secret for the same address is kept; open relays need none.
    async useRelay(value, secret) {
      let relay
      try { relay = relayOrigin(value) } catch (error) { emit({ error: error.message }); return }
      await operation('relay.configure', { relay, ...(secret ? { secret } : {}) })
      if (state.error || state.status?.relay?.relay !== relay) return
      if (!relayMode(state.status)) await operation('relay.select', { mode: 'relay' })
    },
    selectMode(mode) {
      if (!['relay', 'direct'].includes(mode)) { emit({ error: remoteErrorMessage('INVALID_CONNECTION_MODE') }); return Promise.resolve() }
      autoAttempted = true
      return operation('relay.select', { mode })
    },
    decide(requestId, approved) {
      if (!state.status?.pending?.some(item => item.requestId === requestId)) return
      return operation(approved ? 'pairing.approve' : 'pairing.deny', { requestId })
    },
    confirmRevoke(id) { if (state.status?.devices?.some(item => item.id === id && !item.revokedAt)) emit({ confirmRevoke: id }) },
    cancelRevoke: () => emit({ confirmRevoke: null }),
    revoke(id) { if (state.confirmRevoke === id) return operation('device.revoke', { id }) },
    // Allowing the DSH Agent takes an explicit confirmation of what it exposes;
    // turning it off is immediate.
    confirmAgents(id) { if (state.status?.devices?.some(item => item.id === id && !item.revokedAt && item.agents !== true)) emit({ confirmAgents: id }) },
    cancelAgents: () => emit({ confirmAgents: null }),
    allowAgents(id) { if (state.confirmAgents === id) return operation('device.agents', { id, enabled: true }) },
    denyAgents(id) { if (state.status?.devices?.some(item => item.id === id && item.agents === true)) return operation('device.agents', { id, enabled: false }) },
    tick() { if (state.pairing && state.pairing.expiresAt <= now()) { void cancelLease(); emit({ pairing: null, copied: false, pairingResult: 'expired' }) } },
    clearPairing() { autoAttempted = true; void cancelLease(); generation++; refreshEpoch++; pairingEpoch++; operating = false; for (const request of requests) request.abort(); emit({ pairing: null, copied: false, busy: false, operation: null, confirmRevoke: null, confirmAgents: null }) },
    async copy(clipboard) {
      const pairing = state.pairing
      if (!pairing || pairing.expiresAt <= now()) return
      try { await clipboard.writeText(JSON.stringify(pairing)); if (!disposed && state.pairing === pairing) emit({ copied: true, error: '' }) }
      catch { emit({ error: '无法访问剪贴板，请展开手动配对资料复制。' }) }
    },
    dispose() { if (disposed) return; void cancelLease(); disposed = true; generation++; for (const request of requests) request.abort(); state = { ...state, pairing: null, status: null, confirmRevoke: null, confirmAgents: null }; listeners.clear() },
  }
}
