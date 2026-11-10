import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronPath = (await import('electron')).default;
const distIndex = path.join(ROOT, 'web', 'dist', 'index.html');

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

if (!fs.existsSync(distIndex)) {
  console.log('[start] web/dist not found, building…');
  const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  await new Promise((resolve, reject) => {
    const build = spawn(process.execPath, [vite, 'build', '--config', path.join(ROOT, 'web', 'vite.config.ts')], {
      stdio: 'inherit',
      cwd: ROOT,
    });
    build.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`build failed (${code})`))));
  });
}

const child = spawn(electronPath, [ROOT], {
  stdio: 'inherit',
  cwd: ROOT,
  env: cleanEnv({ NODE_ENV: 'production' }),
});
child.on('exit', (code) => process.exit(code ?? 0));
