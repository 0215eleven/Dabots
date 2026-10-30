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
  return { render, renderSetup, find, nodes, text, calls, state }
}
const quick = { mode: 'quick', state: 'stopped', url: null, configuredUrl: '', configuredUrls: { existing: 'https://old.example', fixed: 'https://fixed.example' }, loopbackUrl: 'http://127.0.0.1:8123', quickAvailable: true, revision: 0, error: null }

test('remote settings mount without starting and require a fresh checkbox confirmation', () => {
  const ui = harness(quick)
  ui.render()
  assert.deepEqual(ui.calls, [])
  assert.equal(ui.find('button', '启动临时连接').props.disabled, true)
  ui.find('input', '确认临时外网访问').props.onChange({ target: { checked: true } })
  const start = ui.find('button', '启动临时连接')
  assert.equal(start.props.disabled, false)
  start.props.onClick()
  assert.deepEqual(ui.calls, [['start', true]])
  assert.equal(ui.find('input', '确认临时外网访问').props.checked, false)
})

test('the startup UI always offers stop and does not auto restart on error', () => {
  const ui = harness({ ...quick, state: 'starting' }, true)
  const stop = ui.find('button', '停止临时连接')
  assert.equal(stop.props.disabled, false)
  stop.props.onClick()
  assert.deepEqual(ui.calls, [['stop']])
  ui.state.status.remote = { ...quick, state: 'error', error: 'MISSING_CLOUDFLARED' }
  ui.state.busy = false; ui.state.operation = null
  const tree = ui.render()
  assert.ok(ui.text(tree).includes('未找到 cloudflared'))
  assert.deepEqual(ui.calls, [['stop']])
  assert.equal(ui.find('a', '安装 cloudflared（官方指南）').props.href, 'https://developers.cloudflare.com/tunnel/downloads/')
})

test('mode selection restores its saved URL and fixed-mode saving reports success without starting a tunnel', async () => {
  const ui = harness(quick)
  ui.render()
  ui.find('select', '远程连接方式').props.onChange({ target: { value: 'fixed' } })
  assert.deepEqual(ui.calls, [])
  assert.equal(ui.find('input', 'HTTPS 入口地址').props.value, 'https://fixed.example')
  ui.find('input', 'HTTPS 入口地址').props.onChange({ target: { value: 'https://new.example' } })
  await ui.find('form', '配置远程入口').props.onSubmit({ preventDefault() {} })
  assert.deepEqual(ui.calls, [['configure', 'fixed', 'https://new.example', '']])
  assert.ok(ui.text(ui.render()).includes('已保存并生效：https://new.example'))
  assert.ok(ui.text(ui.render()).includes('只检查地址格式'))
  assert.equal(ui.find('a', '打开 Cloudflare 后台').props.href, 'https://dash.cloudflare.com/')
  assert.equal(ui.find('a', '查看隧道配置步骤').props.href, 'https://developers.cloudflare.com/tunnel/get-started/')
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

test('switching mode or refreshing the current remote state clears exposure confirmation', () => {
  const ui = harness(quick)
  ui.render()
  ui.find('input', '确认临时外网访问').props.onChange({ target: { checked: true } })
  ui.find('select', '远程连接方式').props.onChange({ target: { value: 'existing' } })
  ui.find('select', '远程连接方式').props.onChange({ target: { value: 'quick' } })
  assert.equal(ui.find('input', '确认临时外网访问').props.checked, false)
  ui.find('input', '确认临时外网访问').props.onChange({ target: { checked: true } })
  ui.state.status.remote = { ...quick, revision: 1 }
  ui.render()
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
  assert.ok(fallback.includes('启用 DeepSeek Bot Pro Bridge'))
  assert.equal(fallback.includes('remote-cleanup-required.json'), false)
  assert.equal(fallback.includes('untrusted server diagnostic'), false)
})
