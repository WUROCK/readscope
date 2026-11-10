// Visible Windows compositor regression: renderer capturePage/offscreen paint
// cannot detect native erase strips. Record only an isolated test backdrop.
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const variant = process.env.READSCOPE_FLASH_VARIANT || 'fixed';
if (!['baseline', 'fixed'].includes(variant)) throw Error('Use baseline or fixed');
const out = path.join(root, 'artifacts', 'desktop-flash-qa', variant);
fs.mkdirSync(out, { recursive: true });
require('../electron/logging.cjs').installFileLogging(path.join(out, 'run.log'));
const profile = fs.mkdtempSync(path.join(out, 'profile-'));
app.setPath('userData', profile); app.setPath('sessionData', profile);
app.on('window-all-closed', () => {});
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let win, backdrop, server, manager;
const workers = new Set();
function exit(code) { for (const worker of workers) worker.kill(); app.exit(code); }
function launch(args, stdout = 'ignore') {
  const child = spawn(ffmpeg, args, { stdio: ['ignore', stdout, 'pipe'], windowsHide: true });
  workers.add(child);
  child.once('exit', () => workers.delete(child));
  let errorText = '';
  child.stderr.on('data', chunk => { errorText = (errorText + chunk).slice(-4000); });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(Error('ffmpeg: ' + errorText)));
  });
  // Attach a handler while the window exercise runs; awaiting done still throws.
  done.catch(() => {});
  return { child, done };
}
async function inspectMarkers(file) {
  const width = 80, height = 30, bytes = width * height * 3;
  const { child, done } = launch(['-v', 'error', '-i', file, '-vf', 'crop=80:30:0:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], 'pipe');
  let pending = Buffer.alloc(0), frames = 0, coveredFrames = 0;
  child.stdout.on('data', chunk => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= bytes) {
      const frame = pending.subarray(0, bytes);
      let green = 0, pink = 0;
      for (let i = 0; i < bytes; i += 3) {
        const r = frame[i], g = frame[i+1], b = frame[i+2];
        if (g > r + 50 && g > b + 25) green++;
        if (r > g + 60 && b > g + 30) pink++;
      }
      if (green < 40 || pink < 40) coveredFrames++;
      frames++; pending = pending.subarray(bytes);
    }
  });
  await done;
  if (frames < 100 || coveredFrames) throw Error('Test backdrop was covered in ' + coveredFrames + '/' + frames + ' frames');
  return { verifiedDesktopFrames: frames, coveredFrames };
}
async function inspectVideo(file, crop) {
  const width = 160, height = Math.round(crop.height * width / crop.width);
  const { child, done } = launch(['-v', 'error', '-i', file, '-vf',
    'crop=' + crop.width + ':' + crop.height + ':' + crop.x + ':' + crop.y + ',scale=' + width + ':' + height,
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], 'pipe');
  const frameBytes = width * height * 3;
  let pending = Buffer.alloc(0), frames = 0, stripeFrames = 0, texturedFrames = 0;
  const examples = [];
  child.stdout.on('data', chunk => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= frameBytes) {
      const frame = pending.subarray(0, frameBytes);
      let longest = 0, run = 0, detail = false;
      for (let y = 0; y < height; y++) {
        let sum = 0, squares = 0;
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 3;
          const value = (frame[i] + frame[i+1] + frame[i+2]) / 3;
          sum += value; squares += value * value;
          if (value > 100) detail = true;
        }
        const mean = sum / width, deviation = Math.sqrt(Math.max(0, squares / width - mean * mean));
        // Detect a short gray/white horizontal band, not just an all-white frame.
        if (mean > 90 && deviation < 16) { run++; longest = Math.max(longest, run); }
        else run = 0;
      }
      if (detail) texturedFrames++;
      if (longest >= 2) { stripeFrames++; if (examples.length < 12) examples.push({ frame: frames, rows: longest }); }
      frames++;
      pending = pending.subarray(frameBytes);
    }
  });
  await done;
  if (frames < 100 || texturedFrames < 20) throw Error('Desktop recording lacks the expected test contents');
  return { frames, stripeFrames, texturedFrames, examples };
}
async function run() {
  if (process.platform !== 'win32') throw Error('This test requires Windows desktop capture and ffmpeg');
  await app.whenReady();
  const data = fs.mkdtempSync(path.join(out, 'data-'));
  fs.cpSync(path.join(root, 'data', 'seed'), path.join(data, 'seed'), { recursive: true });
  const { startServer } = await import(pathToFileURL(path.join(root, 'server/index.mjs')).href);
  server = await startServer({ port: 0, dataDir: data, fetchImpl: async () => { throw Error('offline QA'); } });
  const base = 'http://127.0.0.1:' + server.port;
  await fetch(base + '/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recommendationSource: 'curated' }) });
  await fetch(base + '/api/books', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '窗口绘制验证', author: '隔离测试数据', domain: 'literature', totalPages: 320, currentPage: 120, tags: [] }) });
  const wm = require('../electron/window-manager.cjs');
  const initialState = wm.createInitialState({}, screen), area = screen.getPrimaryDisplay().workArea;
  initialState.compactBounds = { x: area.x + 80, y: area.y + 40, width: 420, height: 160 };
  initialState.expandedBounds = { ...initialState.compactBounds, height: 630 };
  // Opaque owned backdrop keeps all recorded pixels inside isolated test windows.
  const backdropBounds = { x: area.x + 65, y: area.y + 25, width: 455, height: 670 };
  backdrop = new BrowserWindow({ ...backdropBounds, frame: false, backgroundColor: '#080c10', show: true, focusable: false, webPreferences: { sandbox: true } });
  await backdrop.loadURL('data:text/html,' + encodeURIComponent('<style>html,body{margin:0;background:#080c10}.mark{position:fixed;top:4px;width:14px;height:8px}.a{left:4px;background:#2fdf91}.b{left:24px;background:#f046aa}</style><div class="mark a"></div><div class="mark b"></div>'));
  backdrop.setAlwaysOnTop(true, 'floating');
  const options = { ...wm.getWindowOptions(initialState), show: false, frame: false, thickFrame: true, roundedCorners: true, hasShadow: false, maximizable: false, fullscreenable: false,
    webPreferences: { preload: path.join(root, 'electron/preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false } };
  if (variant === 'baseline') Object.assign(options, { transparent: false, backgroundColor: '#16181b' });
  win = new BrowserWindow(options);
  const state = () => ({ isDesktop: true, pinned: true, ...manager.getState() });
  manager = wm.createWindowManager({ window: win, screen, initialState, onState: () => win.webContents.send('desktop:state', state()) });
  ipcMain.handle('desktop:get-state', state);
  ipcMain.handle('desktop:set-compact', async (_event, compact, options) => { await manager.setCompact(compact, { animate: options?.animate !== false }); return state(); });
  ipcMain.handle('desktop:set-opacity', (_event, opacity) => manager.setOpacity(opacity));
  for (const name of ['hide', 'minimize', 'quit', 'toggle-pin', 'open-external']) ipcMain.handle('desktop:' + name, () => true);
  await win.loadURL(base); win.setAlwaysOnTop(true, 'floating'); win.show(); win.focus();
  const rect = screen.dipToScreenRect(win, backdropBounds);
  const expanded = screen.dipToScreenRect(win, initialState.expandedBounds);
  const crop = { x: expanded.x - rect.x + Math.round(expanded.width * .12),
    y: expanded.y - rect.y + 100, width: Math.round(expanded.width * .76), height: expanded.height - 110 };
  const video = path.join(out, 'desktop.mp4');
  await sleep(800);
  const recording = launch(['-hide_banner', '-loglevel', 'error', '-y', '-f', 'gdigrab', '-framerate', '60',
    '-offset_x', String(rect.x), '-offset_y', String(rect.y), '-video_size', rect.width + 'x' + rect.height,
    '-draw_mouse', '0', '-i', 'desktop', '-t', '12', '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', '-pix_fmt', 'yuv420p', video]);
  await sleep(800);
  const opacities = [.45, .9, 1];
  for (let i = 0; i < 8; i++) {
    manager.setOpacity(opacities[i % opacities.length]);
    await win.webContents.executeJavaScript('window.desktop.setCompact(false,{animate:true})'); await sleep(280);
    await win.webContents.executeJavaScript('window.desktop.setCompact(true,{animate:true})'); await sleep(280);
  }
  await recording.done;
  const markers = await inspectMarkers(video);
  const analysis = await inspectVideo(video, crop);
  const ok = variant === 'baseline' ? analysis.stripeFrames > 0 : analysis.stripeFrames === 0;
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ passed: ok ? 1 : 0, failed: ok ? 0 : 1, variant, opacities, ...markers, ...analysis }, null, 2));
  manager.dispose(); win.destroy(); backdrop.destroy(); await server.close(); exit(ok ? 0 : 1);
}
run().catch(error => { console.error(error.stack); fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ passed: 0, failed: 1, error: error.stack }, null, 2)); exit(1); });
setTimeout(() => exit(2), 60000).unref();
