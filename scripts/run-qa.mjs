import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] || 'compact-qa';
if (!['compact-qa', 'recommendation-smoke', 'reference-layout-qa', 'desktop-flash-qa', 'manual-books-qa'].includes(target)) throw new Error('Unknown QA script');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [path.join(root, 'scripts', `${target}.cjs`)], {
  cwd: root, env, stdio: 'ignore', windowsHide: true,
});
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => {
  const directory = target === 'manual-books-qa' ? 'manual-books-qa' : target === 'desktop-flash-qa' ? 'desktop-flash-qa/' + (env.READSCOPE_FLASH_VARIANT || 'fixed') : target === 'reference-layout-qa' ? 'reference-layout-qa' : target === 'compact-qa' ? 'compact-qa' : 'recommendation-smoke';
  try {
    const reportFile = target === 'compact-qa' && env.READSCOPE_QA_PREVIEWS_ONLY === '1' ? 'capture-summary.json' : 'summary.json';
    const report = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', directory, reportFile), 'utf8'));
    console.log(JSON.stringify({ target, exitCode: code, passed: report.passed, failed: report.failed }));
    if (code) console.log(fs.readFileSync(path.join(root, 'artifacts', directory, 'run.log'), 'utf8').split('\n').slice(-12).join('\n'));
  } catch { console.log(`${target} exited with ${code}; inspect artifacts/${directory}/run.log`); }
  process.exitCode = code ?? 1;
});
process.stdout.on('error', (error) => { if (error.code !== 'EPIPE') process.exitCode = 1; });
process.stderr.on('error', () => {});
