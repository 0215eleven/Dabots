import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
async function repository(t) {
  const directory = await mkdtemp(join(tmpdir(), 'bridge pack 空格 # '))
  t.after(async () => {
    const target = resolve(directory)
    assert.ok(target.startsWith(resolve(tmpdir()) + sep))
    assert.ok(target.split(sep).at(-1).startsWith('bridge pack 空格 # '))
    await rm(target, { recursive: true, force: true })
  })
  await cp(join(root, 'plugin/scripts'), join(directory, 'plugin/scripts'), { recursive: true })
  await mkdir(join(directory, 'plugin/bridge'))
  await writeFile(join(directory, '.gitignore'), 'artifacts/\n')
  await writeFile(join(directory, 'plugin/bridge/package.json'), JSON.stringify({ name: 'bridge-pack-fixture', version: '0.0.1', files: ['index.mjs', 'LICENSE', 'NOTICE', 'README.md'] }))
  for (const file of ['index.mjs', 'LICENSE', 'NOTICE', 'README.md']) await writeFile(join(directory, 'plugin/bridge', file), `fixture ${file}\n`)
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr || result.error?.message)
    return result.stdout.trim()
  }
  git('init', '--quiet')
  git('add', '.')
  git('-c', 'user.name=Bridge Test', '-c', 'user.email=bridge-test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Fixture source')
  return { directory, git }
}
const pack = directory => spawnSync(process.execPath, [join(directory, 'plugin/scripts/pack-bridge.mjs')], {
  cwd: directory, encoding: 'utf8', env: { ...process.env, npm_config_cache: join(directory, 'artifacts/npm-cache') }, timeout: 60_000,
})

test('pack bridge preserves filesystem paths and records exact archive provenance', async t => {
  const { directory, git } = await repository(t)
  const result = pack(directory)
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  const release = JSON.parse(await readFile(join(directory, 'artifacts/release.json'), 'utf8'))
  assert.equal(release.filename, 'bridge-pack-fixture-0.0.1.tgz')
  assert.equal(release.commit, git('rev-parse', 'HEAD'))
  const archive = await readFile(join(directory, 'artifacts', release.filename))
  assert.equal(release.sha256, createHash('sha256').update(archive).digest('hex'))
  assert.equal(await readFile(join(directory, 'artifacts/SHA256SUMS'), 'utf8'), `${release.sha256}  ${release.filename}\n`)
  const members = spawnSync('tar', ['-tzf', join(directory, 'artifacts', release.filename)], { encoding: 'utf8' })
  assert.equal(members.status, 0, members.stderr)
  assert.deepEqual(members.stdout.trim().split(/\r?\n/).sort(), ['package/LICENSE', 'package/NOTICE', 'package/README.md', 'package/index.mjs', 'package/package.json'].sort())
  assert.equal(git('status', '--porcelain'), '')
})

test('pack bridge refuses uncommitted source before creating a release', async t => {
  const { directory } = await repository(t)
  await writeFile(join(directory, 'plugin/bridge/index.mjs'), 'uncommitted change\n')
  const result = pack(directory)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Commit all source and documentation before packaging/)
  await assert.rejects(readFile(join(directory, 'artifacts/release.json')), { code: 'ENOENT' })
})
