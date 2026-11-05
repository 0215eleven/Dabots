// Keep the actual DSH 0.2.2 receipt boundary in the normal integration/CI gate.
// The existing integration command first exercises the legacy 0.2.1 fixture.
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const deps = resolve(import.meta.dirname, '../fixture/deps-022/node_modules')
const manifest = JSON.parse(await readFile(resolve(deps, '@deepseek-ai/dsh/package.json'), 'utf8'))
if (manifest.version !== '0.2.2-rc.1') throw Error('Run test:prepare for the pinned public DSH 0.2.2-rc.1 fixture')
const result = spawnSync(process.execPath, [resolve(import.meta.dirname, 'large-upload.integration.mjs')], {
  env: { ...process.env, BRIDGE_TEST_DEPS: deps }, stdio: 'inherit', timeout: 180000, windowsHide: true,
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
