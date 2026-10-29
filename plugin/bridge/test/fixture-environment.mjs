import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export async function fixtureEnvironment(home) {
  const temporary = join(home, 'tmp'), roaming = join(home, 'AppData/Roaming'), local = join(home, 'AppData/Local')
  await Promise.all([temporary, roaming, local].map(path => mkdir(path, { recursive: true })))
  return {
    ...Object.fromEntries(['PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'ComSpec'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]])),
    HOME: home, USERPROFILE: home, DSH_HOME: home, APPDATA: roaming, LOCALAPPDATA: local,
    TEMP: temporary, TMP: temporary, TMPDIR: temporary, LANG: 'en_US.UTF-8',
  }
}
