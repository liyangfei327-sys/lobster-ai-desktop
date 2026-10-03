const { spawn } = require('child_process');
const path = require('path');

let child = null;

exports.name = 'lobster-ai';

exports.apply = function apply(ctx) {
  try {
    const electronPath = require('electron');
    const appEntry = path.join(__dirname, 'main.js');

    child = spawn(electronPath, [appEntry], {
      cwd: __dirname,
      detached: true,
      stdio: 'ignore'
    });

    child.unref();
    console.log('[Lobster AI] Desktop pet launched');
  } catch (error) {
    console.error('[Lobster AI] Failed to launch desktop pet:', error);
  }
};

exports.dispose = function dispose() {
  if (child && !child.killed) {
    try { child.kill(); } catch {}
  }
};
