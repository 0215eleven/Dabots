import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

function harness(initialRemote, initialBusy = false) {
  let exports, index = 0, effects = []
  const hooks = [], calls = []
  const state = { status: { enabled: true, remote: initialRemote, url: initialRemote.url }, busy: initialBusy, operation: initialBusy ? 'remote.start' : null }
  const controller = {
    configureRemote: (mode, url, token) => {
      calls.push(['configure', mode, url, token])
      state.status.remote = { ...state.status.remote, mode, configuredUrl: url, configuredUrls: { ...state.status.remote.configuredUrls, [mode]: url } }
    },
    snapshot: () => state,
    startRemote: (...args) => calls.push(['start', ...args]),
    stopRemote: () => calls.push(['stop']),
    clearPairing: () => calls.push(['cancel']),
    useOfficial: () => calls.push(['official']),
    selectMode: mode => calls.push(['select', mode]),
  }
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.flat() } }),
    useState(value) { const current = index++; if (!(current in hooks)) hooks[current] = typeof value === 'function' ? value() : value; return [hooks[current], next => { hooks[current] = typeof next === 'function' ? next(hooks[current]) : next }] },
    useEffect(fn, deps) { const current = index++; if (!hooks[current] || deps.some((value, offset) => hooks[current][offset] !== value)) { hooks[current] = deps; effects.push(fn) } },
    useMemo: fn => fn(),
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
  }
  vm.runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), { URL, AbortController, window: { __ModuleLoader__: { load(definition) { exports = definition.factory(name => name === 'react-dom' ? { createPortal() {} } : react) } } } })
  const render = () => {
    assert.equal(typeof exports.RemoteConnectionPanel, 'function', 'remote settings must be part of the shipped UI bundle')
    index = 0
    const result = exports.RemoteConnectionPanel({ state, controller })
    const pending = effects; effects = []; pending.forEach(effect => effect())
    return result
  }
  const nodes = (node, predicate) => [node && typeof node === 'object' && predicate(node) ? node : null, ...(node?.props?.children ?? []).flatMap(child => child && typeof child === 'object' ? nodes(child, predicate) : [])].filter(Boolean)
  const text = node => typeof node === 'string' ? node : (node?.props?.children ?? []).map(text).join('')
  const find = (type, label) => { const tree = render(); return nodes(tree, node => node.type === type && (node.props['aria-label'] === label || text(node) === label))[0] }
  const renderSetup = () => {
    assert.equal(typeof exports.BridgeSetupNotice, 'function', 'disabled Bridge states must render their own recovery guidance')
    return exports.BridgeSetupNotice({ status: state.status })
  }
  const renderDevices = () => { index = 0; return exports.DevicesPage({ controller }) }
  const renderRelay = () => { index = 0; return exports.RelayPanel({ state, controller }) }
  const renderMode = () => { index = 0; const tree = exports.ConnectionModePanel({ state, controller }); const pending = effects; effects = []; pending.forEach(effect => effect()); return tree }
  return { render, renderSetup, renderDevices, renderRelay, renderMode, find, nodes, text, calls, state, isConnectionPanel: node => node.type === exports.ConnectionModePanel }
}
const quick = { mode: 'quick', state: 'stopped', url: null, configuredUrl: '', configuredUrls: { existing: 'https://old.example', fixed: 'https://fixed.example' }, loopbackUrl: 'http://127.0.0.1:8123', quickAvailable: true, revision: 0, error: null }

test('temporary tunnel starts only after fresh owner confirmation and never on mount', async () => {
  const ui = harness(quick)
  ui.render()
  assert.deepEqual(ui.calls, [])
  assert.equal(ui.find('button', '启动临时隧道').props.disabled, true)
  ui.find('input', '确认临时外网访问').props.onChange({ target: { checked: true } })
  const start = ui.find('button', '启动临时隧道')
  assert.equal(start.props.disabled, false)
  await start.props.onClick()
  assert.deepEqual(ui.calls, [['start', true]])
  assert.equal(ui.find('input', '确认临时外网访问').props.checked, false)
})

test('startup always offers stop and a failed temporary tunnel waits for owner retry', () => {
  const ui = harness({ ...quick, state: 'starting' }, true)
  const stop = ui.find('button', '停止隧道')
  assert.equal(stop.props.disabled, false)
  stop.props.onClick()
  ui.state.status.remote = { ...quick, state: 'error', error: 'MISSING_CLOUDFLARED' }
  ui.state.busy = false; ui.state.operation = null
  assert.ok(ui.text(ui.render()).includes('未找到 cloudflared'))
  assert.deepEqual(ui.calls, [['stop']])
  assert.equal(ui.find('a', '安装 cloudflared（官方指南）').props.href, 'https://developers.cloudflare.com/tunnel/downloads/')
})

test('own domain groups managed and existing transport beneath a single tunnel choice', async () => {
  const ui = harness(quick)
  ui.render()
  const options = ui.nodes(ui.render(), node => node.props.className === 'dsma-tunnel-option')
  assert.equal(options.length, 2)
  assert.ok(ui.text(options[0]).includes('临时隧道'))
  assert.ok(ui.text(options[1]).includes('自有域名隧道'))
  options[1].props.onClick()
  ui.find('select', '自有域名隧道运行方式').props.onChange({ target: { value: 'fixed' } })
  assert.equal(ui.find('input', 'HTTPS 入口地址').props.value, 'https://fixed.example')
  ui.find('input', 'HTTPS 入口地址').props.onChange({ target: { value: 'https://new.example' } })
  await ui.find('form', '配置自有域名隧道').props.onSubmit({ preventDefault() {} })
  assert.deepEqual(ui.calls, [['cancel'], ['cancel'], ['configure', 'fixed', 'https://new.example', '']])
  assert.ok(ui.text(ui.render()).includes('入口已保存'))
  assert.ok(ui.text(ui.render()).includes('只检查地址格式'))
  assert.ok(ui.text(ui.render()).includes('http://127.0.0.1:8123'))
})

for (const [error, guidance] of [
  ['TUNNEL_UNAUTHORIZED', ['Cloudflare', '拒绝', '更新', 'Token']],
  ['TUNNEL_STOPPING', ['停止', '稍后', '重试']],
]) {
  test(`named tunnel ${error} renders recovery guidance without starting a connection`, () => {
    const ui = harness({ ...quick, mode: 'named', state: 'error', error,
      configuredUrl: 'https://phone.example.com', tokenSet: true,
      diagnostic: 'private cloudflared diagnostic' })
    const tree = ui.render()
    const alerts = ui.nodes(tree, node => node.props.role === 'alert')
    assert.equal(alerts.length, 1)
    const message = ui.text(alerts[0])
    for (const detail of guidance) assert.ok(message.includes(detail), `${error} must explain ${detail}`)
    assert.equal(message.includes(error), false)
    assert.equal(ui.text(tree).includes('private cloudflared diagnostic'), false)
    assert.deepEqual(ui.calls, [])
  })
}

test('changing tunnel choices or state clears temporary exposure consent', () => {
  const ui = harness(quick)
  ui.render()
  ui.find('input', '确认临时外网访问').props.onChange({ target: { checked: true } })
  let options = ui.nodes(ui.render(), node => node.props.className === 'dsma-tunnel-option')
  options[1].props.onClick()
  options = ui.nodes(ui.render(), node => node.props.className === 'dsma-tunnel-option')
  options[0].props.onClick()
  assert.equal(ui.find('input', '确认临时外网访问').props.checked, false)
  ui.find('input', '确认临时外网访问').props.onChange({ target: { checked: true } })
  ui.state.status.remote = { ...quick, revision: 1 }; ui.render()
  assert.equal(ui.find('input', '确认临时外网访问').props.checked, false)
})

test('a cleanup-blocked Bridge shows manual recovery without echoing unknown server text or offering unsafe actions', () => {
  const ui = harness(quick)
  ui.state.status = { enabled: false, reason: 'REMOTE_CLEANUP_REQUIRED', message: 'untrusted server diagnostic' }
  const tree = ui.renderSetup(), message = ui.text(tree)
  assert.ok(message.includes('cloudflared') && message.includes('确认') && message.includes('已退出'))
  assert.ok(message.includes('专用') && message.includes('remote-cleanup-required.json') && message.includes('手动移除'))
  assert.ok(message.includes('重新启用 Bridge'))
  assert.equal(message.includes('untrusted server diagnostic'), false)
  assert.equal(ui.nodes(tree, node => node.type === 'button').length, 0)
  assert.deepEqual(ui.calls, [])
  ui.state.status = { enabled: false, reason: 'UNKNOWN_PRIVATE_REASON', message: 'untrusted server diagnostic' }
  const fallback = ui.text(ui.renderSetup())
  assert.ok(fallback.includes('安装并启用 Dabots Bridge'))
  assert.equal(fallback.includes('remote-cleanup-required.json'), false)
  assert.equal(fallback.includes('untrusted server diagnostic'), false)
})

test('named mode explains and blocks random-port startup without choosing or occupying a port', () => {
  const ui = harness({ ...quick, mode: 'named', namedAvailable: false, state: 'error', error: 'NAMED_FIXED_PORT_REQUIRED', tokenSet: true })
  const tree = ui.render()
  assert.equal(ui.find('button', '保存并连接隧道').props.disabled, true)
  const message = ui.text(tree)
  assert.ok(message.includes('固定非零端口') && message.includes('重新启用 Bridge') && message.includes('Service URL'))
  assert.equal(ui.nodes(tree, node => node.props.role === 'alert').length, 1)
  assert.deepEqual(ui.calls, [])
})

test('a port conflict shows a safe setup recovery message without exposing server diagnostics', () => {
  const ui = harness(quick)
  ui.state.status = { enabled: false, reason: 'BRIDGE_PORT_IN_USE', message: 'private host diagnostic' }
  const tree = ui.renderSetup()
  const message = ui.text(tree)
  assert.ok(message.includes('端口已被占用') && message.includes('未占用的固定端口'))
  assert.equal(message.includes('private host diagnostic'), false)
  assert.equal(ui.nodes(tree, node => node.type === 'button').length, 0)
  assert.deepEqual(ui.calls, [])
})

test('official entry contains no address, secret or account registration form', () => {
  const ui = harness(quick)
  ui.state.status = { enabled: false, reason: 'OFFICIAL_AVAILABLE' }
  const tree = ui.renderRelay()
  assert.equal(ui.nodes(tree, node => node.type === 'input' || node.type === 'form').length, 0)
  assert.ok(ui.text(tree).includes('无需填写地址、密钥或注册表单'))
  const start = ui.nodes(tree, node => node.type === 'button')[0]
  start.props.onClick()
  assert.deepEqual(ui.calls, [['official']])
})

test('exactly two top-level connection choices are exposed and official is the default', () => {
  const ui = harness(quick)
  ui.state.status = { enabled: false, reason: 'OFFICIAL_AVAILABLE' }
  const tree = ui.renderMode()
  const radios = ui.nodes(tree, node => node.type === 'input' && node.props.type === 'radio')
  assert.equal(radios.length, 2)
  assert.deepEqual(radios.map(node => node.props.value), ['official', 'direct'])
  assert.equal(radios[0].props.checked, true)
  radios[1].props.onChange()
  assert.deepEqual(ui.calls, [['cancel'], ['select', 'direct']])
})

for (const [connectionState, guidance] of [['limited', '额度已满'], ['denied', '拒绝了本次连接']]) {
  test(`official ${connectionState} shows recovery and keeps the page free of registration fields`, () => {
    const ui = harness(quick)
    ui.state.status.relay = { mode: 'relay', official: true, ready: false, state: connectionState }
    const tree = ui.renderRelay()
    assert.ok(ui.text(tree).includes(guidance))
    assert.equal(ui.nodes(tree, node => node.type === 'input').length, 0)
    const retry = ui.nodes(tree, node => node.type === 'button' && ui.text(node) === '重试连接')[0]
    retry.props.onClick()
    assert.deepEqual(ui.calls, [['official']])
  })
}

for (const reason of ['BRIDGE_START_FAILED', 'TEAM_UNAVAILABLE']) {
  test(`${reason} keeps the official and tunnel choices and a safe retry action`, () => {
    const ui = harness(quick)
    ui.state.status = { enabled: false, reason, message: 'private startup diagnostic' }
    assert.equal(ui.nodes(ui.renderDevices(), ui.isConnectionPanel).length, 1)
    const tree = ui.renderRelay()
    assert.equal(ui.text(tree).includes('private startup diagnostic'), false)
    const retry = ui.nodes(tree, node => node.type === 'button')[0]
    retry.props.onClick()
    assert.deepEqual(ui.calls, [['official']])
  })
}
