const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

exports.name = 'lobster-ai';

const LOG_FILE = '/tmp/lobster-harness.log';
let child = null;

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try { fs.appendFileSync(LOG_FILE, line, 'utf8'); } catch {}
  console.log(`[Lobster AI] ${message}`);
}

function findLocalProject() {
  const candidates = [
    '/Users/u/lobster-ai-desktop/lobster-ai-desktop',
    '/Users/u/lobster-ai-desktop',
    path.join(process.env.HOME || '', 'lobster-ai-desktop', 'lobster-ai-desktop'),
    path.join(process.env.HOME || '', 'lobster-ai-desktop')
  ];

  for (const dir of candidates) {
    if (!dir) continue;
    const pkg = path.join(dir, 'package.json');
    const main = path.join(dir, 'main.js');
    if (fs.existsSync(pkg) && fs.existsSync(main)) return dir;
  }
  return null;
}

function launchLocalProject(projectDir) {
  log(`Launching local project: ${projectDir}`);

  // Use macOS Terminal so Electron runs in a normal desktop session.
  const command = `cd ${JSON.stringify(projectDir)} && npm start`;
  child = spawn('/usr/bin/open', ['-a', 'Terminal', '--args', '-e', command], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
}

function launchBundledElectron() {
  log('Local project not found; trying bundled Electron');
  const electronPath = require('electron');
  const appEntry = path.join(__dirname, 'main.js');

  child = spawn(electronPath, [appEntry], {
    cwd: __dirname,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore']
  });
  child.unref();
}

exports.apply = function apply(ctx) {
  log(`Plugin apply() called. cwd=${process.cwd()} dirname=${__dirname}`);

  try {
    const projectDir = findLocalProject();
    if (projectDir) {
      launchLocalProject(projectDir);
    } else {
      launchBundledElectron();
    }

    if (ctx && typeof ctx.effect === 'function') {
      ctx.effect(() => () => {
        log('Plugin disposed');
        if (child && !child.killed) {
          try { child.kill(); } catch {}
        }
      });
    }
  } catch (error) {
    log(`Launch failed: ${error && error.stack ? error.stack : String(error)}`);
    throw error;
  }
};
