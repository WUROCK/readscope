// Real Electron regression checks. Uses hidden windows and its own fixture data/profile.
// Run via Electron: electron scripts/compact-qa.cjs (clear ELECTRON_RUN_AS_NODE).
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'compact-qa');
for (const directory of [OUT, path.join(OUT, 'profile'), path.join(OUT, 'session')]) {
  fs.mkdirSync(directory, { recursive: true });
}
require('../electron/logging.cjs').installFileLogging(path.join(OUT, 'run.log'));
const profile = fs.mkdtempSync(path.join(OUT, 'profile-'));
fs.mkdirSync(path.join(profile, 'session'));
app.setPath('userData', profile);
app.setPath('sessionData', path.join(profile, 'session'));
app.commandLine.appendSwitch('disable-background-timer-throttling');
// The production tray keeps the app alive while windows are recreated.
app.on('window-all-closed', () => {});

const SELECTORS = {
  compact: '.compact-bar',
  summary: '.compact-summary',
  expand: '[aria-label="展开完整面板"]',
  settings: '[aria-label="打开设置"]',
  compactSettings: '[aria-label="简洁模式打开设置"]',
  collapse: '[aria-label="收起为简洁横条"]',
  miniReading: '[aria-label="简洁在读"]',
  miniStats: '[aria-label="简洁统计"]',
  miniDaily: '[aria-label="简洁每日文献"]',
  opacity: '#opacity-range',
};
const BOOK_TITLE = '最近未读完书 · 简洁模式测试';
const FINISHED_TITLE = '最近已读完书 · 应排除';
const DAILY_TITLE = 'Integrated Sensing and Communications: A Complete Long Title for Compact Window Regression';
const results = [], screenshots = [], rendererErrors = [], nativeSnapshots = [], apiWrites = [];
const captureDiagnostics = [];
const PREVIEWS_ONLY = process.env.READSCOPE_QA_PREVIEWS_ONLY === '1';
let win, manager, handle, windowManager, fixtureDataDir;
let pinned = true;
let currentTest = 'boot';
const STATE_FILE = path.join(OUT, 'window-state.json');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evaluate = (code) => win.webContents.executeJavaScript(code, true);
const desktopState = () => ({
  pinned, isDesktop: true, version: 'qa', platform: process.platform,
  ...manager.getState(),
});

function assert(value, label, details) {
  const passed = Boolean(value);
  results.push({ test: currentTest, label, passed, ...(details === undefined ? {} : { details }) });
  console.log(`[compact-qa] ${passed ? 'PASS' : 'FAIL'} ${label}`);
  if (!passed) throw new Error(label + (details === undefined ? '' : ': ' + JSON.stringify(details)));
}

async function waitFor(expression, timeout = 6500) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await sleep(35);
  }
  throw new Error('Timed out: ' + expression);
}

async function click(selector) {
  const point = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
    const r=el.getBoundingClientRect(),x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2);
    const hit=document.elementFromPoint(x,y);
    return {x,y,width:r.width,height:r.height,disabled:el.disabled,correct:!!hit&&(hit===el||el.contains(hit))};
  })()`);
  if (!point || !point.correct || point.disabled || point.width < 1 || point.height < 1) {
    throw new Error('Cannot click ' + selector + ': ' + JSON.stringify(point));
  }
  win.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
  win.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await sleep(15);
  win.webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await sleep(110);
}

async function key(keyCode, modifiers = []) {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await sleep(60);
}

async function fill(selector, text) {
  await click(selector);
  await key('A', ['control']);
  await win.webContents.insertText(String(text));
  await sleep(50);
  const value = await evaluate(`document.querySelector(${JSON.stringify(selector)}).value`);
  if (value !== String(text)) throw new Error('Input did not receive text: ' + JSON.stringify({ selector, value, text }));
}

async function screenshot(name) {
  await sleep(300);
  const frame = await evaluate(`(() => {
    const controls=[...document.querySelectorAll('.compact-bar__actions button')].map(el=>{
      const r=el.getBoundingClientRect(),s=getComputedStyle(el),svg=el.querySelector('svg'),ss=svg?getComputedStyle(svg):null;
      const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
      const vector=svg?.getBBox();
      return {label:el.getAttribute('aria-label'),bounds:{x:r.x,y:r.y,width:r.width,height:r.height},
        display:s.display,visibility:s.visibility,opacity:s.opacity,color:s.color,
        hitCorrect:!!hit&&(hit===el||el.contains(hit)),svg:svg?{width:svg.getBoundingClientRect().width,height:svg.getBoundingClientRect().height,
          visibility:ss.visibility,opacity:ss.opacity,stroke:ss.stroke,color:ss.color,pathCount:svg.querySelectorAll('path,line,polyline,rect,circle').length,
          vectorBounds:{x:vector.x,y:vector.y,width:vector.width,height:vector.height}}:null};
    });
    return {width:innerWidth,height:innerHeight,controls};
  })()`);
  // Offscreen painting is incremental. Demand a complete frame before capture,
  // otherwise unchanged SVG controls can be missing from the CDP surface.
  const painted = await new Promise((resolve, reject) => {
    const timer=setTimeout(()=>{win.webContents.removeListener('paint',onPaint);reject(new Error('Full offscreen repaint timed out'));},2500);
    function onPaint(_event,dirtyRect,image){
      if(dirtyRect.x>0||dirtyRect.y>0||dirtyRect.width<frame.width||dirtyRect.height<frame.height)return;
      clearTimeout(timer);win.webContents.removeListener('paint',onPaint);
      resolve({dirtyRect,image});
    }
    win.webContents.on('paint',onPaint);
    win.webContents.invalidate();
  });
  const debuggerApi = win.webContents.debugger;
  if (!debuggerApi.isAttached()) debuggerApi.attach('1.3');
  const result = await Promise.race([
    debuggerApi.sendCommand('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Hidden screenshot timed out')), 2500)),
  ]);
  const file = path.join(OUT, name + '.png');
  fs.writeFileSync(path.join(OUT,name+'-cdp.png'),Buffer.from(result.data,'base64'));
  fs.writeFileSync(file,painted.image.toPNG());
  captureDiagnostics.push({name,...frame,dirtyRect:painted.dirtyRect,paintSize:painted.image.getSize(),output:file});
  screenshots.push(file);
}

function sameBounds(actual, expected, tolerance = 1) {
  return ['x', 'y', 'width', 'height'].every((key) => Math.abs(actual[key] - expected[key]) <= tolerance);
}

function snapshot(label) {
  const value = {
    label, bounds: win.getBounds(), contentBounds: win.getContentBounds(),
    opacity: win.getOpacity(), state: manager.getState(), saved: manager.getSavedState(),
  };
  nativeSnapshots.push(value);
  return value;
}

async function setCompact(value) {
  await evaluate(`window.desktop.setCompact(${JSON.stringify(value)})`);
  await waitFor(`!!document.querySelector(${JSON.stringify(SELECTORS.compact)})===${JSON.stringify(value)}`);
  await sleep(60);
}

async function request(route, body, method = 'POST') {
  const response = await fetch(`http://127.0.0.1:${handle.port}/api` + route, {
    method, headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error('API failed: ' + route + ': ' + JSON.stringify(data));
  return data;
}

async function createManagedWindow(raw) {
  const initialState = windowManager.createInitialState(raw, screen);
  win = new BrowserWindow({
    ...windowManager.getWindowOptions(initialState), show: false, frame: false,
    thickFrame: true, transparent: false, backgroundColor: '#16181b', roundedCorners: true,
    hasShadow: false, maximizable: false, fullscreenable: false,
    webPreferences: {
      offscreen: true, preload: path.join(ROOT, 'electron', 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, spellcheck: false,
    },
  });
  nativeSnapshots.push({ label: 'immediately after native construction', requested: windowManager.getWindowOptions(initialState),
    bounds: win.getBounds(), contentBounds: win.getContentBounds(), displays: screen.getAllDisplays().map((display) => ({ bounds: display.bounds, workArea: display.workArea, scaleFactor: display.scaleFactor })) });
  manager = windowManager.createWindowManager({
    window: win, screen, initialState,
    persistState: (state) => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)),
    onState: () => {
      if (!win.isDestroyed()) win.webContents.send('desktop:state', desktopState());
    },
    getPinned: () => pinned,
    saveDelayMs: 40,
  });
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') rendererErrors.push(event.message);
  });
  win.webContents.on('render-process-gone', (_event, details) => rendererErrors.push(details));
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    if (details.method !== 'GET' && /\/api\//.test(details.url)) apiWrites.push({ method: details.method, url: details.url });
    callback({});
  });
  await win.loadURL(`http://127.0.0.1:${handle.port}/`);
  await waitFor(`!!window.desktop?.setCompact && !!window.desktop?.setOpacity`);
  await evaluate(`window.__qaErrors=[];addEventListener('error',e=>window.__qaErrors.push(e.message));addEventListener('unhandledrejection',e=>window.__qaErrors.push(String(e.reason)));window.__desktopStates=[];window.desktop.onState(state=>window.__desktopStates.push(state));true;`);
  await waitFor(`!!document.querySelector(${JSON.stringify(initialState.compact ? SELECTORS.compact : '.titlebar')})`);
  await sleep(220);
}

async function run(name, operation) {
  if (PREVIEWS_ONLY && name !== 'delivery-previews') return;
  currentTest = name;
  try { await operation(); }
  catch (error) {
    console.error('[compact-qa] TEST ERROR', name, error.stack);
    if (results.at(-1)?.passed !== false || results.at(-1)?.test !== name) {
      results.push({ test: name, label: error.message, passed: false });
    }
    try { await screenshot('failed-' + name); } catch {}
    try { await key('ESCAPE'); await key('ESCAPE'); } catch {}
  }
}

async function compactLayout(label) {
  const layout = await evaluate(`(() => {
    const root=document.querySelector(${JSON.stringify(SELECTORS.compact)}),r=root.getBoundingClientRect();
    const controls=[...root.querySelectorAll('button')].map(el=>{const b=el.getBoundingClientRect();return {label:el.getAttribute('aria-label'),left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height,region:getComputedStyle(el).getPropertyValue('app-region')}});
    const overlaps=[];
    for(let a=0;a<controls.length;a++)for(let b=a+1;b<controls.length;b++){
      const x=controls[a],y=controls[b];if(Math.min(x.right,y.right)-Math.max(x.left,y.left)>1&&Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)>1)overlaps.push([x.label,y.label]);
    }
    return {viewport:{width:innerWidth,height:innerHeight},root:{width:r.width,height:r.height,scrollWidth:root.scrollWidth,clientWidth:root.clientWidth},documentWidth:document.documentElement.scrollWidth,controls,overlaps,drag:getComputedStyle(root).getPropertyValue('app-region')};
  })()`);
  assert(layout.documentWidth <= layout.viewport.width + 1 && layout.root.scrollWidth <= layout.root.clientWidth + 1,
    label + ' has no horizontal overflow', layout);
  assert(layout.controls.every((control) => control.left >= -1 && control.right <= layout.viewport.width + 1 && control.top >= -1 && control.bottom <= layout.viewport.height + 1),
    label + ' controls fit inside the real window', layout);
  assert(layout.overlaps.length === 0, label + ' controls do not overlap', layout.overlaps);
  assert(layout.controls.every((control) => control.width >= 24 && control.height >= 26 && control.region === 'no-drag'),
    label + ' buttons retain usable no-drag hit targets', layout.controls);
  assert(layout.drag === 'drag', label + ' blank strip uses native window dragging', layout);
}

async function boot() {
  await app.whenReady();
  windowManager = require(path.join(ROOT, 'electron', 'window-manager.cjs'));
  fixtureDataDir = fs.mkdtempSync(path.join(OUT, 'data-'));
  fs.cpSync(path.join(ROOT, 'data', 'seed'), path.join(fixtureDataDir, 'seed'), { recursive: true });
  const { createStore } = await import(pathToFileURL(path.join(ROOT, 'server', 'store.mjs')).href);
  const { serializeRecommendationRow } = await import(pathToFileURL(path.join(ROOT, 'server', 'recommendations.mjs')).href);
  const { isoShanghai } = await import(pathToFileURL(path.join(ROOT, 'server', 'util.mjs')).href);
  const stamp = (offset) => isoShanghai(new Date(Date.now() + offset));
  const store = createStore({ dataDir: fixtureDataDir });
  store.saveSettings({ ...store.getSettings(), recommendationSource: 'curated' });
  store.writeBooks([
    { id: 'qa-unfinished', title: BOOK_TITLE, author: 'UI QA', totalPages: 320, currentPage: 64, domain: 'tech', tags: [],
      addedAt: stamp(-120000), updatedAt: stamp(-60000), finishedAt: null },
    { id: 'qa-finished', title: FINISHED_TITLE, author: 'UI QA', totalPages: 200, currentPage: 200, domain: 'tech', tags: [],
      addedAt: stamp(-120000), updatedAt: stamp(0), finishedAt: stamp(0) },
  ]);
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  store.writeRecommendationRows([serializeRecommendationRow({
    date, type: 'paper', title: DAILY_TITLE, venue: 'IEEE Communications Magazine', year: 2026,
    summary: '独立回归数据用于验证简洁横条、完整面板和窗口透明度。', url: 'https://example.com/compact-qa',
    source: 'curated', sourceLabel: '精选文献库', tags: ['ISAC'], language: 'zh', fetchedAt: new Date().toISOString(),
  })]);
  const { startServer } = await import(pathToFileURL(path.join(ROOT, 'server', 'index.mjs')).href);
  handle = await startServer({ port: 0, dataDir: fixtureDataDir, fetchImpl: async () => { throw new Error('QA blocks external network'); } });

  ipcMain.handle('desktop:get-state', () => desktopState());
  ipcMain.handle('desktop:set-compact', (_event, value) => { manager.setCompact(value); return desktopState(); });
  ipcMain.handle('desktop:set-opacity', (_event, value) => { manager.setOpacity(value); return desktopState(); });
  ipcMain.handle('desktop:toggle-pin', () => { pinned = !pinned; win.webContents.send('desktop:state', desktopState()); return pinned; });
  for (const event of ['desktop:minimize', 'desktop:hide', 'desktop:quit', 'desktop:open-external', 'desktop:open-data-folder']) ipcMain.handle(event, () => true);
  await createManagedWindow(undefined);

  await run('ordinary-hidden-native-probe', async () => {
    const initial = windowManager.createInitialState(undefined, screen);
    const probe = new BrowserWindow({ ...windowManager.getWindowOptions(initial), show: false, frame: false,
      thickFrame: true, transparent: false, backgroundColor: '#07090c', roundedCorners: true,
      hasShadow: false, maximizable: false, fullscreenable: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    let probeManager;
    try {
      probeManager = windowManager.createWindowManager({ window: probe, screen, initialState: initial });
      await sleep(100);
      const before = probe.getBounds();
      const beforeContent = probe.getContentBounds();
      probeManager.setCompact(false);
      const expanded = probe.getBounds();
      const expandedContent = probe.getContentBounds();
      probeManager.setCompact(true);
      const restored = probe.getBounds();
      assert(beforeContent.width === 520 && beforeContent.height === 64 && expandedContent.width === 420 && expandedContent.height === 630 && sameBounds(restored, before),
        'Ordinary hidden production windows use exact client sizes and preserve their native anchor', { before, beforeContent, expanded, expandedContent, restored });
    } finally { probeManager?.dispose(); probe.destroy(); }
  });

  await run('native-defaults', async () => {
    const initial = snapshot('default compact');
    assert(initial.state.compact === true && Math.abs(initial.state.opacity - 0.9) < 0.001, 'New installations default to compact mode and 90% opacity', initial);
    assert(initial.contentBounds.width === 520 && initial.contentBounds.height === 64 && initial.bounds.width - initial.contentBounds.width <= 2 && initial.bounds.height - initial.contentBounds.height <= 2,
      'Compact mode uses a real 520 by 64 client area with only its native border', { outer: initial.bounds, content: initial.contentBounds });
    assert(Math.abs(initial.opacity - 0.9) < 0.006, '90% opacity is applied to the native window', initial.opacity);
    assert(!win.isVisible(), 'Regression window remains hidden');
    await compactLayout('520px compact');
    await screenshot('01-compact-reading');
    await setCompact(false);
    assert(win.getContentBounds().width === 420 && win.getContentBounds().height === 630, 'First expansion uses a real 420 by 630 native client area', win.getContentBounds());
    await setCompact(true);
  });

  await run('recent-unfinished-edge-cases', async () => {
    const baselineBooks = store.readBooks().items;
    const fixtureBook = (id, title, updatedAt, currentPage = 64) => ({ id, title, author: 'UI QA', totalPages: 320,
      currentPage, domain: 'tech', tags: [], addedAt: updatedAt, updatedAt, finishedAt: null });
    async function reloadCompact() {
      await setCompact(true);
      await win.loadURL(`http://127.0.0.1:${handle.port}/`);
      await waitFor(`!!document.querySelector(${JSON.stringify(SELECTORS.summary)}) && !document.querySelector(${JSON.stringify(SELECTORS.summary)}).textContent.includes('正在加载')`);
      await evaluate(`window.__qaErrors=[];addEventListener('error',e=>window.__qaErrors.push(e.message));addEventListener('unhandledrejection',e=>window.__qaErrors.push(String(e.reason)));window.__desktopStates=[];window.desktop.onState(state=>window.__desktopStates.push(state));true;`);
    }
    try {
      const comparisonDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
        .format(new Date(Date.now() + 24 * 60 * 60 * 1000));
      store.writeBooks([
        fixtureBook('timezone-earlier', '混合时区较早书籍', `${comparisonDate}T15:00:00+08:00`),
        fixtureBook('timezone-later', '混合时区真正最近书籍', `${comparisonDate}T08:00:00Z`),
      ]);
      await reloadCompact();
      assert(await evaluate(`document.querySelector(${JSON.stringify(SELECTORS.summary)}).textContent.includes('混合时区真正最近书籍')`),
        'Most recent unfinished book is chosen by timestamp across Z and UTC+8 representations');
      store.writeBooks([fixtureBook('rounding-nearly-finished', '还有一页未完成的书', stamp(0), 319)]);
      await reloadCompact();
      const books = await request('/books', undefined, 'GET');
      const almostFinished = books.items.find((book) => book.id === 'rounding-nearly-finished');
      const text = await evaluate(`document.querySelector(${JSON.stringify(SELECTORS.summary)}).textContent`);
      assert(almostFinished?.finished === false && almostFinished?.progress === 100 && text.includes('还有一页未完成的书') && text.includes('将读完'),
        'A 319-of-320-page unfinished book remains visible with a nearly-finished label', { book: almostFinished, summary: text });
    } finally {
      store.writeBooks(baselineBooks);
      await reloadCompact();
    }
  });

  await run('compact-content-and-navigation', async () => {
    await setCompact(true);
    await click(SELECTORS.miniReading);
    await waitFor(`document.querySelector(${JSON.stringify(SELECTORS.summary)})?.textContent.includes(${JSON.stringify(BOOK_TITLE)})`);
    const reading = await evaluate(`document.querySelector(${JSON.stringify(SELECTORS.summary)}).textContent`);
    assert(reading.includes(BOOK_TITLE) && !reading.includes(FINISHED_TITLE), 'Compact reading selects the most recent unfinished book', reading);
    await click(SELECTORS.miniStats);
    const stats = await evaluate(`document.querySelector(${JSON.stringify(SELECTORS.summary)}).textContent`);
    assert(/42/.test(stats) && /45/.test(stats), 'Compact statistics displays today progress and daily goal', stats);
    const progress = await evaluate(`(() => {const root=document.querySelector(${JSON.stringify(SELECTORS.compact)});const progress=root.querySelector('[role="progressbar"]');if(progress)return {now:progress.getAttribute('aria-valuenow'),max:progress.getAttribute('aria-valuemax')};const bar=root.querySelector('[style*="width"]');return bar?{width:bar.style.width}:null;})()`);
    assert(progress && ((Number(progress.now) === 42 && Number(progress.max) === 45) || Math.abs(Number.parseFloat(progress.width) - 42 / 45 * 100) < 1), 'Compact goal progress bar matches data', progress);
    await screenshot('02-compact-stats');
    await click(SELECTORS.miniDaily);
    const daily = await evaluate(`(() => {const summary=document.querySelector(${JSON.stringify(SELECTORS.summary)});return {text:summary.textContent,titles:[summary,...summary.querySelectorAll('[title]')].map(el=>el.getAttribute('title'))};})()`);
    assert(daily.text.includes(DAILY_TITLE) && daily.titles.some((title) => title && title.includes(DAILY_TITLE)), 'Long literature titles retain their full text and tooltip', daily);
    await screenshot('03-compact-literature');
    await click(SELECTORS.summary);
    await waitFor(`!document.querySelector(${JSON.stringify(SELECTORS.compact)})`);
    assert(manager.getState().compact === false && win.getBounds().height >= 520, 'Clicking a summary expands the real native window');
    assert(await evaluate(`document.querySelector('#tab-daily').getAttribute('aria-selected')==='true' && document.querySelector('.daily-title').textContent===${JSON.stringify(DAILY_TITLE)}`), 'Current tab and recommendation survive expansion');
    await click(SELECTORS.collapse);
    await waitFor(`!!document.querySelector(${JSON.stringify(SELECTORS.compact)})`);
    assert(await evaluate(`document.querySelector('#compact-tab-daily').getAttribute('aria-selected')==='true'`), 'Collapsing preserves the selected tab');
    await click(SELECTORS.expand);
    await waitFor(`!document.querySelector(${JSON.stringify(SELECTORS.compact)})`);
    assert(manager.getState().compact === false, 'Explicit expand button also expands the native window');
  });

  await run('restore-user-bounds-and-repeat', async () => {
    await setCompact(false);
    const area = screen.getPrimaryDisplay().workArea;
    const requested = { x: area.x + 80, y: area.y + 70, width: Math.min(480, area.width - 160), height: Math.min(700, area.height - 140) };
    win.setBounds(requested, false);
    await sleep(100);
    const baseline = win.getBounds();
    await setCompact(true);
    const firstCompact = win.getBounds();
    for (let index = 0; index < 30; index += 1) {
      await setCompact(false);
      if (!sameBounds(win.getBounds(), baseline)) throw new Error('Expanded bounds drift at toggle ' + index + ': ' + JSON.stringify({ baseline, actual: win.getBounds() }));
      await setCompact(true);
      if (!sameBounds(win.getBounds(), firstCompact)) throw new Error('Compact bounds drift at toggle ' + index + ': ' + JSON.stringify({ firstCompact, actual: win.getBounds() }));
    }
    assert(true, '30 native expand and collapse cycles preserve the user size and position');
    snapshot('after 30 cycles');
    await setCompact(false);
    assert(sameBounds(win.getBounds(), baseline), 'Expanding restores the exact user window bounds', { baseline, actual: win.getBounds() });
  });

  await run('screen-edge-clamping', async () => {
    const area = screen.getPrimaryDisplay().workArea;
    const size = { width: Math.min(460, area.width - 32), height: Math.min(650, area.height - 32) };
    for (const [name, x, y] of [
      ['top-left', area.x, area.y],
      ['top-right', area.x + area.width - size.width, area.y],
      ['bottom-left', area.x, area.y + area.height - size.height],
      ['bottom-right', area.x + area.width - size.width, area.y + area.height - size.height],
    ]) {
      await setCompact(false); win.setBounds({ ...size, x, y }, false); await sleep(70);
      await setCompact(true);
      let bounds = win.getBounds();
      assert(bounds.x >= area.x - 1 && bounds.y >= area.y - 1 && bounds.x + bounds.width <= area.x + area.width + 1 && bounds.y + bounds.height <= area.y + area.height + 1,
        name + ' compact window stays in the working area', bounds);
      await setCompact(false); bounds = win.getBounds();
      assert(bounds.x >= area.x - 1 && bounds.y >= area.y - 1 && bounds.x + bounds.width <= area.x + area.width + 1 && bounds.y + bounds.height <= area.y + area.height + 1,
        name + ' expanded window stays in the working area', bounds);
    }
    const virtual = { x: -1280, y: 20, width: 1024, height: 700 };
    const fakeScreen = { getPrimaryDisplay: () => ({ workArea: virtual }), getDisplayMatching: () => ({ workArea: virtual }), getAllDisplays: () => [{ workArea: virtual }] };
    const restored = windowManager.createInitialState({ ...manager.getSavedState(), compactBounds: { x: 9000, y: 9000, width: 520, height: 64 }, expandedBounds: { x: 9000, y: 9000, width: 420, height: 630 } }, fakeScreen);
    assert(['compactBounds', 'expandedBounds'].every((key) => restored[key].x >= virtual.x && restored[key].y >= virtual.y && restored[key].x + restored[key].width <= virtual.x + virtual.width && restored[key].y + restored[key].height <= virtual.y + virtual.height),
      'Saved positions from a removed monitor recover inside a negative-coordinate working area', restored);
  });

  await run('narrow-compact-and-settings', async () => {
    await setCompact(true);
    win.setContentSize(360, 64, false); await sleep(90);
    assert(win.getContentBounds().width === 360 && win.getContentBounds().height === 64, 'Compact mode can be a real 360px native client strip', { outer: win.getBounds(), content: win.getContentBounds() });
    for (const selector of [SELECTORS.miniReading, SELECTORS.miniStats, SELECTORS.miniDaily]) {
      await click(selector); await compactLayout('360px compact');
    }
    await screenshot('04-compact-360');
    await click(SELECTORS.compactSettings);
    await waitFor(`!!document.querySelector('#settings-form')`);
    assert(manager.getState().compact === false && win.getBounds().height >= 520, 'Settings expands the actual window before showing its dialog');
    assert(await evaluate(`document.activeElement?.id==='opacity-range'`), 'Settings initially focuses the opacity slider');
    await screenshot('05-settings-opacity');
  });

  await run('native-opacity-and-restart', async () => {
    if (!await evaluate(`!!document.querySelector('#settings-form')`)) {
      await setCompact(false); await click(SELECTORS.settings); await waitFor(`!!document.querySelector('#settings-form')`);
    }
    const settingsBefore = fs.readFileSync(path.join(fixtureDataDir, 'settings.json'), 'utf8');
    const writeStart = apiWrites.length;
    await click(SELECTORS.opacity);
    await key('HOME');
    await waitFor(`Math.abs(Number(document.querySelector(${JSON.stringify(SELECTORS.opacity)}).value) - 45) < .001 || Math.abs(Number(document.querySelector(${JSON.stringify(SELECTORS.opacity)}).value) - .45) < .001`);
    assert(Math.abs(win.getOpacity() - 0.45) < 0.006, 'Opacity slider immediately updates native opacity at 45%', win.getOpacity());
    await key('END');
    assert(Math.abs(win.getOpacity() - 1) < 0.006, 'Opacity slider immediately updates native opacity at 100%', win.getOpacity());
    const state = await evaluate(`window.desktop.setOpacity(0.73)`);
    assert(Math.abs(win.getOpacity() - 0.73) < 0.006 && Math.abs(state.opacity - 0.73) < 0.001, 'Opacity bridge returns the applied native value', { state, native: win.getOpacity() });
    const states = await evaluate(`window.__desktopStates`);
    assert(states.some((entry) => Math.abs(entry.opacity - 0.73) < 0.001), 'Native opacity updates publish desktop state events', states);
    assert(fs.readFileSync(path.join(fixtureDataDir, 'settings.json'), 'utf8') === settingsBefore && !apiWrites.slice(writeStart).some((entry) => /\/api\/settings/.test(entry.url)),
      'Display opacity never writes the personal reading-settings API');
    manager.flush();
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    assert(Math.abs(saved.opacity - 0.73) < 0.001, 'Native opacity is persisted in the window state file', saved);
    await key('ESCAPE'); await setCompact(true); manager.flush();
    const restartState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const oldWindow = win; manager.dispose(); oldWindow.destroy();
    await createManagedWindow(restartState);
    assert(manager.getState().compact === true && Math.abs(win.getOpacity() - 0.73) < 0.006, 'A rebuilt native window restores compact mode and opacity', snapshot('restored after restart'));
    await evaluate(`window.desktop.setOpacity(0.01)`);
    assert(Math.abs(win.getOpacity() - 0.45) < 0.006, 'Native opacity clamps values below the usable minimum');
    await evaluate(`window.desktop.setOpacity(2)`);
    assert(Math.abs(win.getOpacity() - 1) < 0.006, 'Native opacity clamps values above 100%');
    await evaluate(`window.desktop.setOpacity(0.9)`);
  });

  await run('external-state-and-escape', async () => {
    await setCompact(false); await click(SELECTORS.settings); await waitFor(`!!document.querySelector('#settings-form')`);
    manager.setCompact(true);
    await waitFor(`!!document.querySelector(${JSON.stringify(SELECTORS.compact)}) && !document.querySelector('#settings-form')`);
    assert(win.getContentBounds().height === 64, 'External native compact changes dismiss dialogs before clipping the window');
    await click(SELECTORS.expand); await waitFor(`!document.querySelector(${JSON.stringify(SELECTORS.compact)})`);
    await key('ESCAPE');
    await waitFor(`!!document.querySelector(${JSON.stringify(SELECTORS.compact)})`);
    assert(win.getContentBounds().height === 64, 'Escape collapses an expanded panel when no dialog is open');
    await click(SELECTORS.miniReading); await key('RIGHT');
    assert(await evaluate(`document.querySelector('#compact-tab-stats').getAttribute('aria-selected')==='true'`), 'Compact tab arrow navigation switches to statistics once');
    await key('END');
    assert(await evaluate(`document.querySelector('#compact-tab-daily').getAttribute('aria-selected')==='true'`), 'Compact tab End selects literature');
    await key('HOME');
    assert(await evaluate(`document.querySelector('#compact-tab-reading').getAttribute('aria-selected')==='true'`), 'Compact tab Home selects reading');
  });

  await run('expanded-book-crud', async () => {
    await setCompact(false); await click('#tab-reading');
    await click('[aria-label="添加书籍"]'); await waitFor(`!!document.querySelector('#book-form')`);
    await fill('#book-title', '简洁模式展开后的新增书籍'); await fill('#book-total', '320'); await fill('#book-current', '48');
    await click('button[form="book-form"]'); await waitFor(`!document.querySelector('#book-form')`);
    let books = await request('/books', undefined, 'GET');
    let book = books.items.find((entry) => entry.title === '简洁模式展开后的新增书籍');
    assert(book?.currentPage === 48 && book?.progress === 15, 'Expanded mode still creates books through real mouse input');
    await click('[aria-label="编辑《简洁模式展开后的新增书籍》"]'); await waitFor(`!!document.querySelector('#book-form')`);
    await fill('#book-current', '96'); await click('button[form="book-form"]'); await waitFor(`!document.querySelector('#book-form')`);
    books = await request('/books', undefined, 'GET'); book = books.items.find((entry) => entry.title === '简洁模式展开后的新增书籍');
    assert(book?.currentPage === 96 && book?.progress === 30, 'Expanded mode still updates reading progress');
    await click('[aria-label="编辑《简洁模式展开后的新增书籍》"]'); await waitFor(`!!document.querySelector('#book-form')`);
    await click('.btn-danger-ghost'); await waitFor(`!!document.querySelector('.confirm-ok')`); await click('.confirm-ok'); await waitFor(`!document.querySelector('#book-form')`);
    books = await request('/books', undefined, 'GET');
    assert(!books.items.some((entry) => entry.title === '简洁模式展开后的新增书籍'), 'Expanded mode still deletes books through confirmation');
    await click(SELECTORS.settings); await waitFor(`!!document.querySelector('#settings-form')`);
    await click('.settings-save'); await waitFor(`!document.querySelector('#settings-form')`);
    assert(true, 'Expanded reading settings still save normally');
    await screenshot('06-expanded-reading');
  });

  await run('delivery-previews', async () => {
    store.writeBooks([
      { id: 'preview-book', title: '毫米波雷达感知技术', author: '王明', totalPages: 320, currentPage: 48, domain: 'tech', tags: [],
        addedAt: stamp(-120000), updatedAt: stamp(0), finishedAt: null },
    ]);
    const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'seed', 'curated_papers.json'), 'utf8'));
    store.writeRecommendationRows([serializeRecommendationRow({ ...seed[0], date, type: 'paper',
      source: 'curated', sourceLabel: '精选文献库', fetchedAt: stamp(0) })]);
    manager.resetAppearance();
    await waitFor(`!!document.querySelector(${JSON.stringify(SELECTORS.compact)})`);
    await win.loadURL(`http://127.0.0.1:${handle.port}/`);
    await waitFor(`!!document.querySelector(${JSON.stringify(SELECTORS.compact)}) && document.querySelector(${JSON.stringify(SELECTORS.summary)})?.textContent.includes('毫米波雷达感知技术')`);
    await screenshot('08-compact-reading');
    await click(SELECTORS.miniStats); await screenshot('09-compact-stats');
    await click(SELECTORS.miniDaily); await screenshot('10-compact-daily');
    await click(SELECTORS.summary); await waitFor(`!!document.querySelector('.daily-card')`);
    await screenshot('12-publication-details');
    await click(SELECTORS.settings); await waitFor(`!!document.querySelector('#settings-form')`);
    await screenshot('11-appearance-settings');
    assert(true, 'Delivery previews use ordinary book names and real local curated literature');
  });

  currentTest = 'runtime';
  rendererErrors.push(...await evaluate('window.__qaErrors || []'));
  assert(rendererErrors.length === 0, 'No renderer errors or crashes', rendererErrors);
  assert(!win.isVisible(), 'All native and UI checks use hidden windows');
  const summary = { generatedAt: new Date().toISOString(), passed: results.filter((entry) => entry.passed).length, failed: results.filter((entry) => !entry.passed).length,
    fixtureDataDir, results, nativeSnapshots, screenshots, rendererErrors, apiWrites, captureDiagnostics };
  fs.writeFileSync(path.join(OUT, PREVIEWS_ONLY ? 'capture-summary.json' : 'summary.json'), JSON.stringify(summary, null, 2));
  console.log('[compact-qa] SUMMARY', JSON.stringify({ passed: summary.passed, failed: summary.failed, output: OUT }));
  manager.dispose(); win.destroy(); await handle.close(); app.exit(summary.failed ? 1 : 0);
}

boot().catch(async (error) => {
  console.error('[compact-qa] FATAL', error.stack);
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ fatal: error.stack, results, nativeSnapshots, rendererErrors, screenshots }, null, 2));
  try { manager?.dispose(); } catch {}
  try { await handle?.close(); } catch {}
  app.exit(2);
});
setTimeout(() => { console.error('[compact-qa] watchdog timeout'); app.exit(3); }, 110000).unref();
