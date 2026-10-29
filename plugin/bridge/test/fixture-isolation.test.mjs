import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { launchFixture } from './fixture-host.mjs'
import { fixtureEnvironment } from './fixture-environment.mjs'

test('isolated package installation retains proxy and CA routing without application credentials', async t => {
  const area = resolve(import.meta.dirname, '../fixture')
  await mkdir(area, { recursive: true })
  const home = await mkdtemp(join(area, 'network-isolation-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const environment = await fixtureEnvironment(home, {
    PATH: process.env.PATH, HTTPS_PROXY: 'http://127.0.0.1:9080', NO_PROXY: '127.0.0.1,localhost',
    NODE_EXTRA_CA_CERTS: '/fixture/public-ca.pem',
    EXPO_TOKEN: 'synthetic-private-token', MODEL_API_KEY: 'synthetic-private-model-key',
    HOME: '/outside-profile', DSH_HOME: '/outside-dsh',
  })
  assert.equal(environment.HTTPS_PROXY, 'http://127.0.0.1:9080')
  assert.equal(environment.NO_PROXY, '127.0.0.1,localhost')
  assert.equal(environment.NODE_EXTRA_CA_CERTS, '/fixture/public-ca.pem')
  assert.equal(environment.EXPO_TOKEN, undefined)
  assert.equal(environment.MODEL_API_KEY, undefined)
  assert.equal(environment.HOME, home)
  assert.equal(environment.DSH_HOME, home)
})

test('isolated fixture copies source without following dependency directories', async t => {
  const area = resolve(import.meta.dirname, '../fixture')
  await mkdir(area, { recursive: true })
  const input = await mkdtemp(join(area, 'isolation-test-'))
  const source = join(input, 'source'), deps = join(input, 'deps')
  await mkdir(join(source, 'node_modules'), { recursive: true })
  await mkdir(join(deps, '@deepseek-ai/dsh/lib'), { recursive: true })
  await writeFile(join(source, 'index.js'), 'fixture source')
  await writeFile(join(source, 'node_modules/should-not-copy'), 'dependency data')
  await writeFile(join(deps, '@deepseek-ai/dsh/package.json'), JSON.stringify({ version: '0.2.1-rc.2' }))
  // The synthetic host exits immediately. Startup fails after file setup,
  // allowing this test to inspect the real launcher without running DSH.
  await writeFile(join(deps, '@deepseek-ai/dsh/lib/bin.js'), `
    const { writeFileSync } = require('node:fs')
    const { join } = require('node:path')
    const { homedir, tmpdir } = require('node:os')
    writeFileSync(join(process.env.DSH_HOME, 'observed-env.json'), JSON.stringify({ home: homedir(), temp: tmpdir() }))
    process.exit(0)
  `)
  const previous = { bot: process.env.BRIDGE_TEST_BOT, deps: process.env.BRIDGE_TEST_DEPS }
  let home
  t.after(async () => {
    for (const directory of [home, input].filter(Boolean)) {
      const target = resolve(directory)
      assert.ok(target.startsWith(area + sep))
      await rm(target, { recursive: true, force: true })
    }
  })
  process.env.BRIDGE_TEST_BOT = source
  process.env.BRIDGE_TEST_DEPS = deps
  try {
    await assert.rejects(launchFixture(), error => { home = error.fixtureHome; return typeof home === 'string' })
  } finally {
    if (previous.bot === undefined) delete process.env.BRIDGE_TEST_BOT; else process.env.BRIDGE_TEST_BOT = previous.bot
    if (previous.deps === undefined) delete process.env.BRIDGE_TEST_DEPS; else process.env.BRIDGE_TEST_DEPS = previous.deps
  }
  assert.equal(await readFile(join(home, 'profiles/web/node_modules/ds-bot/index.js'), 'utf8'), 'fixture source')
  await assert.rejects(readFile(join(home, 'profiles/web/node_modules/ds-bot/node_modules/should-not-copy')), { code: 'ENOENT' })
  assert.equal(JSON.parse(await readFile(join(home, 'profiles/web/node_modules/@deepseek-ai/dsh/package.json'), 'utf8')).version, '0.2.1-rc.2')
  const environment = JSON.parse(await readFile(join(home, 'observed-env.json'), 'utf8'))
  assert.equal(environment.home, home)
  assert.equal(environment.temp, join(home, 'tmp'))
})
