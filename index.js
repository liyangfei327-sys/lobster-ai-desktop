import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export const name = 'lobster-ai'

const LOG_FILE = '/tmp/lobster-harness.log'
let child = null

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`
  try { fs.appendFileSync(LOG_FILE, line, 'utf8') } catch {}
  console.log(`[Lobster AI] ${message}`)
}

function findLocalProject() {
  const home = process.env.HOME || ''
  const candidates = [
    '/Users/u/lobster-ai- desktop/lobster-ai-desktop',
    '/Users/u/lobster-ai- desktop',
    '/Users/u/lobster-ai-desktop/lobster-ai-desktop',
    '/Users/u/lobster-ai-desktop',
    path.join(home, 'lobster-ai- desktop', 'lobster-ai-desktop'),
    path.join(home, 'lobster-ai- desktop'),
    path.join(home, 'lobster-ai-desktop', 'lobster-ai-desktop'),
    path.join(home, 'lobster-ai-desktop')
  ]

  for (const dir of candidates) {
    if (!dir) continue
    const pkg = path.join(dir, 'package.json')
    const main = path.join(dir, 'main.js')
    if (fs.existsSync(pkg) && fs.existsSync(main)) {
      log(`Found Lobster project: ${dir}`)
      return dir
    }
  }
  return null
}

function escapeAppleScriptString(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
}

function launchLocalProject(projectDir) {
  log(`Launching local project: ${projectDir}`)
  const shellCommand = `cd ${JSON.stringify(projectDir)} && npm start`
  const script = `tell application "Terminal" to do script "${escapeAppleScriptString(shellCommand)}"`

  child = spawn('/usr/bin/osascript', ['-e', script], {
    detached: true,
    stdio: 'ignore'
  })

  child.on('error', (error) => {
    log(`osascript spawn error: ${error.stack || error}`)
  })

  child.unref()
}

export function apply(ctx) {
  log(`Plugin apply() called. cwd=${process.cwd()}`)

  try {
    const projectDir = findLocalProject()

    if (!projectDir) {
      log('Local Lobster project not found. Checked common paths under HOME.')
      return
    }

    launchLocalProject(projectDir)

    if (ctx && typeof ctx.effect === 'function') {
      ctx.effect(() => () => {
        log('Plugin disposed')
        if (child && !child.killed) {
          try { child.kill() } catch {}
        }
      })
    }
  } catch (error) {
    log(`Launch failed: ${error && error.stack ? error.stack : String(error)}`)
    throw error
  }
}
