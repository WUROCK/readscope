const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen, shell, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { createInitialState, getWindowOptions, createWindowManager } = require('./window-manager.cjs');
require('./logging.cjs').installFileLogging(path.join(app.getPath('userData'), 'logs', 'readscope.log'));

const ROOT = path.resolve(__dirname, '..');
const IS_DEV = Boolean(process.env.VITE_DEV_SERVER_URL);
const DATA_DIR = process.env.READSCOPE_DATA_DIR || path.join(ROOT, 'data');

let mainWindow = null;
let tray = null;
let serverHandle = null;
let isQuitting = false;
let pinned = true;
let windowManager = null;

const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    return {};
  }
}

function getDesktopState() {
  return {
    pinned,
    ...(windowManager?.getState() || { compact: true, opacity: 0.9 }),
    isDesktop: true,
    dataDir: DATA_DIR,
    version: app.getVersion(),
    platform: process.platform,
  };
}

function broadcastDesktopState() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('desktop:state', getDesktopState());
}

async function setCompact(value, options) {
  // Tray actions have no renderer-supplied preference; query the same media
  // setting used by the buttons so reduced motion also applies from the tray.
  let animate = options?.animate;
  if (animate === undefined && mainWindow && !mainWindow.isDestroyed()) {
    animate = await mainWindow.webContents.executeJavaScript("!matchMedia('(prefers-reduced-motion: reduce)').matches")
      .catch(() => true);
  }
  await windowManager?.setCompact(value, { animate: animate !== false });
  rebuildTrayMenu();
  return getDesktopState();
}

function setPinned(value) {
  pinned = Boolean(value);
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setAlwaysOnTop(pinned, 'floating');
  broadcastDesktopState();
  rebuildTrayMenu();
  windowManager?.scheduleSave();
}

function togglePin() {
  setPinned(!pinned);
  return pinned;
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function toggleWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
    mainWindow.hide();
  } else {
    showWindow();
  }
}

function rebuildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: mainWindow && mainWindow.isVisible() ? '隐藏阅界' : '显示阅界', click: toggleWindow },
      {
        label: '窗口置顶',
        type: 'checkbox',
        checked: pinned,
        click: (item) => setPinned(item.checked),
      },
      {
        label: '简洁条',
        type: 'checkbox',
        checked: windowManager?.getState().compact ?? true,
        click: (item) => setCompact(item.checked),
      },
      {
        label: '重置窗口外观',
        click: () => {
          windowManager?.resetAppearance();
          rebuildTrayMenu();
          showWindow();
        },
      },
      { type: 'separator' },
      { label: '打开数据文件夹', click: () => shell.openPath(DATA_DIR) },
      {
        label: '重新同步微信读书',
        click: () => {
          showWindow();
          if (mainWindow) mainWindow.webContents.send('desktop:refresh');
        },
      },
      { type: 'separator' },
      {
        label: '退出阅界',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray.png');
  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    image = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')).resize({ width: 32, height: 32 });
  }
  tray = new Tray(image);
  tray.setToolTip('阅界 · 阅读助手');
  tray.on('click', toggleWindow);
  rebuildTrayMenu();
}

function findChrome() {
  const candidates = [
    process.env.READSCOPE_CHROME_PATH,
    process.env.CHROME_PATH,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  return candidates.find((file) => {
    try {
      return fs.existsSync(file);
    } catch {
      return false;
    }
  }) || null;
}

/**
 * 外部链接优先在 Chrome 新标签页打开（用户明确要求）；
 * 非 http(s) 深链或没有 Chrome 时回退系统默认浏览器。
 */
async function openExternalUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    return false;
  }
  if (!['http:', 'https:', 'weread:'].includes(parsed.protocol)) return false;
  const url = parsed.toString();
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    const chrome = findChrome();
    if (chrome) {
      try {
        const child = spawn(chrome, [url], { detached: true, stdio: 'ignore', windowsHide: true });
        child.unref();
        console.log(`[readscope] open external via Chrome: ${url.slice(0, 120)}`);
        return true;
      } catch {
        /* fall through to default browser */
      }
    }
  }
  try {
    await shell.openExternal(url);
    console.log(`[readscope] open external via default browser: ${url.slice(0, 120)}`);
    return true;
  } catch {
    return false;
  }
}

function registerIpc() {
  ipcMain.handle('desktop:get-state', getDesktopState);
  ipcMain.handle('desktop:minimize', () => mainWindow && mainWindow.minimize());
  ipcMain.handle('desktop:hide', () => mainWindow && mainWindow.hide());
  ipcMain.handle('desktop:quit', () => {
    isQuitting = true;
    app.quit();
  });
  ipcMain.handle('desktop:toggle-pin', () => togglePin());
  ipcMain.handle('desktop:set-compact', (_event, compact, options) => setCompact(compact, options));
  ipcMain.handle('desktop:set-opacity', (_event, opacity) => {
    windowManager?.setOpacity(opacity);
    return getDesktopState();
  });
  ipcMain.handle('desktop:open-external', async (_event, url) => openExternalUrl(url));
  ipcMain.handle('desktop:open-data-folder', async () => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const error = await shell.openPath(DATA_DIR);
    return error === '';
  });
}

async function createMainWindow() {
  const initialState = createInitialState(loadWindowState(), screen);
  pinned = initialState.pinned;
  mainWindow = new BrowserWindow({
    ...getWindowOptions(initialState),
    frame: false,
    thickFrame: true,
    roundedCorners: true,
    hasShadow: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: '阅界 · 阅读助手',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  windowManager = createWindowManager({
    window: mainWindow,
    screen,
    initialState,
    getPinned: () => pinned,
    persistState: (state) => fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2), 'utf8'),
    onState: broadcastDesktopState,
  });
  mainWindow.setAlwaysOnTop(pinned, 'floating');
  // 位置与尺寸交给系统处理，避免移动/缩放时反复纠偏而抖动。
  mainWindow.setMenuBarVisibility(false);
  Menu.setApplicationMenu(null);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|weread):/i.test(url)) void openExternalUrl(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow.webContents.getURL();
    if (url !== current) {
      event.preventDefault();
      if (/^(https?|weread):/i.test(url)) void openExternalUrl(url);
    }
  });

  mainWindow.once('ready-to-show', showWindow);
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('show', rebuildTrayMenu);
  mainWindow.on('hide', rebuildTrayMenu);

  const target = IS_DEV ? process.env.VITE_DEV_SERVER_URL : `http://127.0.0.1:${serverHandle.port}`;
  await mainWindow.loadURL(target);
  if (IS_DEV && process.env.OPEN_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

async function boot() {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }
  app.on('second-instance', showWindow);
  app.setAppUserModelId('com.readscope.widget');

  await app.whenReady();

  const { startServer } = await import('../server/index.mjs');
  const port = IS_DEV ? Number(process.env.PORT || 7411) : 0;
  // 微信读书网关在 Chromium 网络栈下会超时，走 Node 原生 fetch 直连；
  // 其他外网请求（arXiv / 公众号）继续用 net.fetch 以继承系统代理。
  const hybridFetch = (url, options) => {
    const target = typeof url === 'string' ? url : String(url?.url || url || '');
    if (/^https:\/\/i\.weread\.qq\.com\//i.test(target)) return globalThis.fetch(target, options);
    return net.fetch(url, options);
  };
  serverHandle = await startServer({ port, dataDir: DATA_DIR, fetchImpl: hybridFetch });
  console.log(`[readscope] API on http://127.0.0.1:${serverHandle.port} | data: ${DATA_DIR}`);

  registerIpc();
  await createMainWindow();
  createTray();
  startAutoCheckinLoop();

  app.on('activate', showWindow);
  app.on('before-quit', () => {
    isQuitting = true;
    windowManager?.flush();
  });
  app.on('will-quit', () => {
    windowManager?.dispose();
    if (autoCheckinTimer) clearInterval(autoCheckinTimer);
    try {
      if (serverHandle) serverHandle.close();
    } catch {
      /* ignore */
    }
  });
}

let autoCheckinTimer = null;

/**
 * 窗口隐藏或最小化时每 10 分钟做一次轻量自动打卡检查。
 * 窗口可见时前端自己有 5 分钟刷新，避免重复请求。
 */
async function autoCheckinTick() {
  if (!serverHandle) return;
  try {
    if (mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized()) return;
    const response = await net.fetch(`http://127.0.0.1:${serverHandle.port}/api/checkin/auto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) return;
    const result = await response.json();
    if (result?.configured && result?.changed) {
      console.log(`[readscope] 自动打卡 ${result.date} · ${result.minutes} 分钟`);
      tray?.setToolTip(`阅界 · 今日已打卡 ${result.minutes} 分钟`);
    }
  } catch {
    /* 后台检查失败不打扰用户，下一次再试 */
  }
}

function startAutoCheckinLoop() {
  if (autoCheckinTimer) clearInterval(autoCheckinTimer);
  autoCheckinTimer = setInterval(autoCheckinTick, 10 * 60 * 1000);
  if (typeof autoCheckinTimer.unref === 'function') autoCheckinTimer.unref();
  const firstCheck = setTimeout(autoCheckinTick, 2 * 60 * 1000);
  if (typeof firstCheck.unref === 'function') firstCheck.unref();
}

app.on('window-all-closed', () => {
  // Keep running in the tray.
});

boot().catch((error) => {
  console.error('[readscope] fatal:', error);
  app.quit();
});
