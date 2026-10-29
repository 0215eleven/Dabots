import { remoteErrorMessage } from './remote-model.mjs'

const METHODS = new Set(['status', 'pairing.create', 'pairing.approve', 'pairing.deny', 'device.revoke', 'device.agents', 'remote.configure', 'remote.start', 'remote.stop', 'relay.configure', 'relay.select'])
export function createOperatorClient({ root, fetchImpl = fetch, location = globalThis.location, uuid = () => crypto.randomUUID() }) {
  const base = new URL(root)
  const desktop = base.protocol === 'dsh-app:' && base.host === 'app' && base.pathname === '/'
  if ((!['http:', 'https:'].includes(base.protocol) && !desktop) || base.username || base.password || base.search || base.hash || !base.pathname.endsWith('/')) throw Error('Invalid DSH application root')
  if (location && (base.protocol !== location.protocol || base.host !== location.host)) throw Error('Cross-origin operator access refused')
  return async (method, payload = {}, signal) => {
    if (!METHODS.has(method)) throw Error('Unsupported device operation')
    const rpcId = uuid()
    const response = await fetchImpl(new URL(`mobile-operator/${method}`, base), { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId, method, payload }), signal })
    if (!response.ok) throw Object.assign(Error(response.status === 404 || response.status === 405 ? '请先安装并配置 Dbot pro Bridge，然后启用插件。' : response.status === 401 || response.status === 403 ? '请在已登录的电脑所有者会话中打开本页。' : '无法连接 Dbot pro Bridge，请检查电脑端连接。'), { code: `HTTP_${response.status}` })
    const body = await response.json()
    if (body?.type !== 'server-response' || body.rpcId !== rpcId) throw Error('响应校验失败，请刷新后重试。')
    if (body.result?.ok !== true) {
      const code = typeof body.result?.error?.code === 'string' ? body.result.error.code : 'OPERATOR_REFUSED'
      throw Object.assign(Error(remoteErrorMessage(code)), { code })
    }
    return body.result.value
  }
}
