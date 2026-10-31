const messages = {
  MISSING_CLOUDFLARED: '未找到 cloudflared。请按官方安装指南自行安装，然后重试。',
  CLOUDFLARED_MISSING: '未找到 cloudflared。请按官方安装指南自行安装，然后重试。',
  START_TIMEOUT: '临时隧道连接超时。请检查网络后手动重试。',
  TUNNEL_TIMEOUT: '临时隧道连接超时。请检查网络后手动重试。',
  TUNNEL_START_TIMEOUT: '临时隧道连接超时。请检查网络后手动重试。',
  TUNNEL_EXITED: '临时隧道进程已退出。旧地址已失效，请手动重新启动。',
  TUNNEL_FAILED: '临时隧道未能启动。请检查 cloudflared 安装和网络后重试。',
  STOP_FAILED: '尚未确认隧道进程已停止。已停用配对地址，请再次停止或在电脑上检查进程。',
  TUNNEL_STOP_FAILED: '尚未确认隧道进程已停止。已停用配对地址，请再次停止或在电脑上检查进程。',
  REMOTE_STOP_FAILED: '尚未确认隧道进程已停止。已停用配对地址，请再次停止或在电脑上检查进程。',
  TUNNEL_CLEANUP_FAILED: '临时隧道已退出，但临时文件清理失败。请在电脑上检查后重试。',
  CONFIRMATION_REQUIRED: '请先确认将 Bridge 服务暴露到外网，再点击启动。',
  EXPOSURE_CONFIRMATION_REQUIRED: '请先确认将 Bridge 服务暴露到外网，再点击启动。',
  QUICK_UNAVAILABLE: '当前 Bridge 不是可代理的 HTTP loopback 服务。请检查 Bridge 监听配置。',
  QUICK_LOOPBACK_REQUIRED: '当前 Bridge 不是可代理的 HTTP loopback 服务。请检查 Bridge 监听配置。',
  QUICK_MODE_REQUIRED: '请先保存临时 Cloudflare 连接方式，再确认并启动。',
  NAMED_FIXED_PORT_REQUIRED: '请先在 Bridge 插件配置中设置未占用的固定非零端口，重新启用 Bridge，再同步 Cloudflare 的 Service URL。',
  BRIDGE_PORT_IN_USE: 'Bridge 端口已被占用。请检查现有服务或在插件配置中选择未占用的固定端口，然后重新启用 Bridge；使用自有隧道时同时更新 Service URL。',
  INVALID_PUBLIC_URL: '请输入完整 HTTPS 入口，不含账号、密码、路径、查询参数或片段。',
  INVALID_REMOTE_URL: '请输入完整 HTTPS 入口，不含账号、密码、路径、查询参数或片段。',
  REMOTE_URL_REQUIRED: '请填写已配置好的 HTTPS 入口地址。',
  INVALID_REMOTE_MODE: '请选择支持的远程连接方式。',
  INVALID_TUNNEL_TOKEN: 'Cloudflare 隧道 Token 格式不正确，请从后台整段复制。',
  TUNNEL_UNAUTHORIZED: 'Cloudflare 拒绝了隧道认证。请在后台获取有效的隧道 Token，更新后保存并重新启动。',
  TUNNEL_STOPPING: '隧道正在停止。请等待进程退出，稍后重试。',
  REMOTE_TOKEN_REQUIRED: '请先填写 Cloudflare 隧道 Token。',
  REMOTE_BUSY: '另一项连接操作正在进行，请刷新状态后重试。',
  REMOTE_CLOSED: 'Bridge 已停止，请检查插件状态后重新打开本页。',
  REMOTE_CLEANUP_REQUIRED: '上次卸载后尚未确认旧 cloudflared 已退出。请先在电脑上确认其停止，再手动移除 Bridge 专用目录中的 remote-cleanup-required.json，然后重新启用 Bridge。',
  CONFIGURATION_REQUIRED: '请先启用 Dabots Bridge，并配置独立的绝对存储目录与 loopback 监听。',
  OPERATOR_REQUIRED: '请在已登录的电脑所有者会话中打开本页。',
  OPERATOR_REFUSED: '操作被拒绝。请刷新状态后检查配置并重试。',
  INVALID_RELAY_URL: '请输入完整的 wss:// 中转服务地址，不含账号、路径、查询或片段。',
  INVALID_RELAY_SECRET: '注册密钥至少 32 字节，且不能包含空白字符。',
  RELAY_SECRET_REQUIRED: '请填写中转服务的注册密钥。',
  INVALID_RELAY_SETTINGS: '请填写中转服务地址和注册密钥。',
  RELAY_NOT_CONFIGURED: '请先保存中转服务地址和注册密钥。',
  RELAY_NOT_READY: '中转连接尚未就绪，请检查中转服务地址、注册密钥和网络。',
  INVALID_CONNECTION_MODE: '请选择服务器中转或自己直连。',
  REMOTE_NOT_READY: '请先配置 HTTPS 入口或启动临时隧道，再生成配对码。',
}

export function remoteErrorMessage(code) {
  return Object.hasOwn(messages, code) ? messages[code] : '远程连接操作未完成。请刷新状态，检查配置后手动重试。'
}

export function httpsOrigin(value) {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\s\\@]/.test(value) || !/^https:\/\/[^/]+\/?$/i.test(value)) throw Error(messages.INVALID_PUBLIC_URL)
  let parsed
  try { parsed = new URL(value) } catch { throw Error(messages.INVALID_PUBLIC_URL) }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash || value.includes('?') || value.includes('#')) throw Error(messages.INVALID_PUBLIC_URL)
  return parsed.origin
}

export function relayOrigin(value) {
  const message = messages.INVALID_RELAY_URL
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\s\\@?#]/.test(value) || !/^wss:\/\/[^/]+\/?$/i.test(value)) throw Error(message)
  let parsed
  try { parsed = new URL(value) } catch { throw Error(message) }
  if (parsed.protocol !== 'wss:' || !parsed.hostname || parsed.username || parsed.password || parsed.pathname !== '/') throw Error(message)
  return parsed.origin
}

export const relayMode = status => status?.relay?.mode === 'relay'
export const pairingMode = status => status?.pairing?.mode ?? (relayMode(status) ? 'relay' : 'direct')

export function pairingContext(status) {
  if (!status) return null
  const mode = pairingMode(status)
  return JSON.stringify([status.enabled, status.serverId, status.url, status.remote?.mode, status.remote?.state, status.remote?.revision,
    mode, status.pairing?.available, ...(mode === 'relay' ? [status.relay?.relay, status.relay?.state, status.relay?.computerId, status.relay?.revision] : [])])
}

// The pairing code follows the selected door: the owner's relay, or the direct address.
export function canPair(status) {
  if (status?.enabled !== true) return false
  if (status.pairing) return ['direct', 'relay'].includes(status.pairing.mode) && status.pairing.available === true
  if (relayMode(status)) return status.relay.ready === true
  return !status.remote || Boolean(status.url) && (status.remote.state === 'running' || status.remote.state === 'configured')
}
