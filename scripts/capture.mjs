import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronPath = (await import('electron')).default;
const entry = path.join(ROOT, 'electron', 'capture-main.cjs');
const dataDir = path.join(ROOT, 'artifacts', 'capture-data');

if (process.env.CAPTURE_KEEP_DATA !== '1') {
  fs.rmSync(dataDir, { recursive: true, force: true });
}
fs.mkdirSync(path.join(ROOT, 'artifacts', 'screenshots'), { recursive: true });

const env = { ...process.env, READSCOPE_CAPTURE: '1' };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, [entry], {
  stdio: 'inherit',
  cwd: ROOT,
  env,
});
child.on('exit', (code) => process.exit(code ?? 0));
