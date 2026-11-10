const { app, BrowserWindow, ipcMain, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'artifacts', 'manual-books-qa');
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

  async function fill(selector,value) {
    await click(selector);
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'A',modifiers:['control']});
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'A',modifiers:['control']});
    await win.webContents.insertText(String(value));
    await sleep(40);
  }
  async function enter() {
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});
    await wait('!document.querySelector("#book-form")');
  }
  const title='纸书流程验证';
  const getBook=async()=> (await (await fetch(base+'/api/books')).json()).items.find(item=>item.title===title);
  const readingTitle='[...document.querySelectorAll(".reading-section .reading-row__title")].some(e=>e.textContent==="'+title+'")';
  const completedTitle='[...document.querySelectorAll(".finished-section .reading-row__title")].some(e=>e.textContent==="'+title+'")';
  await click('[aria-label="展开完整面板"]');
  await click('[aria-label="添加书籍"]');
  await wait('!!document.querySelector("#book-title")');
  check(await js('document.activeElement.id==="book-title"'), 'add form focuses title');
  check(await js('!document.querySelector("#book-author") && !document.querySelector(".domain-picker")'), 'optional metadata starts collapsed');
  await fill('#book-title',title);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});
  await wait('document.activeElement.id==="book-total"');
  check(true, 'Enter after title advances to total pages');
  await fill('#book-total','320');
  check(await js('document.querySelector("#book-current").value===""'), 'new book starts at page zero without typing');
  await shot('22-add-book-simple');
  await enter();
  let book=await getBook();
  check(book && book.currentPage===0 && book.totalPages===320 && book.author==='', 'title and total pages alone create a book');
  await wait(readingTitle);
  await click('[aria-label="更新《'+title+'》阅读进度"]');
  await wait('!!document.querySelector("#book-current")');
  check(await js('document.activeElement.id==="book-current" && document.activeElement.selectionStart===0 && document.activeElement.selectionEnd===document.activeElement.value.length'), 'progress editor selects the current page');
  check(await js('!document.querySelector("#book-title") && !document.querySelector("#book-total")'), 'progress editor hides unchanged book fields');
  await fill('#book-current','319');
  check(await js('document.querySelector("#book-progress-hint").textContent.includes("99%") && !document.querySelector("#book-progress-hint").textContent.includes("归入已读完")'), 'one remaining page displays 99%');
  await shot('23-quick-progress');
  await enter();
  book=await getBook();check(book.currentPage===319 && !book.finished && book.progress===99,'Enter saves the page and keeps unfinished book active');
  await wait(readingTitle);
  await click('[aria-label="更新《'+title+'》阅读进度"]');
  await click('[aria-label="增加 20 页并保存"]');
  await wait('!document.querySelector("#book-form")');
  book=await getBook();check(book.currentPage===320 && book.finished,'quick increment clamps at total and completes');
  await wait('!('+readingTitle+')');
  check(await js('!!document.querySelector(".finished-toggle")'), 'completed shelf remains accessible');
  await click('.finished-toggle'); await wait(completedTitle);
  check(await js('document.querySelector(".finished-section").textContent.includes("已读完")'), 'completed shelf clearly labels finished status');
  await shot('24-finished-books');
  await click('.finished-section [aria-label="更新《'+title+'》阅读进度"]');
  await fill('#book-current','300'); await enter();
  book=await getBook();check(!book.finished && book.finishedAt===null,'correcting page reopens the completed book');
  await wait(readingTitle);check(!await js(completedTitle),'reopened book leaves completed shelf');
  await click('[aria-label="更新《'+title+'》阅读进度"]');
  await click('[aria-label="增加 10 页并保存"]');
  await wait('!document.querySelector("#book-form")');
  check((await getBook()).currentPage===310,'one shortcut click saves ten more pages');
  await click('[aria-label="更新《'+title+'》阅读进度"]'); await clickText('标记读完');
  await wait('!document.querySelector("#book-form")');
  check((await getBook()).finished,'one click marks the book finished');
  await wait('!('+readingTitle+')');
  // Editing metadata remains available without requiring it for each update.
  await click('.finished-section [aria-label="更新《'+title+'》阅读进度"]');
  await clickText('编辑书籍信息');
  await fill('#book-total','400'); await fill('#book-author','纸书作者');
  await shot('25-edit-book-details');
  await clickText('保存进度'); await wait('!document.querySelector("#book-form")');
  book=await getBook();check(book.author==='纸书作者' && book.totalPages===400 && book.currentPage===320 && !book.finished,'optional metadata edits preserve progress and recalculate completion');
  await wait(readingTitle);
  await click('[aria-label="更新《'+title+'》阅读进度"]'); await clickText('标记读完');
  await wait('!document.querySelector("#book-form")');
  await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload()});
  await wait('!!document.querySelector(".finished-toggle")');
  await click('.finished-toggle'); await wait(completedTitle);
  check(!await js(readingTitle),'completion grouping survives renderer reload');
  check((await (await fetch(base+'/api/books')).json()).items.filter(item=>item.title===title).length===1,'updates never create duplicate books');
  await click('[aria-label="收起为简洁横条"]');
  await wait('!!document.querySelector(".compact-content .reading-row__title")');
  check(await js('document.querySelector(".compact-content .reading-row__title").textContent')!==title,'compact mode skips completed book');
  fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify({passed,failed:0},null,2));
  manager.dispose();win.destroy();await server.close();app.exit(0);
}
run().catch(error=>{console.error(error.stack);fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify({passed,failed:1,error:error.stack},null,2));app.exit(1)});
setTimeout(()=>app.exit(2),90000).unref();
