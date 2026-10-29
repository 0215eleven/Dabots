import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export async function fixtureEnvironment(home, source = process.env) {
  const temporary = join(home, 'tmp'), roaming = join(home, 'AppData/Roaming'), local = join(home, 'AppData/Local')
  await Promise.all([temporary, roaming, local].map(path => mkdir(path, { recursive: true })))
  return {
    // Routing and public CA trust are required by isolated package-manager
    // subprocesses in managed environments. Application credentials stay out.
    ...Object.fromEntries([
      'PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'ComSpec',
      'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
      'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
      'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
      'CURL_CA_BUNDLE', 'REQUESTS_CA_BUNDLE', 'NPM_CONFIG_CAFILE', 'npm_config_cafile',
    ].filter(key => source[key] !== undefined).map(key => [key, source[key]])),
    HOME: home, USERPROFILE: home, DSH_HOME: home, APPDATA: roaming, LOCALAPPDATA: local,
    TEMP: temporary, TMP: temporary, TMPDIR: temporary, LANG: 'en_US.UTF-8',
  }
}
