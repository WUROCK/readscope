const { app, BrowserWindow, ipcMain, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'artifacts', 'reference-layout-qa');
fs.mkdirSync(out, { recursive: true });
require('../electron/logging.cjs').installFileLogging(path.join(out, 'run.log'));
const profile = fs.mkdtempSync(path.join(out, 'profile-'));
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.on('window-all-closed', () => {});
let win, manager, server, passed = 0;
let paintedFrames = 0, whiteFrames = 0, animatedResizes = 0, midpointSaved = false;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const js = source => win.webContents.executeJavaScript(source, true);
function check(ok, label) { if (!ok) throw Error(label); passed++; console.log('PASS', label); }
async function wait(source) {
  for (let i = 0; i < 120; i++) { if (await js(source)) return; await sleep(50); }
  throw Error('Timed out: ' + source);
}
async function click(selector) {
  const position = await js('(()=>{const e=document.querySelector(' + JSON.stringify(selector) + '); if(!e)throw Error("Missing target"); e.scrollIntoView({block:"nearest"}); const r=e.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()');
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...position });
  win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...position });
  await sleep(150);
  for(let i=0; manager.getState().transitioning && i<50; i++) await sleep(20);
}
async function clickText(text) {
  const selector = await js('(()=>{const e=[...document.querySelectorAll("button")].find(e=>e.textContent.trim()===' + JSON.stringify(text) + '); if(!e) throw Error("Missing text"); e.dataset.qaTarget="true";return "[data-qa-target]"})()');
  await click(selector);
  await js('document.querySelector("[data-qa-target]")?.removeAttribute("data-qa-target")');
}
async function shot(name) {
  await sleep(200);
  const paint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('paint timeout')), 3000);
    function capture(event, rect, image) {
      if (rect.x || rect.y || rect.width < win.getContentSize()[0] || rect.height < win.getContentSize()[1]) return;
      clearTimeout(timer); win.webContents.removeListener('paint', capture); resolve(image);
    }
    win.webContents.on('paint', capture); win.webContents.invalidate();
  });
  fs.writeFileSync(path.join(out, name + '.png'), paint.toPNG());
}
async function run() {
  await app.whenReady();
  const data = fs.mkdtempSync(path.join(out, 'data-'));
  fs.cpSync(path.join(root, 'data', 'seed'), path.join(data, 'seed'), { recursive: true });
  const { startServer } = await import(pathToFileURL(path.join(root, 'server/index.mjs')).href);
  server = await startServer({ port: 0, dataDir: data, fetchImpl: async () => { throw Error('offline QA'); } });
  const base = 'http://127.0.0.1:' + server.port;
  const request = (url, body) => fetch(base + url, { method: url === '/api/books' ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await request('/api/settings', { recommendationSource: 'curated' });
  for (const title of ['爱的艺术', '怪奇物语1', '远东冰原上的猫头鹰']) {
    await request('/api/books', { title, author: title === '远东冰原上的猫头鹰' ? '乔纳森·斯拉特' : '测试作者', domain: 'literature', totalPages: 320, currentPage: 314, tags: [] });
    await sleep(30);
  }
  const wm = require('../electron/window-manager.cjs');
  const initialState = wm.createInitialState({}, screen);
  let pinned = true;
  const state = () => ({ isDesktop: true, pinned, ...manager.getState() });
  ipcMain.handle('desktop:get-state', state);
  ipcMain.handle('desktop:set-compact', async (_event, value, options) => { await manager.setCompact(value, {animate: options?.animate !== false}); return state(); });
  ipcMain.handle('desktop:set-opacity', (_event, value) => { manager.setOpacity(value); return state(); });
  ipcMain.handle('desktop:toggle-pin', () => { pinned = !pinned; return pinned; });
  for (const name of ['hide', 'minimize', 'quit', 'open-external']) ipcMain.handle('desktop:' + name, () => true);
  win = new BrowserWindow({ ...wm.getWindowOptions(initialState), show: false, frame: false, thickFrame: true, hasShadow: false,
    webPreferences: { offscreen: true, preload: path.join(root, 'electron/preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  manager = wm.createWindowManager({ window: win, screen, initialState, onState: () => win.webContents.send('desktop:state', state()) });
  win.on("resize", () => { if(manager.getState().transitioning) animatedResizes++; });
  await win.loadURL(base);
  await wait('!!document.querySelector(".compact-content .reading-row")');
  const start = win.getContentBounds();
  check(start.width === 420 && start.height === 160, 'compact native size remains 420x160');
  check(await js('document.querySelectorAll(".compact-tab").length===3 && document.querySelector(".tabs").inert'), 'three inline compact navigation buttons');
  check(await js('!!document.querySelector(".compact-content .book-cover") && !!document.querySelector(".compact-content .reading-row__author") && !!document.querySelector(".compact-content .progress-track")'), 'compact reading preserves cover author and progress');
  check(await js('document.querySelector(".reading-row__bottom").getBoundingClientRect().bottom <= innerHeight - 4'), 'compact progress row fully visible');
  check(await js('document.querySelector(".compact-tabs").getBoundingClientRect().right <= document.querySelector(".titlebar__actions").getBoundingClientRect().left'), 'compact tabs do not overlap window actions');
  const brandX = await js('document.querySelector(".titlebar__brand").getBoundingClientRect().x');
  await shot('13-compact-reference');
  await click('#compact-tab-stats');
  await wait('!!document.querySelector(".compact-stats")');
  check(manager.getState().compact && await js('document.querySelector(".compact-content").textContent.includes("本周累计") && document.querySelector(".compact-content").textContent.includes("本月累计") && !document.querySelector(".compact-content").textContent.includes("今日阅读")'), 'compact stats switches directly and summarizes week/month');
  await shot('15-compact-stats');
  await click('#compact-tab-daily');
  await wait('!!document.querySelector(".compact-summary__text")');
  check(manager.getState().compact, 'daily switches without expanding');
  await shot('16-compact-daily');
  await click('[aria-label="展开完整面板"]');
  await wait('!!document.querySelector(".tabs")');
  check(await js('document.querySelector("#tab-daily").getAttribute("aria-selected")==="true"'), 'expand keeps selected page');
  check(win.getContentSize()[0] === start.width, 'expand keeps width');
  check(await js('document.querySelector(".titlebar__brand").getBoundingClientRect().x') === brandX, 'brand alignment unchanged');
  await click('#tab-reading');
  await wait('document.querySelectorAll(".sortable-book").length>=3');
  check(await js('!!document.querySelector(".today-line")'), 'reading retains daily goal progress');
  await shot('14-expanded-reference');
  await clickText('排序');
  check(await js('document.querySelectorAll(".sortable-book[draggable=true][data-no-swipe]").length>=3'), 'sort mode enables drag and excludes carousel swiping');
  const initialTitles = await js('[...document.querySelectorAll(".sortable-book .reading-row__title")].map(e=>e.textContent)');
  await click('.sortable-book:first-child .sort-controls button:last-child');
  await wait('!document.querySelector(".sort-controls button:not([disabled])") || !document.querySelector(".sort-help").textContent.includes("正在保存")');
  check(await js('document.querySelector(".sortable-book:first-child .reading-row__title").textContent') === initialTitles[1], 'down arrow reorders books');
  // Exercise the HTML drag/drop event path as well as real pointer button clicks.
  await js('(()=>{window.qaDrag=new DataTransfer();const rows=document.querySelectorAll(".sortable-book");rows[2].dispatchEvent(new DragEvent("dragstart",{bubbles:true,dataTransfer:window.qaDrag}));})()');
  await sleep(50);
  await js('(()=>{const target=document.querySelector(".sortable-book");target.dispatchEvent(new DragEvent("dragover",{bubbles:true,cancelable:true,dataTransfer:window.qaDrag}));target.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:window.qaDrag}));})()');
  await wait('!document.querySelector(".sort-help").textContent.includes("正在保存")');
  check(await js('document.querySelector(".sortable-book:first-child .reading-row__title").textContent') === initialTitles[2], 'drag/drop moves selected book to target');
  const savedOrder = (await (await fetch(base + '/api/settings')).json()).readingOrder;
  const displayedKeys = await js('[...document.querySelectorAll(".sortable-book")].map(e=>e.dataset.bookKey)');
  check(JSON.stringify(savedOrder) === JSON.stringify(displayedKeys), 'order persisted through API');
  await shot('17-reading-sort');
  await clickText('完成排序');
  await click('[aria-label="收起为简洁横条"]');
  await wait('!!document.querySelector(".compact-content .reading-row__title")');
  check(await js('document.querySelector(".compact-content .reading-row__title").textContent') === initialTitles[2], 'compact reading uses saved priority');
  await new Promise(resolve => { win.webContents.once("did-finish-load", resolve); win.webContents.reload(); });
  await wait('!!document.querySelector(".compact-content .reading-row__title")');
  await wait('document.querySelector(".compact-content .reading-row__title").textContent===' + JSON.stringify(initialTitles[2]));
  check(true, 'reloading renderer preserves reading order');
  // Sample actual renderer paints during mode changes for a white viewport.
  win.webContents.on('paint', (_event, rect, image) => {
    const size = image.getSize();
    if (size.width < 100 || size.height < 100) return;
    paintedFrames++;
    if (!midpointSaved && !manager.getState().compact && size.height > 300 && size.height < 450) {
      fs.writeFileSync(path.join(out, '19-expand-midpoint.png'), image.toPNG());
      midpointSaved = true;
    }
    const bitmap = image.toBitmap(); let bright = 0, samples = 0;
    for (let y = 8; y < size.height; y += 16) for (let x = 8; x < size.width; x += 16) {
      const i = (y * size.width + x) * 4; samples++;
      if (bitmap[i] > 235 && bitmap[i+1] > 235 && bitmap[i+2] > 235) bright++;
    }
    if (bright / samples > .8) whiteFrames++;
  });
  for (let i = 0; i < 12; i++) {
    await click('[aria-label="展开完整面板"]');
    await wait('!!document.querySelector(".tabs")');
    await click('[aria-label="收起为简洁横条"]');
    await wait('!!document.querySelector(".compact-tabs")');
  }
  check(win.getContentSize()[0] === start.width, '12 real click round trips do not drift');
  check(animatedResizes > 120, 'native window height changes over multiple animation frames');
  await js('document.querySelector("[aria-label=展开完整面板]").click()');
  await sleep(80);
  await js('document.querySelector("[aria-label=收起为简洁横条]").click()');
  await sleep(320);
  check(manager.getState().compact && !manager.getState().transitioning && win.getContentSize()[1] === 160 && await js('document.querySelector(".widget").classList.contains("widget--compact")'), 'quick reversal keeps renderer and native window synchronized');
  check(win.isResizable(), 'native resizable style remains stable in compact mode');
  check(paintedFrames > 10 && whiteFrames === 0, 'renderer mode transition frames remain dark');
  for (let i = 0; i < 30; i++) { manager.setCompact(false); manager.setCompact(true); }
  check(win.getContentSize()[0] === start.width, '30 rapid native transitions do not drift');
  await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  manager.setCompact(false);
  await wait('!!document.querySelector(".widget:not(.widget--compact)")');
  win.setBounds({ ...win.getBounds(), width: 400, height: 650 });
  manager.setCompact(true);
  await wait('!!document.querySelector(".compact-tabs")');
  check(await js('document.querySelector(".compact-tabs").getBoundingClientRect().right <= document.querySelector(".titlebar__actions").getBoundingClientRect().left'), 'navigation fits minimum 400px window');
  await shot('18-compact-minimum');
  manager.setCompact(false);
  win.setBounds({ ...win.getBounds(), width: 540, height: 740 });
  const resized = win.getContentSize()[0];
  manager.setCompact(true);
  await wait('!!document.querySelector(".compact-content")');
  check(win.getContentSize()[0] === resized, 'preview follows user resized width (expected ' + resized + ', got ' + win.getContentSize()[0] + ')');
  manager.setCompact(false);
  await wait('!!document.querySelector(".widget:not(.widget--compact)")');
  win.setBounds({x:201,y:41,width:540,height:740});
  const movedSize = win.getContentSize();
  manager.setCompact(true);
  await wait('!!document.querySelector(".compact-content")');
  check(win.getContentSize()[1] === 160 && win.getContentSize()[0] === movedSize[0], 'fractional display origin preserves compact size after moving');
  manager.setCompact(false);
  await wait('!!document.querySelector(".widget:not(.widget--compact)")');
  check(win.getContentSize()[1] === movedSize[1] && win.getContentSize()[0] === movedSize[0], 'fractional display origin restores expanded size');
  await click('[aria-label="打开设置"]');
  await wait('!!document.querySelector("#opacity-range")');
  check(win.getContentSize()[0] === movedSize[0], 'settings retain shared width');
  await click('[aria-label="关闭弹窗"]');
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const priorResizes = animatedResizes;
  await click('[aria-label="收起为简洁横条"]');
  check(animatedResizes === priorResizes && !manager.getState().transitioning, 'reduced motion skips native height interpolation');
  check(await js('getComputedStyle(document.querySelector(".compact-content")).animationName === "none"'), 'reduced motion disables content animation');
  win.webContents.debugger.detach();
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ passed, failed: 0, paintedFrames, whiteFrames, animatedResizes, contentWidth: resized }, null, 2));
  manager.dispose(); win.destroy(); await server.close(); app.exit(0);
}
run().catch(error => {
  console.error(error.stack);
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ passed, failed: 1, error: error.stack }, null, 2));
  app.exit(1);
});
setTimeout(() => app.exit(2), 90000).unref();
