const WINDOW_STATE_VERSION = 8;
const DEFAULT_OPACITY = 0.9;
const MIN_OPACITY = 0.45;
const MAX_OPACITY = 1;
const COMPACT_HEIGHT = 160;
const TRANSITION_MS = 260;

const MODES = Object.freeze({
  compact: Object.freeze({ width: 420, height: COMPACT_HEIGHT, minWidth: 400, minHeight: COMPACT_HEIGHT, maxWidth: 800, maxHeight: COMPACT_HEIGHT }),
  expanded: Object.freeze({ width: 420, height: 630, minWidth: 400, minHeight: 520, maxWidth: 800, maxHeight: 1200 }),
});

function clampOpacity(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(MIN_OPACITY, Math.min(MAX_OPACITY, value))
    : DEFAULT_OPACITY;
}

function validBounds(value) {
  return value && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(value[key])) && value.width > 0 && value.height > 0;
}

function copyBounds(bounds) {
  return Object.fromEntries(['x', 'y', 'width', 'height'].map((key) => [key, Math.round(bounds[key])]));
}

function workAreaFor(bounds, screen) {
  if (validBounds(bounds)) return screen.getDisplayMatching(copyBounds(bounds)).workArea;
  return screen.getPrimaryDisplay().workArea;
}

function fitSize(bounds, compact, area) {
  const mode = compact ? MODES.compact : MODES.expanded;
  const fit = (value, fallback, min, max) => Math.max(Math.min(min, max), Math.min(max, Math.round(Number.isFinite(value) && value > 0 ? value : fallback)));
  const maxWidth = Math.max(1, Math.min(mode.maxWidth, area.width));
  const maxHeight = Math.max(1, Math.min(mode.maxHeight, area.height));
  return {
    width: fit(bounds?.width, mode.width, mode.minWidth, maxWidth),
    height: compact ? maxHeight : fit(bounds?.height, mode.height, mode.minHeight, maxHeight),
  };
}

/** Clamp only when restoring or changing modes, never during a native window drag. */
function clampBounds(bounds, compact, area) {
  const size = fitSize(bounds, compact, area);
  return {
    x: Math.max(area.x, Math.min(Math.round(bounds?.x ?? area.x), area.x + area.width - size.width)),
    y: Math.max(area.y, Math.min(Math.round(bounds?.y ?? area.y), area.y + area.height - size.height)),
    ...size,
  };
}

function defaultBounds(compact, screen) {
  const area = screen.getPrimaryDisplay().workArea;
  const size = fitSize(null, compact, area);
  return clampBounds({
    x: area.x + area.width - size.width - 28,
    y: area.y + 32,
    ...size,
  }, compact, area);
}

/** Preserve the current top-right corner, using the other mode's remembered size. */
function transitionBounds(current, remembered, compact, screen) {
  const area = workAreaFor(current, screen);
  const size = fitSize({ ...remembered, width: current.width }, compact, area);
  const target = clampBounds({ x: current.x + current.width - size.width, y: current.y, ...size }, compact, area);
  // At fractional scaling, moving an odd-DIP width to a different physical
  // pixel phase can change its reported width. When screen-edge clamping moves
  // x, keep the original phase, within at most three additional logical pixels.
  const scale = screen.getDisplayMatching(current).scaleFactor || 1;
  if (target.x !== current.x) {
    for (let offset = 0; offset <= 3; offset++) {
      const candidate = target.x - offset;
      const physicalDelta = (candidate - current.x) * scale;
      if (candidate >= area.x && Math.abs(physicalDelta - Math.round(physicalDelta)) < 1e-6) {
        target.x = candidate;
        break;
      }
    }
  }
  return target;
}

/**
 * v6 stored a single expanded rectangle. A missing mode always starts compact.
 * v7 mode rectangles store outer x/y and content width/height. Windows at 150%
 * scaling adds a small native border to getBounds(); feeding those outer sizes
 * into the next setBounds() request makes each mode toggle grow the window.
 */
function createInitialState(raw, screen) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const supported = source.version === undefined || source.version === 6 || source.version === 7 || source.version === WINDOW_STATE_VERSION;
  const legacy = supported && validBounds(source) ? source : null;
  const expandedSaved = supported && validBounds(source.expandedBounds) ? source.expandedBounds : legacy;
  const expandedBounds = expandedSaved
    ? clampBounds(expandedSaved, false, workAreaFor(expandedSaved, screen))
    : defaultBounds(false, screen);
  const compactSaved = supported && validBounds(source.compactBounds) ? source.compactBounds : null;
  const compactBounds = compactSaved
    ? transitionBounds({ ...compactSaved, width: expandedBounds.width, x: compactSaved.x + compactSaved.width - expandedBounds.width }, expandedBounds, true, screen)
    : transitionBounds(expandedBounds, null, true, screen);
  return {
    version: WINDOW_STATE_VERSION,
    pinned: typeof source.pinned === 'boolean' ? source.pinned : true,
    compact: typeof source.compact === 'boolean' ? source.compact : true,
    opacity: clampOpacity(source.opacity),
    compactBounds,
    expandedBounds,
  };
}

function getWindowOptions(state, platform = process.platform) {
  const mode = state.compact ? MODES.compact : MODES.expanded;
  const bounds = state.compact ? state.compactBounds : state.expandedBounds;
  return {
    ...bounds,
    minWidth: Math.min(mode.minWidth, bounds.width),
    minHeight: Math.min(mode.minHeight, bounds.height),
    maxWidth: mode.maxWidth,
    maxHeight: mode.maxHeight,
    // Keep the native window style stable; min/max height locks the compact bar.
    resizable: true,
    // On Windows, newly exposed opaque backing pixels can be erased white
    // before Chromium paints them. An alpha backing exposes the desktop instead.
    transparent: platform === 'win32',
    backgroundColor: platform === 'win32' ? '#00000000' : '#16181b',
  };
}

function createWindowManager({
  window: win,
  screen,
  initialState,
  persistState = () => {},
  onState = () => {},
  getPinned = () => initialState.pinned,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  saveDelayMs = 300,
  now = () => performance.now(),
  transitionMs = TRANSITION_MS,
}) {
  const state = { ...initialState, compactBounds: { ...initialState.compactBounds }, expandedBounds: { ...initialState.expandedBounds } };
  let applying = false;
  let dirty = false;
  let saveTimer = null;
  let disposed = false;
  let motion = null;
  let widthRequest = null;
  let heightRequest = null;
  const alive = () => !win.isDestroyed();
  const boundsKey = () => state.compact ? 'compactBounds' : 'expandedBounds';

  function readBounds() {
    const bounds = win.getBounds();
    const [width, height] = win.getContentSize();
    return { x: bounds.x, y: bounds.y, width, height };
  }

  function rememberBounds() {
    if (applying || !alive()) return;
    const bounds = readBounds();
    if (validBounds(bounds)) state[boundsKey()] = copyBounds(bounds);
  }

  function getState() {
    return { compact: state.compact, opacity: state.opacity, transitioning: Boolean(motion) };
  }

  function getSavedState() {
    rememberBounds();
    return {
      version: WINDOW_STATE_VERSION,
      pinned: Boolean(getPinned()),
      compact: state.compact,
      opacity: state.opacity,
      compactBounds: { ...state.compactBounds },
      expandedBounds: { ...state.expandedBounds },
    };
  }

  function flush() {
    if (saveTimer !== null) clearTimer(saveTimer);
    saveTimer = null;
    if (!dirty) return true;
    try {
      persistState(getSavedState());
      dirty = false;
      return true;
    } catch {
      // Keep preferences in memory; a later edit/quit can retry a failed write.
      return false;
    }
  }

  function scheduleSave() {
    if (disposed || applying) return;
    rememberBounds();
    dirty = true;
    if (saveTimer !== null) clearTimer(saveTimer);
    saveTimer = setTimer(() => { saveTimer = null; flush(); }, saveDelayMs);
    saveTimer?.unref?.();
  }

  function setBoundsStable(bounds) {
    const display = screen.getDisplayMatching(bounds);
    const displayKey = [display.id, display.scaleFactor].join(':');
    const widthKey = bounds.x + ':' + displayKey, heightKey = bounds.y + ':' + displayKey;
    const cachedWidth = widthRequest?.positionKey === widthKey && widthRequest.contentSize === bounds.width;
    const cachedHeight = heightRequest?.positionKey === heightKey && heightRequest.contentSize === bounds.height;
    let width = cachedWidth ? widthRequest.requestedSize : bounds.width;
    let height = cachedHeight ? heightRequest.requestedSize : bounds.height;
    win.setBounds({ ...bounds, width, height }, false);
    let [actualWidth, actualHeight] = win.getContentSize();
    // Alpha surfaces at fractional display coordinates may round content sizes
    // up by one DIP. Correct once and reuse requests, never their rounded output.
    const correctWidth = actualWidth !== bounds.width && !cachedWidth;
    const correctHeight = actualHeight !== bounds.height && !cachedHeight;
    if (correctWidth || correctHeight) {
      if (correctWidth) width = Math.max(1, width - (actualWidth - bounds.width));
      if (correctHeight) height = Math.max(1, height - (actualHeight - bounds.height));
      win.setBounds({ ...bounds, width, height }, false);
      [actualWidth, actualHeight] = win.getContentSize();
    }
    widthRequest = { positionKey: widthKey, requestedSize: width, contentSize: actualWidth };
    heightRequest = { positionKey: heightKey, requestedSize: height, contentSize: actualHeight };
  }

  function applyBounds(compact, bounds) {
    applying = true;
    try {
      // Change only size constraints. Toggling resizable on Windows rebuilds
      // the native frame and can briefly expose a white backing surface.
      win.setMinimumSize(1, 1);
      win.setMaximumSize(MODES.expanded.maxWidth, MODES.expanded.maxHeight);
      setBoundsStable(bounds);
      const mode = compact ? MODES.compact : MODES.expanded;
      win.setMinimumSize(Math.min(mode.minWidth, bounds.width), Math.min(mode.minHeight, bounds.height));
      win.setMaximumSize(mode.maxWidth, mode.maxHeight);
      // Contain the measured outer border without changing the requested content
      // size. This is a single mode-change adjustment, never a resize handler.
      const actual = win.getBounds();
      const area = workAreaFor(actual, screen);
      const x = Math.max(area.x, Math.min(actual.x, area.x + area.width - actual.width));
      const y = Math.max(area.y, Math.min(actual.y, area.y + area.height - actual.height));
      // On Windows setPosition itself can round-trip the outer dimensions and
      // grow them by a DIP. Reissue the original content size at the clamped
      // position without feeding native border dimensions back into the size.
      if (x !== actual.x || y !== actual.y) setBoundsStable({ ...bounds, x, y });
      state.compact = compact;
      state[boundsKey()] = copyBounds(readBounds());
    } finally {
      applying = false;
    }
  }

  function stopMotion() {
    if (!motion) return null;
    clearTimer(motion.timer);
    const resolve = motion.resolve;
    motion = null;
    applying = false;
    return resolve;
  }

  // Immediate changes remain available for restoration and diagnostics. User
  // actions opt into interpolation; each frame uses content dimensions only.
  function setCompact(value, { animate = false } = {}) {
    if (typeof value !== 'boolean') throw new TypeError('compact must be a boolean');
    if (!alive() || disposed) return getState();
    if (motion && value === state.compact && animate) return motion.promise;
    if (!motion && value === state.compact) return getState();
    rememberBounds();
    const current = readBounds();
    const superseded = stopMotion();
    const target = transitionBounds(current, state[value ? 'compactBounds' : 'expandedBounds'], value, screen);
    if (!animate || transitionMs <= 0) {
      applyBounds(value, target);
      scheduleSave();
      onState(getState());
      superseded?.(getState());
      return getState();
    }

    state.compact = value;
    // Persist endpoints, never the intermediate animation geometry.
    state[boundsKey()] = copyBounds(target);
    applying = true;
    win.setMinimumSize(1, 1);
    win.setMaximumSize(MODES.expanded.maxWidth, MODES.expanded.maxHeight);
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    const active = { promise, resolve, target, timer: null, start: now() };
    motion = active;
    function frame() {
      if (motion !== active) return;
      if (!alive()) { stopMotion()?.(getState()); return; }
      const progress = Math.min(1, Math.max(0, (now() - active.start) / transitionMs));
      if (progress === 1) {
        motion = null;
        applyBounds(value, target);
        scheduleSave();
        onState(getState());
        resolve(getState());
        return;
      }
      // Smoothstep starts and stops gently without overshoot or a spring bounce.
      const eased = progress * progress * (3 - 2 * progress);
      const bounds = Object.fromEntries(['x', 'y', 'width', 'height'].map(key =>
        [key, Math.round(current[key] + (target[key] - current[key]) * eased)]));
      setBoundsStable(bounds);
      active.timer = setTimer(frame, Math.min(16, Math.max(1, transitionMs - (now() - active.start))));
    }
    active.timer = setTimer(frame, 16);
    onState(getState());
    superseded?.(getState());
    return promise;
  }

  function setOpacity(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('opacity must be a finite number');
    const opacity = clampOpacity(value);
    if (!alive() || opacity === state.opacity) return getState();
    win.setOpacity(opacity);
    state.opacity = opacity;
    scheduleSave();
    onState(getState());
    return getState();
  }

  function resetAppearance() {
    if (!alive()) return getState();
    const current = readBounds();
    const superseded = stopMotion();
    state.expandedBounds = transitionBounds(current, null, false, screen);
    state.compactBounds = transitionBounds(current, null, true, screen);
    applyBounds(true, state.compactBounds);
    win.setOpacity(DEFAULT_OPACITY);
    state.opacity = DEFAULT_OPACITY;
    superseded?.(getState());
    scheduleSave();
    onState(getState());
    return getState();
  }

  function onGeometryChanged() {
    scheduleSave();
  }

  function dispose() {
    if (motion) {
      const target = motion.target;
      const resolve = stopMotion();
      if (alive()) applyBounds(state.compact, target);
      dirty = true;
      resolve?.(getState());
    }
    flush();
    disposed = true;
    win.removeListener('move', onGeometryChanged);
    win.removeListener('resize', onGeometryChanged);
  }

  // Settle the requested content size once before load. Both modes keep
  // the same native frame style; compact height is locked by min/max bounds.
  applyBounds(state.compact, state[boundsKey()]);
  win.setOpacity(state.opacity);
  win.on('move', onGeometryChanged);
  win.on('resize', onGeometryChanged);
  scheduleSave();
  return { getState, getSavedState, setCompact, setOpacity, resetAppearance, scheduleSave, flush, dispose };
}

module.exports = { WINDOW_STATE_VERSION, DEFAULT_OPACITY, MIN_OPACITY, MAX_OPACITY, COMPACT_HEIGHT, TRANSITION_MS, MODES, clampOpacity, clampBounds, transitionBounds, createInitialState, getWindowOptions, createWindowManager };
