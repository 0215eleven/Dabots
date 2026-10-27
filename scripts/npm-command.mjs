import { existsSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'

// npm.cmd cannot be spawned directly on Windows. Invoke npm's JS entry with
// Node instead of routing paths/arguments through a command shell.
export function npmCommand(args) {
  if (process.env.npm_execpath) return [process.execPath, [process.env.npm_execpath, ...args]]
  if (process.platform !== 'win32') return ['npm', args]
  const directories = [dirname(process.execPath), ...(process.env.PATH ?? '').split(delimiter)]
  const cli = directories.map(directory => join(directory, 'node_modules/npm/bin/npm-cli.js')).find(path => existsSync(path))
  if (!cli) throw Error('npm CLI not found; run this script with npm run')
  return [process.execPath, [cli, ...args]]
}
