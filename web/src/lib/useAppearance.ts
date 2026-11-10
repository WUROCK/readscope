import { flushSync } from 'react-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShowToast } from '../components/Toast';
import type { DesktopState } from './types';

const STORAGE_KEY = 'readscope.appearance.v1';
const DEFAULT_APPEARANCE = { compact: true, opacity: 0.9 };

function normalizeOpacity(value: number): number {
  return Math.round(Math.min(1, Math.max(0.45, value)) * 100) / 100;
}

function readAppearance() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return {
      compact: typeof saved?.compact === 'boolean' ? saved.compact : true,
      opacity: typeof saved?.opacity === 'number' && Number.isFinite(saved.opacity)
        ? normalizeOpacity(saved.opacity) : 0.9,
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function useAppearance(showToast: ShowToast) {
  const [appearance, setAppearance] = useState(readAppearance);
  const latest = useRef(appearance);
  latest.current = appearance;

  const applyState = useCallback((state: DesktopState | void) => {
    if (!state) return;
    setAppearance((current) => ({
      compact: typeof state.compact === 'boolean' ? state.compact : current.compact,
      opacity: typeof state.opacity === 'number' && Number.isFinite(state.opacity)
        ? normalizeOpacity(state.opacity) : current.opacity,
    }));
  }, []);

  useEffect(() => {
    const desktop = window.desktop;
    let active = true;
    Promise.resolve(desktop?.getState?.()).then((state) => {
      if (active) applyState(state);
    }).catch(() => { /* Browser preferences still work without the desktop bridge. */ });
    const off = desktop?.onState?.((state) => { if (active) applyState(state); });
    return () => {
      active = false;
      if (typeof off === 'function') off();
    };
  }, [applyState]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance)); } catch { /* optional */ }
  }, [appearance]);

  const setCompact = useCallback(async (compact: boolean): Promise<boolean> => {
    const previous = latest.current.compact;
    try {
      // Commit the destination contents before the native viewport grows.
      flushSync(() => setAppearance(current => ({ ...current, compact })));
      const state = await window.desktop?.setCompact?.(compact, {
        animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      });
      applyState(state ?? { compact });
      return true;
    } catch {
      setAppearance(current => ({ ...current, compact: previous }));
      showToast('窗口切换失败，请重试', 'error');
      return false;
    }
  }, [applyState, showToast]);

  const setOpacity = useCallback(async (value: number): Promise<boolean> => {
    const opacity = normalizeOpacity(value);
    const previous = latest.current.opacity;
    setAppearance((current) => ({ ...current, opacity }));
    try {
      const state = await window.desktop?.setOpacity?.(opacity);
      applyState(state ?? { opacity });
      return true;
    } catch {
      setAppearance((current) => ({ ...current, opacity: previous }));
      showToast('透明度调整失败，请重试', 'error');
      return false;
    }
  }, [applyState, showToast]);

  return { ...appearance, setCompact, setOpacity };
}
