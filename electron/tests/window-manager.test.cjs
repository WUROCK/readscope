const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  createInitialState,
  createWindowManager,
  getWindowOptions,
  clampOpacity,
  transitionBounds,
} = require('../window-manager.cjs');

const primary = { workArea: { x: 0, y: 0, width: 1440, height: 860 } };
const secondary = { workArea: { x: -1280, y: -120, width: 1280, height: 1024 } };

function mockScreen(displays = [primary]) {
  return {
    getPrimaryDisplay: () => displays[0],
    getDisplayMatching: (bounds) => {
      let best = displays[0];
      let bestArea = 0;
      for (const display of displays) {
        const area = display.workArea;
        const overlap = Math.max(0, Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x))
          * Math.max(0, Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y));
        if (overlap > bestArea) { bestArea = overlap; best = display; }
      }
      return best;
    },
  };
}

class MockWindow extends EventEmitter {
  constructor(options) {
    super();
    this.bounds = Object.fromEntries(['x', 'y', 'width', 'height'].map((key) => [key, options[key]]));
    this.min = [options.minWidth, options.minHeight];
    this.max = [options.maxWidth, options.maxHeight];
    this.resizable = options.resizable;
    this.opacity = 1;
    this.destroyed = false;
  }
  isDestroyed() { return this.destroyed; }
  getBounds() { return { ...this.bounds }; }
  getContentSize() { return [this.bounds.width, this.bounds.height]; }
  setPosition(x, y) { this.bounds = { ...this.bounds, x, y }; this.emit('move'); }
  setResizable(value) { this.resizable = value; }
  constrainSize() {
    const old = this.bounds;
    this.bounds = {
      ...old,
      width: Math.max(this.min[0], Math.min(this.max[0], old.width)),
      height: Math.max(this.min[1], Math.min(this.max[1], old.height)),
    };
    if (old.width !== this.bounds.width || old.height !== this.bounds.height) this.emit('resize');
  }
  setMinimumSize(...value) { this.min = value; this.constrainSize(); }
  setMaximumSize(...value) { this.max = value; this.constrainSize(); }
  setBounds(value) {
    this.bounds = { ...value };
    this.constrainSize();
    this.emit('resize');
    this.emit('move');
  }
  setOpacity(value) { this.opacity = value; }
}

/** Model Windows 150% DPI: setBounds requests content dimensions, but getBounds
 * returns a 1 DIP border; the initial non-resizable style adds two more pixels. */
class DpiWindow extends MockWindow {
  constructor(options) {
    super(options);
    this.bounds.width += 2;
    this.bounds.height += 2;
  }
  getBounds() { return { ...this.bounds, width: this.bounds.width + 1, height: this.bounds.height + 1 }; }
  setPosition() { throw new Error('Position-only API must not round-trip DPI outer dimensions'); }
}

function setup(raw = {}, screen = mockScreen(), WindowClass = MockWindow) {
  const initialState = createInitialState(raw, screen);
  const win = new WindowClass(getWindowOptions(initialState));
  const saved = [];
  const notifications = [];
  const timers = new Map();
  let nextTimer = 0;
  const manager = createWindowManager({
    window: win,
    screen,
    initialState,
    persistState: (state) => saved.push(state),
    onState: (state) => notifications.push(state),
    setTimer: (callback) => { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimer: (id) => timers.delete(id),
  });
  return { win, manager, saved, notifications, timers, runTimers() { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } } };
}


test('shared width: first launch is a 420 by 160 content preview',()=>{
 const {win,manager}=setup();assert.deepEqual(win.getContentSize(),[420,160]);assert.equal(manager.getSavedState().version,8);assert.equal(win.opacity,.9);manager.dispose();
});
test('v7 migration uses the saved expanded width for the new two-row preview',()=>{
 const {win,manager}=setup({version:7,compact:true,opacity:.7,compactBounds:{x:100,y:30,width:520,height:64},expandedBounds:{x:200,y:30,width:480,height:700}});
 assert.deepEqual(win.getContentSize(),[480,160]);assert.equal(win.opacity,.7);manager.setCompact(false);assert.deepEqual(win.getContentSize(),[480,700]);manager.dispose();
});
test('40 round trips keep exactly the same width and horizontal position',()=>{
 const {win,manager}=setup();const first=win.getBounds();for(let i=0;i<40;i++){manager.setCompact(false);assert.equal(win.getBounds().width,first.width);assert.equal(win.getBounds().x,first.x);manager.setCompact(true);assert.deepEqual(win.getBounds(),first);}manager.dispose();
});
test('a user resize becomes the shared width in both modes',()=>{
 const {win,manager}=setup();manager.setCompact(false);win.setBounds({x:200,y:40,width:610,height:735});manager.setCompact(true);assert.deepEqual(win.getContentSize(),[610,160]);manager.setCompact(false);assert.deepEqual(win.getContentSize(),[610,735]);manager.dispose();
});
test('DPI border never feeds back into the shared content width',()=>{
 const {win,manager}=setup({},mockScreen(),DpiWindow);const first=win.getBounds();for(let i=0;i<40;i++){manager.setCompact(false);assert.equal(win.getContentSize()[0],420);manager.setCompact(true);assert.deepEqual(win.getBounds(),first);}manager.dispose();
});
test('opacity and geometry remain debounced and persist across restart',()=>{
 const {manager,saved,runTimers}=setup();manager.setOpacity(.45);manager.setOpacity(.73);assert.equal(saved.length,0);runTimers();assert.equal(saved.length,1);assert.equal(saved[0].opacity,.73);const again=setup(saved[0]);assert.deepEqual(again.win.getContentSize(),[420,160]);manager.dispose();again.manager.dispose();
});

test('switching modes never rebuilds the native resizable frame style', () => {
  const {win, manager} = setup();
  assert.equal(win.resizable, true);
  win.setResizable = () => { throw Error('native frame restyle can flash white'); };
  for(let i=0; i<20; i++) { manager.setCompact(false); manager.setCompact(true); }
  assert.equal(win.resizable, true);
  assert.equal(win.min[1], win.max[1]);
  manager.dispose();
});


function animatedSetup(raw = {}, WindowClass = MockWindow) {
  const screen = mockScreen(), initialState = createInitialState(raw, screen);
  const win = new WindowClass(getWindowOptions(initialState));
  let clock = 0, sequence = 0;
  const tasks = new Map(), saved = [], frames = [];
  const manager = createWindowManager({ window: win, screen, initialState,
    now: () => clock, persistState: value => saved.push(value),
    setTimer: (fn, delay) => { const id = ++sequence; tasks.set(id, {fn, at: clock + delay}); return id; },
    clearTimer: id => tasks.delete(id),
  });
  win.on('resize', () => frames.push(win.getBounds()));
  function advance(milliseconds) {
    const end = clock + milliseconds;
    while (true) {
      const next = [...tasks].sort((a,b) => a[1].at-b[1].at).find(([,task]) => task.at <= end);
      if (!next) break;
      tasks.delete(next[0]); clock = next[1].at; next[1].fn();
    }
    clock = end;
  }
  return { win, manager, saved, frames, advance, tasks };
}

test('animated expansion interpolates height monotonically and saves only endpoints', async () => {
  const { win, manager, frames, advance, saved } = animatedSetup();
  const first = win.getBounds(), done = manager.setCompact(false, { animate: true });
  assert.equal(manager.getState().transitioning, true);
  advance(128);
  assert.ok(win.getContentSize()[1] > 160 && win.getContentSize()[1] < 630);
  assert.equal(manager.getSavedState().expandedBounds.height, 630);
  assert.equal('transitioning' in manager.getSavedState(), false);
  advance(132); await done;
  assert.equal(manager.getState().transitioning, false);
  assert.deepEqual(win.getContentSize(), [420, 630]);
  assert.ok(frames.length >= 10);
  for(let i=1;i<frames.length;i++) {
    assert.ok(frames[i].height >= frames[i-1].height);
    assert.equal(frames[i].width, first.width); assert.equal(frames[i].x, first.x);
  }
  advance(300);
  assert.equal(saved.at(-1).expandedBounds.height, 630);
  manager.dispose();
});
test('rapid reversal cancels old frames without a jump or lost expanded size', async () => {
  const {win, manager, advance} = animatedSetup();
  const open = manager.setCompact(false, {animate:true}); advance(112);
  const midway = win.getBounds();
  const close = manager.setCompact(true, {animate:true});
  assert.deepEqual(win.getBounds(), midway);
  advance(260); await Promise.all([open,close]);
  assert.deepEqual(win.getContentSize(), [420,160]);
  assert.equal(manager.getSavedState().expandedBounds.height,630);
  const reopen = manager.setCompact(false, {animate:true}); advance(260); await reopen;
  assert.deepEqual(win.getContentSize(), [420,630]); manager.dispose();
});
test('DPI animation round trips keep width and origin stable', async () => {
  const {win,manager,advance} = animatedSetup({}, DpiWindow), first = win.getBounds();
  for(let i=0;i<12;i++) {
    let done=manager.setCompact(false,{animate:true});advance(260);await done;
    done=manager.setCompact(true,{animate:true});advance(260);await done;
    assert.deepEqual(win.getBounds(),first);
  }
  manager.dispose();
});
test('reduced motion snaps to the endpoint and disposal flushes a valid final size', async () => {
  const {win,manager,advance,saved,tasks} = animatedSetup();
  manager.setCompact(false,{animate:false});
  assert.deepEqual(win.getContentSize(),[420,630]);
  assert.equal(manager.getState().transitioning,false);
  const done=manager.setCompact(true,{animate:true});advance(80);manager.dispose();await done;
  assert.equal(tasks.size,0);
  assert.deepEqual(win.getContentSize(),[420,160]);
  assert.equal(saved.at(-1).expandedBounds.height,630);
  assert.equal(saved.at(-1).compactBounds.height,160);
});
test('near the screen bottom the animated target remains inside the work area', async () => {
  const {win,manager,advance} = animatedSetup({compactBounds:{x:600,y:680,width:420,height:160}});
  const done=manager.setCompact(false,{animate:true});advance(260);await done;
  const bounds=win.getBounds();assert.ok(bounds.y>=0);assert.ok(bounds.y+bounds.height<=860);
  manager.dispose();
});

test('Windows uses an alpha native backing while preserving static edge resizing', () => {
  const initial = createInitialState({}, mockScreen());
  const options = getWindowOptions(initial, 'win32');
  assert.equal(options.transparent, true);
  assert.equal(options.backgroundColor, '#00000000');
  assert.equal(options.resizable, true);
  const opaque = getWindowOptions(initial, 'darwin');
  assert.equal(opaque.transparent, false);
  assert.equal(opaque.backgroundColor, '#16181b');
});


/** Model alpha backing at a fractional Windows display origin. */
class AlphaRoundingWindow extends MockWindow {
  constructor(options) { super(options); this.bounds.width++; this.requests=[]; }
  setBounds(value) { this.requests.push({...value}); super.setBounds({...value,width:value.width+1}); }
}
test('alpha width rounding is calibrated once and cannot accumulate across modes', () => {
  const {win,manager}=setup({},mockScreen(),AlphaRoundingWindow);
  assert.equal(win.getContentSize()[0],420);
  const initialRequests=win.requests.length;
  for(let i=0;i<30;i++) { manager.setCompact(false); manager.setCompact(true); assert.equal(win.getContentSize()[0],420); }
  assert.ok(win.requests.slice(initialRequests).every(bounds=>bounds.width===419));
  win.setBounds({...win.getBounds(),width:540,height:740});
  const resized=win.getContentSize()[0];
  manager.setCompact(false); assert.equal(win.getContentSize()[0],resized);
  manager.setCompact(true); assert.equal(win.getContentSize()[0],resized);
  manager.dispose();
});
test('alpha animation reuses its calibrated width for every frame', async () => {
  const {win,manager,advance}=animatedSetup({},AlphaRoundingWindow);
  const before=win.requests.length;
  let done=manager.setCompact(false,{animate:true});advance(260);await done;
  done=manager.setCompact(true,{animate:true});advance(260);await done;
  assert.deepEqual(win.getContentSize(),[420,160]);
  assert.ok(win.requests.slice(before).every(bounds=>bounds.width===419));
  manager.dispose();
});

test('screen-edge clamping preserves the physical pixel phase at 150% scaling', () => {
  const screen=mockScreen([{...primary,scaleFactor:1.5}]);
  const current={x:1000,y:40,width:541,height:740};
  const target=transitionBounds(current,null,true,screen);
  assert.equal(target.width,current.width);
  assert.equal(target.x,898);
  assert.ok(target.x+target.width<=primary.workArea.width);
  assert.equal(Number.isInteger((target.x-current.x)*1.5),true);
});

class AlphaSizeRoundingWindow extends AlphaRoundingWindow {
  constructor(options) { super(options); this.bounds.height++; }
  setBounds(value) { super.setBounds({...value,height:value.height+1}); }
}
test('alpha height rounding cannot change compact height or grow saved expanded size', () => {
  const {win,manager}=setup({},mockScreen(),AlphaSizeRoundingWindow);
  for(let i=0;i<30;i++) {
    assert.deepEqual(win.getContentSize(),[420,160]);
    manager.setCompact(false);assert.deepEqual(win.getContentSize(),[420,630]);
    manager.setCompact(true);
  }
  assert.equal(manager.getSavedState().expandedBounds.height,630);
  manager.dispose();
});
