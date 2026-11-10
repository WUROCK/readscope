const { app, BrowserWindow, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'artifacts', 'capture-data');
const SHOT_DIR = path.join(ROOT, 'artifacts', 'screenshots');

const logs = [];
function log(...args) {
  const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  console.log('[capture]', line);
  logs.push(line);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(win, expression, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const result = await win.webContents.executeJavaScript(expression, true);
      if (result) return result;
    } catch {
      /* page may still be loading */
    }
    await sleep(250);
  }
  throw new Error(`waitFor timeout: ${expression}`);
}

async function clickSelector(win, selector) {
  const ok = await win.webContents.executeJavaScript(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) { el.click(); return true; } return false; })()`,
    true,
  );
  if (!ok) throw new Error(`selector not found: ${selector}`);
}

async function clickByText(win, text) {
  const ok = await win.webContents.executeJavaScript(
    `(() => {
      const nodes = [...document.querySelectorAll('button, a, [role="button"]')];
      const target = nodes.find((el) => (el.textContent || '').replace(/\\s+/g, '').includes(${JSON.stringify(text)}));
      if (target) { target.click(); return true; }
      return false;
    })()`,
    true,
  );
  if (!ok) throw new Error(`button text not found: ${text}`);
}

async function capturePng(win) {
  const dbg = win.webContents.debugger;
  if (!dbg.isAttached()) dbg.attach('1.3');
  try {
    await dbg.sendCommand('Page.enable');
  } catch {
    /* already enabled */
  }
  const result = await dbg.sendCommand('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  return Buffer.from(String(result.data || ''), 'base64');
}

async function shot(win, name) {
  win.show();
  win.focus();
  win.setAlwaysOnTop(true, 'screen-saver');
  await sleep(850);
  const buffer = await capturePng(win);
  const file = path.join(SHOT_DIR, name);
  fs.writeFileSync(file, buffer);
  log(`saved ${name} ${buffer.length} bytes`);
  return buffer.length;
}

async function seedDemoData(port) {
  const base = `http://127.0.0.1:${port}/api`;
  const post = async (pathname, body) => {
    const response = await fetch(`${base}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`seed ${pathname} failed ${response.status}: ${text}`);
    }
    return response.json();
  };

  await fetch(`${base}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ recommendationSource: 'paper', goalMinutes: 45, checkinMinutes: 30 }),
  });

  for (let i = 0; i < 3; i += 1) {
    await post('/recommendations/refresh', { source: 'curated' });
  }

  const books = [
    {
      title: '毫米波雷达感知技术',
      author: '王明',
      totalPages: 320,
      currentPage: 48,
      domain: 'tech',
      tags: [],
    },
    {
      title: '多传感器融合理论',
      author: '李航',
      totalPages: 280,
      currentPage: 196,
      domain: 'tech',
      tags: [],
    },
    {
      title: '历史的温度',
      author: '张玮',
      totalPages: 360,
      currentPage: 120,
      domain: 'humanities',
      tags: [],
    },
  ];
  for (const book of books) await post('/books', book);
  log('seeded demo books and curated recommendation history');
}

async function boot() {
  await app.whenReady();
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  fs.rmSync(DATA_DIR, { recursive: true, force: true });

  const { startServer } = await import('../server/index.mjs');
  const handle = await startServer({
    port: 0,
    dataDir: DATA_DIR,
    fetchImpl: (url, options) => net.fetch(url, options),
  });
  fs.cpSync(path.join(ROOT, 'data', 'seed'), path.join(DATA_DIR, 'seed'), { recursive: true });
  log('server started on', handle.port, 'data', DATA_DIR);
  await seedDemoData(handle.port);

  const win = new BrowserWindow({
    width: 420,
    height: 630,
    show: true,
    frame: false,
    backgroundColor: '#08090c',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.on('console-message', (_event, level, message) => {
    if (String(message).includes('Error') || level >= 2) log('console:', level, message);
  });
  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    log('did-fail-load', code, description, url);
  });

  await win.loadURL(`http://127.0.0.1:${handle.port}/`);
  await waitFor(win, "!!document.querySelector('.compact-content') || !!document.querySelector('.tabs')");
  if (await win.webContents.executeJavaScript("!!document.querySelector('.compact-content')")) {
    await clickSelector(win, '[aria-label="展开完整面板"]');
  }
  await waitFor(win, "!!document.querySelector('.tabs') && !!document.querySelector('.page')");
  await sleep(1900);

  await win.webContents.executeJavaScript(
    "document.documentElement.style.background = 'linear-gradient(140deg,#05060a 0%,#14181f 45%,#08090c 100%)'; document.body.style.background = 'transparent'; true",
    true,
  );

  await shot(win, '01-reading.png');

  await clickSelector(win, '[role="tab"][aria-label="统计"]');
  await waitFor(
    win,
    "document.querySelector('[role=\"tab\"][aria-label=\"统计\"]')?.getAttribute('aria-selected') === 'true'",
  );
  await waitFor(win, "!!document.querySelector('.stats-hero')");
  await sleep(900);
  await shot(win, '02-stats.png');

  await clickSelector(win, '[role="tab"][aria-label="每日文献"]');
  await waitFor(
    win,
    "document.querySelector('[role=\"tab\"][aria-label=\"每日文献\"]')?.getAttribute('aria-selected') === 'true'",
  );
  await waitFor(win, "!!document.querySelector('.daily-card')");
  await sleep(900);
  await shot(win, '03-daily.png');

  await clickSelector(win, '[role="tab"][aria-label="在读"]');
  await waitFor(
    win,
    "document.querySelector('[role=\"tab\"][aria-label=\"在读\"]')?.getAttribute('aria-selected') === 'true'",
  );
  await waitFor(win, "!!document.querySelector('.reading-section')");
  await sleep(500);
  await clickSelector(win, '[aria-label="打开设置"]');
  await sleep(800);
  await shot(win, '04-settings.png');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ESCAPE' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'ESCAPE' });
  await sleep(900);
  await waitFor(win, "!document.querySelector('.modal-layer')");

  await clickSelector(win, '[aria-label="添加书籍"]');
  await waitFor(win, "!!document.querySelector('#book-form')");
  await sleep(700);
  await shot(win, '05-add-book.png');

  // 简洁横条：关闭弹窗 → 收起 → 按 160 高度截取三页摘要
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ESCAPE' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'ESCAPE' });
  await sleep(700);
  await clickSelector(win, '[aria-label="收起为简洁横条"]');
  await waitFor(win, "!!document.querySelector('.compact-content')");
  win.setContentSize(420, 160);
  await sleep(900);
  await shot(win, '13-compact-reading.png');

  await clickSelector(win, '#compact-tab-stats');
  await sleep(700);
  await shot(win, '15-compact-stats.png');

  await clickSelector(win, '#compact-tab-daily');
  await sleep(700);
  await shot(win, '16-compact-daily.png');

  await clickSelector(win, '#compact-tab-reading');
  await sleep(400);

  fs.writeFileSync(path.join(SHOT_DIR, 'capture.log'), logs.join('\n'), 'utf8');
  log('done');
  handle.close();
  app.exit(0);
}

boot().catch((error) => {
  console.error('[capture] FAILED', error);
  try {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    fs.writeFileSync(path.join(SHOT_DIR, 'capture.log'), (logs || []).join('\n') + '\nERROR: ' + (error.stack || String(error)), 'utf8');
  } catch {
    /* ignore */
  }
  app.exit(1);
});

setTimeout(() => {
  console.error('[capture] watchdog timeout');
  app.exit(2);
}, 90000);
