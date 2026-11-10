import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VITE = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const VITE_URL = 'http://127.0.0.1:5173';

const children = [];

function run(command, args, options = {}) {
  const child = spawn(command, args, { stdio: 'inherit', cwd: ROOT, ...options });
  children.push(child);
  return child;
}

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    /* ignore */
  }
}

function cleanup() {
  for (const child of [...children].reverse()) killTree(child);
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

async function waitForVite() {
  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(VITE_URL, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      /* not ready */
    }
    await sleep(300);
  }
  throw new Error('Vite dev server did not start in 24s');
}

async function main() {
  const electronPath = (await import('electron')).default;
  console.log('[dev] starting vite…');
  const vite = run(process.execPath, [VITE, '--config', path.join(ROOT, 'web', 'vite.config.ts')]);
  await waitForVite();
  console.log(`[dev] vite ready at ${VITE_URL}, launching electron…`);

  const electron = run(electronPath, [ROOT], {
    env: cleanEnv({ VITE_DEV_SERVER_URL: VITE_URL, PORT: process.env.PORT || '7411' }),
  });

  electron.on('exit', (code) => {
    killTree(vite);
    process.exit(code ?? 0);
  });
  vite.on('exit', (code) => {
    if (code && !electron.killed) {
      console.error(`[dev] vite exited with ${code}`);
      killTree(electron);
      process.exit(code);
    }
  });
}

main().catch((error) => {
  console.error('[dev] failed:', error);
  cleanup();
  process.exit(1);
});
