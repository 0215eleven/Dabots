import { createElement as h, useEffect, useState } from 'react'
import { remoteErrorMessage } from './remote-model.mjs'

const labels = { existing: '已有 HTTPS 入口', fixed: '自有隧道和固定域名', quick: '临时 Cloudflare', named: 'Cloudflare 隧道（填 Token，插件托管）' }
const states = {
  stopped: '隧道已停止', starting: '正在连接隧道…', running: '隧道已连接，尚未验证手机端可达',
  stopping: '正在停止，配对地址已停用…', error: '隧道发生错误', configured: '已保存 HTTPS 入口，尚未验证可达性', unconfigured: '尚未配置远程入口',
}
const link = (href, label) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, label)
const savedUrl = (remote, mode) => remote?.configuredUrls?.[mode] ?? (remote?.mode === mode ? remote.configuredUrl : '') ?? ''

export function BridgeSetupNotice({ status }) {
  if (status?.reason === 'REMOTE_CLEANUP_REQUIRED') return h('div', { className: 'dsma-setup' },
    h('h3', null, '请先确认旧临时隧道已停止'),
    h('p', { className: 'dsma-error', role: 'alert' }, remoteErrorMessage('REMOTE_CLEANUP_REQUIRED')),
    h('p', null, '此保护状态下不会重新启动连接服务。不要在旧进程仍运行时移除标记；插件不会自动删除标记或终止身份不明的进程。'))
  return h('div', { className: 'dsma-setup' },
    h('h3', null, '准备 App 连接'),
    h('p', null, '先启用 DeepSeek Bot Pro Bridge，配置独立的绝对存储目录和 loopback 监听；随后可选择服务器中转或自己直连。'),
    link('https://github.com/0215eleven/ds-bot-mobile-app/blob/main/docs/installation.md', '查看设置指南'))
}

export function RemoteConnectionPanel({ state, controller }) {
  const remote = state.status?.remote
  const [mode, setMode] = useState(remote?.mode ?? 'existing')
  const [url, setUrl] = useState(savedUrl(remote, remote?.mode ?? 'existing'))
  const [confirmed, setConfirmed] = useState(false)
  const [notice, setNotice] = useState(null)
  const [token, setToken] = useState('')
  useEffect(() => {
    setMode(remote?.mode ?? 'existing')
    setUrl(savedUrl(remote, remote?.mode ?? 'existing'))
  }, [remote?.mode, remote?.configuredUrl, remote?.configuredUrls?.existing, remote?.configuredUrls?.fixed])
  useEffect(() => setConfirmed(false), [remote?.mode, remote?.state, remote?.revision])
  if (!remote) return h('div', { className: 'dsma-remote dsma-notes' }, h('h3', null, '远程连接'), h('p', null, '正在使用 Bridge 原有连接配置。升级支持远程连接设置的 Bridge 后，可在此选择连接方式。'))
  const quickSaved = remote.mode === 'quick'
  const namedSaved = remote.mode === 'named'
  const managed = quickSaved || namedSaved
  const stopping = state.operation === 'remote.stop' || remote.state === 'stopping'
  const active = ['starting', 'running', 'stopping'].includes(remote.state) || state.operation === 'remote.start'
  const choose = event => { const next = event.target.value; setMode(next); setUrl(savedUrl(remote, next)); setConfirmed(false); setNotice(null); setToken('') }
  return h('section', { className: 'dsma-remote', 'aria-label': '远程连接设置' },
    h('h3', null, '远程连接'),
    h('p', { className: 'dsma-remote-status', role: 'status', 'aria-live': 'polite' }, `${labels[remote.mode] ?? '远程连接'} · ${states[remote.state] ?? '请刷新状态'}`),
    remote.url ? h('p', { className: 'dsma-address' }, '当前配对地址：', h('code', null, remote.url)) : null,
    remote.error ? h('p', { className: 'dsma-error', role: 'alert' }, remoteErrorMessage(remote.error)) : null,
    h('form', { 'aria-label': '配置远程入口', onSubmit: async event => {
      event.preventDefault(); setConfirmed(false); setNotice(null)
      await controller.configureRemote(mode, url, mode === 'named' ? token : '')
      const current = controller.snapshot()
      if (current.error) { setNotice({ ok: false, text: current.error }); return }
      if (mode === 'named') {
        setToken('')
        setNotice({ ok: true, text: '已保存 Token，正在启动 Cloudflare 隧道…' })
        await controller.startRemote(true)
        const started = controller.snapshot()
        if (started.error) { setNotice({ ok: false, text: started.error }); return }
        const up = started.status?.remote?.state === 'running'
        setNotice({ ok: up, text: up ? `隧道已连接：${url}。重新生成二维码后，手机端就会用这个地址。` : 'Token 已保存，隧道仍在连接；请稍后刷新状态。' })
        return
      }
      const saved = current.status?.remote?.configuredUrl ?? url
      setNotice({ ok: true, text: `已保存并生效：${saved}。重新生成二维码后，手机端就会用这个地址。` })
    } },
      h('label', { className: 'dsma-field' }, h('span', null, '连接方式'), h('select', { 'aria-label': '远程连接方式', value: mode, disabled: state.busy, onChange: choose }, ...Object.entries(labels).map(([value, label]) => h('option', { value, key: value }, label)))),
      mode !== 'quick' ? h('label', { className: 'dsma-field' }, h('span', null, '完整 HTTPS 地址'), h('input', { 'aria-label': 'HTTPS 入口地址', type: 'url', required: true, autoComplete: 'off', spellCheck: false, placeholder: 'https://phone.example.com', value: url, disabled: state.busy, onChange: event => { setUrl(event.target.value); setNotice(null) }, maxLength: 2048 })) : null,
      mode === 'named' ? h('label', { className: 'dsma-field' }, h('span', null, '隧道 Token'), h('input', { 'aria-label': 'Cloudflare 隧道 Token', type: 'password', autoComplete: 'new-password', spellCheck: false, placeholder: remote.tokenSet ? '已保存，留空则不修改' : '从 Cloudflare 后台复制整段隧道 Token', value: token, disabled: state.busy, onChange: event => { setToken(event.target.value); setNotice(null) }, maxLength: 4096 })) : null,
      mode === 'quick' ? h('p', null, '无需 Cloudflare 账号或域名。保存此方式后，仍需单独确认并点击启动。每次新建地址都会变化；插件不会自动启动或重启隧道。')
        : mode === 'named' ? h('p', null, '由插件自己运行并守护 cloudflared：保存后立即启动，进程断开会自动重连；DSH 重启后 Bridge 会自己把隧道拉起，不需要另装 Windows 服务。')
          : h('p', null, '保存时只检查地址格式，不会创建 Cloudflare 隧道、修改 DNS 或验证外网可达性。请先确保该 HTTPS 地址指向此 Bridge。'),
      h('div', { className: 'dsma-actions' }, h('button', { type: 'submit', disabled: state.busy, className: 'dsma-primary' }, state.busy ? '正在保存…' : mode === 'named' ? '保存 Token 并启动隧道' : mode === 'quick' ? '保存连接方式' : '验证格式并保存入口')),
      notice ? h('p', { className: notice.ok ? 'dsma-ok' : 'dsma-error', role: notice.ok ? 'status' : 'alert' }, notice.text) : null),
    mode === 'fixed' ? h('div', { className: 'dsma-remote-guide' },
      h('h4', null, '配置自己的隧道和域名'),
      h('p', null, '固定域名请先给 Bridge 设置固定端口，避免重启后服务地址变化。'),
      h('ol', null,
        h('li', null, '打开 Cloudflare 后台，在 Networking → Tunnels 创建或选择隧道。'),
        h('li', null, '添加 Published application route，选择自己的子域与域名。'),
        h('li', null, 'Service URL 只填写 Bridge 服务：', remote.loopbackUrl ? h('code', null, remote.loopbackUrl) : '请先将 Bridge 配置为专用 HTTP loopback 监听。', '不要使用 DSH 管理端口。'),
        h('li', null, '按官方步骤自行运行 connector，然后将对应 HTTPS 地址填入上方并保存。')),
      h('p', null, '插件不读取或保存 Cloudflare 主密码、API token、证书或隧道凭据。'),
      h('div', { className: 'dsma-links' }, link('https://dash.cloudflare.com/', '打开 Cloudflare 后台'), link('https://developers.cloudflare.com/tunnel/get-started/', '查看隧道配置步骤'))) : null,
    mode === 'named' ? h('div', { className: 'dsma-remote-guide' },
      h('h4', null, '插件托管的 Cloudflare 隧道'),
      h('p', null, '在 Cloudflare 后台 Networking → Tunnels 创建隧道，Public Hostname 指向 Bridge：', remote.loopbackUrl ? h('code', null, remote.loopbackUrl) : '请先将 Bridge 配置为专用 HTTP loopback 监听。'),
      h('p', null, '然后把该隧道的 Token 和对应 HTTPS 地址填到上面。Token 只保存在本机 Bridge 目录，页面和手机都看不到。'),
      h('p', null, '如果已经用 cloudflared Windows 服务跑同一条隧道，请先停掉它，避免两条连接同时占用同一入口。'),
      h('div', { className: 'dsma-links' }, link('https://dash.cloudflare.com/', '打开 Cloudflare 后台'), link('https://developers.cloudflare.com/tunnel/get-started/', '查看隧道配置步骤'))) : null,
    mode === 'existing' ? h('p', { className: 'dsma-remote-guide' }, '兼容现有 HTTPS 反向代理或隧道。原 publicUrl 配置保留，切换回来可继续使用已保存的入口。') : null,
    mode === 'quick' ? h('div', { className: 'dsma-quick' },
      h('p', null, '只代理本插件的 Bridge loopback 服务，仍要求设备配对和电脑所有者批准。停止后临时地址失效，电脑需要保持运行。'),
      remote.loopbackUrl ? h('p', { className: 'dsma-address' }, '代理目标：', h('code', null, remote.loopbackUrl)) : null,
      remote.quickAvailable === false ? h('p', { className: 'dsma-error' }, '当前监听不支持临时隧道。请将 Bridge 配置为独立的 HTTP loopback 服务。') : null,
      quickSaved ? h('div', null,
        h('label', { className: 'dsma-consent' }, h('input', { type: 'checkbox', 'aria-label': '确认临时外网访问', checked: confirmed, disabled: state.busy || active || remote.quickAvailable === false, onChange: event => setConfirmed(event.target.checked) }), h('span', null, '我确认将 Bridge 服务通过临时地址开放到外网，并理解地址变化后需要重新配对。')),
        h('button', { type: 'button', className: 'dsma-primary', disabled: !confirmed || state.busy || active || remote.quickAvailable === false, onClick: () => { const consent = confirmed; setConfirmed(false); void controller.startRemote(consent) } }, '启动临时连接')) : h('p', null, '请先保存“临时 Cloudflare”方式，再确认并启动。'),
      h('div', { className: 'dsma-links' }, link('https://developers.cloudflare.com/tunnel/downloads/', '安装 cloudflared（官方指南）'), link('https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/', '查看临时隧道限制')),
      h('p', { className: 'dsma-small' }, '仅适合测试与开发，无在线保证；最多 200 个同时处理的请求，不支持 SSE。Bridge 使用 HTTP 与 WebSocket。此处连接状态不等于手机端到端验证。')) : null,
    managed && (active || remote.state === 'error') ? h('div', { className: 'dsma-actions dsma-stop' }, h('button', { type: 'button', className: 'dsma-danger', disabled: stopping, onClick: () => { setConfirmed(false); void controller.stopRemote() } }, stopping ? '正在停止…' : namedSaved ? '停止隧道' : '停止临时连接')) : null,
    h('p', { className: 'dsma-remote-warning' }, '地址变化后，旧二维码和待批准请求失效。请在手机“添加电脑／重新配对”中扫描当前二维码，再在电脑批准；不会把已有手机凭据自动发送到新地址。'))
}

const relayStates = { disabled: '未启用', connecting: '正在连接中转服务…', ready: '已连接中转服务，可以扫码', offline: '中转服务暂时不可达，正在自动重连' }

// The owner's own relay server. The registration secret is write-only here.
export function RelayPanel({ state, controller }) {
  const relay = state.status?.relay
  const [address, setAddress] = useState(relay?.relay ?? '')
  const [secret, setSecret] = useState('')
  useEffect(() => { setAddress(relay?.relay ?? '') }, [relay?.relay])
  const active = relay?.mode === 'relay'
  const keep = relay?.secretSet && relay.relay === address.trim().replace(/\/$/, '')
  return h('section', { className: 'dsma-remote', 'aria-label': '服务器中转设置' },
    h('h3', null, '服务器中转'),
    active ? h('p', { className: 'dsma-remote-status', role: 'status', 'aria-live': 'polite' }, relayStates[relay.state] ?? '请刷新状态') : null,
    active && relay.computerId ? h('p', { className: 'dsma-address' }, '电脑标识：', h('code', null, relay.computerId.slice(0, 8))) : null,
    h('form', { 'aria-label': '配置中转服务', onSubmit: event => { event.preventDefault(); const value = secret; setSecret(''); void controller.useRelay(address.trim(), value) } },
      h('label', { className: 'dsma-field' }, h('span', null, '中转服务地址'), h('input', { 'aria-label': '中转服务地址', type: 'url', required: true, autoComplete: 'off', spellCheck: false, placeholder: 'wss://relay.example.com', value: address, disabled: state.busy, maxLength: 2048, onChange: event => setAddress(event.target.value) })),
      h('label', { className: 'dsma-field' }, h('span', null, '注册密钥'), h('input', { 'aria-label': '中转注册密钥', type: 'password', autoComplete: 'new-password', spellCheck: false, placeholder: keep ? '已保存，留空则不修改' : '与中转服务器上配置的密钥一致', value: secret, disabled: state.busy, maxLength: 512, onChange: event => setSecret(event.target.value) })),
      h('p', null, '密钥只保存在本机 Bridge 专用目录，页面和手机都看不到。'),
      h('div', { className: 'dsma-actions' }, h('button', { type: 'submit', className: 'dsma-primary', disabled: state.busy }, active ? '保存中转设置' : '保存并使用服务器中转'))),
    h('div', { className: 'dsma-remote-guide' },
      h('p', null, '电脑主动连到你自己的中转服务器，手机扫码后经它访问本机；不需要域名证书、端口映射或隧道。中转服务只转发加密数据，不保存账号或聊天内容。'),
      h('p', { className: 'dsma-small' }, '手机与电脑之间的加密改编自 Happy（MIT）开源实现，未经独立安全审计，也不提供前向保密。不会连接 Happy 的公共服务。')),
    h('p', { className: 'dsma-remote-warning' }, '切换连接方式后旧二维码失效；已配对的手机不会被撤销。'))
}

export function ConnectionModePanel({ state, controller }) {
  const relay = state.status?.relay
  const [choice, setChoice] = useState(relay?.mode ?? 'direct')
  useEffect(() => { setChoice(relay?.mode ?? 'direct') }, [relay?.mode])
  if (!relay) return h(RemoteConnectionPanel, { state, controller })
  const choose = mode => {
    setChoice(mode)
    // Relay needs its address first; the panel below saves and switches in one step.
    if (mode === 'direct' && relay.mode === 'relay') void controller.selectMode('direct')
    if (mode === 'relay' && relay.mode !== 'relay' && relay.relay && relay.secretSet) void controller.selectMode('relay')
  }
  const option = (mode, title, detail) => h('label', { className: 'dsma-mode', 'data-selected': choice === mode },
    h('input', { type: 'radio', name: 'dsma-connection-mode', value: mode, checked: choice === mode, disabled: state.busy, onChange: () => choose(mode) }),
    h('span', null, h('strong', null, title), h('small', null, detail)))
  return h('div', null,
    h('div', { className: 'dsma-modes', role: 'radiogroup', 'aria-label': '手机连接方式' },
      option('relay', '服务器中转', '自建服务器转发，扫码即用'),
      option('direct', '自己直连', '自己的 HTTPS 或 Cloudflare 隧道')),
    choice === 'relay' ? h(RelayPanel, { state, controller }) : h(RemoteConnectionPanel, { state, controller }))
}
