import { createElement as h, useEffect, useState } from 'react'
import { remoteErrorMessage } from './remote-model.mjs'

const states = {
  stopped: '隧道已停止', starting: '正在连接隧道…', running: '隧道已连接，可以生成二维码',
  stopping: '正在停止，旧二维码已失效…', error: '连接失败，请按提示重试', configured: '入口已保存，可以生成二维码', unconfigured: '选择一种隧道开始连接',
}
const link = (href, label) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, label)
const savedUrl = (remote, mode) => remote?.configuredUrls?.[mode] ?? (remote?.mode === mode ? remote.configuredUrl : '') ?? ''

export function BridgeSetupNotice({ status }) {
  const code = status?.reason
  if (code === 'BRIDGE_PORT_IN_USE' || code === 'REMOTE_CLEANUP_REQUIRED') return h('div', { className: 'dsma-setup' },
    h('h3', null, code === 'BRIDGE_PORT_IN_USE' ? '请选择未占用的 Bridge 端口' : '请先确认旧临时隧道已停止'),
    h('p', { className: 'dsma-error', role: 'alert' }, remoteErrorMessage(code)))
  return h('div', { className: 'dsma-setup' }, h('h3', null, '连接服务暂时不可用'),
    h('p', null, '请确认已安装并启用 Dabots Bridge，然后重试。'),
    link('https://github.com/0215eleven/Dabots/blob/main/plugin/docs/connection.md', '查看设置指南'))
}

// Kept as an export for existing plugin bundles. The public entry is 官方登录.
export function RelayPanel({ state, controller }) {
  const relay = state.status?.relay
  const official = relay?.official === true
  const ready = official && relay.ready === true
  const connecting = official && relay.state === 'connecting' || state.operation === 'relay.official'
  return h('section', { className: 'dsma-official', 'aria-label': '官方登录' },
    h('h3', null, '让手机接着聊'),
    state.status?.reason && state.status.reason !== 'OFFICIAL_AVAILABLE' && !state.status.enabled ? h('p', { className: 'dsma-error', role: 'alert' }, remoteErrorMessage(state.status.reason)) : null,
    h('p', null, '电脑保持在线，连接就绪后用 Dabots 手机端扫码即可。'),
    h('p', { className: 'dsma-remote-status', role: 'status', 'aria-live': 'polite' }, ready ? '连接已就绪，可以扫码' : connecting ? '正在连接官方服务…' : official && relay.state === 'limited' ? '官方服务当前额度已满，将在一分钟后重试；也可以切换隧道连接。' : official && relay.state === 'denied' ? '官方服务拒绝了本次连接，请稍后重试或切换隧道连接。' : official && relay.state === 'offline' ? '暂时无法连接，正在自动重连' : '无需填写地址、密钥或注册表单'),
    !ready ? h('button', { type: 'button', className: 'dsma-primary', disabled: state.busy, onClick: () => controller.useOfficial() }, connecting ? '正在连接…' : official ? '重试连接' : '官方登录并连接') : null,
    h('p', { className: 'dsma-small' }, '官方服务只转发手机与电脑之间的加密数据。'))
}

export function RemoteConnectionPanel({ state, controller }) {
  const remote = state.status?.remote
  const savedMode = remote?.state === 'unconfigured' ? 'quick' : remote?.mode ?? 'quick'
  const [kind, setKind] = useState(savedMode === 'quick' ? 'quick' : 'own')
  const [mode, setMode] = useState(savedMode === 'quick' ? 'named' : savedMode)
  const [url, setUrl] = useState(savedUrl(remote, savedMode))
  const [token, setToken] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    setKind(savedMode === 'quick' ? 'quick' : 'own')
    if (savedMode !== 'quick') setMode(savedMode)
    setUrl(savedUrl(remote, savedMode)); setToken(''); setConfirmed(false)
  }, [savedMode, remote?.configuredUrl, remote?.configuredUrls?.fixed, remote?.configuredUrls?.existing])
  useEffect(() => setConfirmed(false), [remote?.state, remote?.revision])
  if (!remote) return h('p', { className: 'dsma-remote' }, '请先连接官方服务以初始化电脑，再选择隧道。')
  const active = ['starting', 'running', 'stopping'].includes(remote.state)
  const stopping = remote.state === 'stopping' || state.operation === 'remote.stop'
  const choose = next => {
    controller.clearPairing(); setKind(next); setToken(''); setConfirmed(false); setNotice('')
    if (next === 'own') setUrl(savedUrl(remote, mode))
  }
  const option = (value, label, detail) => h('button', { type: 'button', className: 'dsma-tunnel-option', 'aria-pressed': kind === value, disabled: state.busy, onClick: () => choose(value) }, h('strong', null, label), h('small', null, detail))
  const startQuick = async () => {
    const consent = confirmed; setConfirmed(false); setNotice('')
    if (!consent) return
    if (remote.mode !== 'quick') await controller.configureRemote('quick')
    if (!controller.snapshot().error) await controller.startRemote(true)
  }
  const saveOwn = async event => {
    event.preventDefault(); setNotice('')
    await controller.configureRemote(mode, url, mode === 'named' ? token : '')
    if (controller.snapshot().error) return
    setToken('')
    if (mode === 'named') await controller.startRemote(true)
    if (!controller.snapshot().error) setNotice(mode === 'named' ? '隧道正在连接；就绪后即可生成二维码。' : '入口已保存，生成二维码后即可扫码。')
  }
  return h('section', { className: 'dsma-remote dsma-tunnel', 'aria-label': '隧道连接设置' },
    h('div', { className: 'dsma-tunnel-options', role: 'group', 'aria-label': '隧道类型' },
      option('quick', '临时隧道', '无需域名，适合临时使用'), option('own', '自有域名隧道', '使用自己的固定 HTTPS 地址')),
    h('p', { className: 'dsma-remote-status', role: 'status', 'aria-live': 'polite' }, states[remote.state] ?? '请刷新连接状态'),
    remote.error ? h('p', { className: 'dsma-error', role: 'alert' }, remoteErrorMessage(remote.error)) : null,
    kind === 'quick' ? h('div', { className: 'dsma-quick' },
      h('p', null, '启动后生成临时外网地址。停止或地址变化后需要重新扫码；电脑需保持在线。'),
      h('label', { className: 'dsma-consent' }, h('input', { type: 'checkbox', 'aria-label': '确认临时外网访问', checked: confirmed, disabled: state.busy || active || remote.quickAvailable === false, onChange: event => setConfirmed(event.target.checked) }), h('span', null, '我确认通过临时地址开放手机连接。')),
      h('button', { type: 'button', className: 'dsma-primary', disabled: !confirmed || state.busy || active || remote.quickAvailable === false, onClick: startQuick }, remote.state === 'error' ? '重试临时隧道' : '启动临时隧道'),
      remote.quickAvailable === false ? h('p', { className: 'dsma-error' }, '请先检查 Bridge 的独立 HTTP loopback 监听配置。') : null,
      h('details', { className: 'dsma-notes' }, h('summary', null, '安装与使用说明'),
        h('p', null, '首次使用需安装 cloudflared。临时隧道由 Cloudflare 提供，无在线保证，插件不会自动重启临时隧道。'),
        link('https://developers.cloudflare.com/tunnel/downloads/', '安装 cloudflared（官方指南）'))) :
      h('form', { 'aria-label': '配置自有域名隧道', onSubmit: saveOwn },
        h('label', { className: 'dsma-field' }, h('span', null, '完整 HTTPS 地址'), h('input', { 'aria-label': 'HTTPS 入口地址', type: 'url', required: true, autoComplete: 'off', spellCheck: false, placeholder: 'https://phone.example.com', value: url, disabled: state.busy, maxLength: 2048, onChange: event => { setUrl(event.target.value); setNotice('') } })),
        h('label', { className: 'dsma-field' }, h('span', null, '隧道运行方式'), h('select', { 'aria-label': '自有域名隧道运行方式', value: mode === 'existing' ? 'fixed' : mode, disabled: state.busy, onChange: event => { controller.clearPairing(); setMode(event.target.value); setUrl(savedUrl(remote, event.target.value)); setToken(''); setNotice('') } },
          h('option', { value: 'named' }, '由插件运行 Cloudflare 隧道'), h('option', { value: 'fixed' }, '我已运行隧道或 HTTPS 入口'))),
        mode === 'named' ? h('label', { className: 'dsma-field' }, h('span', null, 'Cloudflare 隧道 Token'), h('input', { 'aria-label': 'Cloudflare 隧道 Token', type: 'password', autoComplete: 'new-password', spellCheck: false, placeholder: remote.tokenSet ? '已保存，留空则不修改' : '从 Cloudflare 后台复制隧道 Token', value: token, disabled: state.busy, maxLength: 4096, onChange: event => setToken(event.target.value) })) : null,
        h('button', { type: 'submit', className: 'dsma-primary', disabled: state.busy || mode === 'named' && remote.namedAvailable === false }, state.busy ? '正在连接…' : mode === 'named' ? '保存并连接隧道' : '保存入口'),
        notice ? h('p', { className: 'dsma-ok', role: 'status' }, notice) : null,
        h('details', { className: 'dsma-notes' }, h('summary', null, '配置与存储说明'),
          h('p', null, 'Cloudflare 后台的 Service URL 指向本插件 Bridge：', remote.loopbackUrl ? h('code', null, remote.loopbackUrl) : '请先初始化 Bridge。'),
          mode === 'named' ? h('p', null, '插件托管隧道需要固定非零端口。Token 以明文保存在本机 Bridge 目录，POSIX 文件权限为 0600；请限制其他用户访问。') : h('p', null, '请先自行运行隧道或反向代理。保存只检查地址格式，不会验证外网可达性。'),
          mode === 'named' && remote.namedAvailable === false ? h('p', null, remoteErrorMessage('NAMED_FIXED_PORT_REQUIRED')) : null,
          link('https://dash.cloudflare.com/', '打开 Cloudflare 后台'))),
    ['quick', 'named'].includes(remote.mode) && (active || remote.state === 'error') ? h('div', { className: 'dsma-actions dsma-stop' }, h('button', { type: 'button', className: 'dsma-danger', disabled: stopping, onClick: () => controller.stopRemote() }, stopping ? '正在停止…' : '停止隧道')) : null,
    h('p', { className: 'dsma-small' }, '切换方式会让本次二维码失效；已配对手机的授权会保留。'))
}

export function ConnectionModePanel({ state, controller }) {
  const relay = state.status?.relay
  const [choice, setChoice] = useState(relay?.mode === 'direct' ? 'direct' : 'official')
  useEffect(() => { if (relay?.mode) setChoice(relay.mode === 'direct' ? 'direct' : 'official') }, [relay?.mode, relay?.official])
  const choose = next => {
    if (next === choice) return
    setChoice(next)
    controller.clearPairing()
    if (next === 'official') void controller.useOfficial()
    else void controller.selectMode('direct')
  }
  const option = (mode, label, detail) => h('label', { className: 'dsma-mode', 'data-selected': choice === mode },
    h('input', { type: 'radio', name: 'dsma-connection-mode', value: mode, checked: choice === mode, disabled: state.busy, onChange: () => choose(mode) }),
    h('span', null, h('strong', null, label), h('small', null, detail)))
  return h('div', null,
    h('div', { className: 'dsma-modes', role: 'radiogroup', 'aria-label': '手机连接方式' },
      option('official', '官方登录', '连接就绪后直接扫码'), option('direct', '隧道连接', '临时隧道或自己的域名')),
    choice === 'official' ? h(RelayPanel, { state, controller }) : h(RemoteConnectionPanel, { state, controller }))
}
