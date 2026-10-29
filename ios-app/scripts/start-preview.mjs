// Keep the synthetic preview command portable across macOS, Linux and Windows.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const project = fileURLToPath(new URL('../', import.meta.url))
const child = spawn(process.execPath, ['node_modules/expo/bin/cli', 'start', '--web', ...process.argv.slice(2)], {
  cwd: project,
  env: { ...process.env, EXPO_PUBLIC_DS_BOT_DESIGN_PREVIEW: '1' },
  stdio: 'inherit',
})
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exitCode = code ?? 1
})
