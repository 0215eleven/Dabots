// Download public fixtures into this package's ignored directory only.
import { spawnSync } from 'node:child_process'
import { mkdir, writeFile, cp, readFile, symlink } from 'node:fs/promises'
import { resolve, join, relative, sep } from 'node:path'
import { npmCommand } from '../../scripts/npm-command.mjs'
const root = resolve(import.meta.dirname, '..'), fixture = join(root, 'fixture')
const run = (cmd, args, cwd, input) => {
  const result = spawnSync(...(cmd === 'npm' ? npmCommand(args) : [cmd, args]), {cwd, input, encoding: 'utf8', timeout: 600_000, windowsHide: true})
  if (result.status !== 0) throw Object.assign(Error(`Fixture command failed: ${cmd}`), { code: result.error?.code ?? `COMMAND_${result.status}` })
  return result.stdout
}
await mkdir(join(fixture, 'deps'), {recursive: true})
await writeFile(join(fixture, 'deps/package.json'), JSON.stringify({private: true, dependencies: {'@deepseek-ai/dsh': '0.2.1-rc.2', jsdom: '29.1.1', oxlint: '1.76.0'}}))
run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org'], join(fixture, 'deps'))
const packed = JSON.parse(run('npm', ['pack', 'ds-bot@0.1.7', '--ignore-scripts', '--json', '--registry=https://registry.npmjs.org', '--pack-destination', fixture], root))[0]
if (packed.integrity !== 'sha512-xRiXIpDfemkZ2l6lDwu7ZKSnn0a2c26BsZ7e+eEOkQ1AknXOKretK52Yuq1yfG6p4XCObmUiXR1tdGo7EQIStw==') throw Error('Unexpected public DS Bot integrity')
const vanilla = join(fixture, 'vanilla'), extended = join(fixture, 'extended')
await mkdir(vanilla, {recursive: true})
run('tar', ['-xzf', join(fixture, packed.filename), '-C', vanilla], root)
const manifest = JSON.parse(await readFile(join(vanilla, 'package/package.json'), 'utf8'))
if (manifest.name !== 'ds-bot' || manifest.version !== '0.1.7') throw Error('Unexpected fixture package')
const vanillaPackage = join(vanilla, 'package')
await cp(vanillaPackage, join(extended, 'package'), {recursive: true, filter: source => !relative(vanillaPackage, source).split(sep).includes('node_modules')})
const patch = await readFile(resolve(root, '../test-support/patches/ds-bot-0.1.7-groups.patch'), 'utf8')
run('git', ['apply', '--no-index', '-'], join(extended, 'package'), patch.replaceAll('\r\n', '\n'))
for (const dir of [vanilla, extended]) {
  try { await symlink(join(fixture, 'deps/node_modules'), join(dir, 'package/node_modules'), process.platform === 'win32' ? 'junction' : 'dir') } catch (error) { if (error.code !== 'EEXIST') throw error }
}
console.log('Prepared public DSH 0.2.1-rc.2 and pristine/reviewed DS Bot 0.1.7 fixtures; no user profile used.')
