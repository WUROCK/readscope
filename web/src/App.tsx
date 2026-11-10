import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { api, errorMessage, openExternal } from './lib/api';
import { domainMeta } from './lib/domains';
import { FIXTURES, applyPreviewGoals, nextPreviewRecommendation } from './lib/fixtures';
import { percentOf } from './lib/format';
import { useAppearance } from './lib/useAppearance';
import type {
  AppMode,
  ManualBook,
  ManualBookInput,
  RecommendationResponse,
  Settings,
  SettingsUpdate,
  WereadBook,
  WereadOverview,
  WereadTestResult,
} from './lib/types';
import { BookModal, type BookSaveResult } from './components/BookModal';
import { CompactBar } from './components/CompactBar';
import { SettingsModal } from './components/SettingsModal';
import { TitleBar } from './components/TitleBar';
import { ToastContext, ToastViewport, type ShowToast, type ToastItem } from './components/Toast';
import { DailyPage } from './pages/DailyPage';
import { ReadingPage } from './pages/ReadingPage';
import { StatsPage } from './pages/StatsPage';

type BookModalState = ManualBook | 'new' | null;

const AUTO_REFRESH_MS = 5 * 60 * 1000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function maskPreviewKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return 'wrk-••••••••';
  return `${trimmed.slice(0, 8)}••••••••`;
}

function previewBookTags(input: ManualBookInput, existing?: ManualBook): string[] {
  const meta = domainMeta(input.domain);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of [...(existing?.tags ?? []), meta.name]) {
    const tag = String(value ?? '').trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
    if (result.length >= 6) break;
  }
  return result;
}

function makePreviewBook(input: ManualBookInput, existing?: ManualBook): ManualBook {
  const now = new Date().toISOString();
  const finished = input.currentPage >= input.totalPages;
  return {
    id: existing?.id ?? `bk_preview_${Date.now().toString(36)}`,
    ...input,
    progress: finished ? 100 : Math.min(99, percentOf(input.currentPage, input.totalPages)),
    finished,
    domainName: domainMeta(input.domain).name,
    tags: previewBookTags(input, existing),
    estimatedMinutesRemaining: Math.max(0, Math.round((input.totalPages - input.currentPage) * 1.4)),
    addedAt: existing?.addedAt ?? now,
    updatedAt: now,
    finishedAt: finished ? (existing?.finishedAt ?? now) : null,
  };
}

export default function App() {
  const [mode, setMode] = useState<AppMode>('loading');
  const [overview, setOverview] = useState<WereadOverview>(FIXTURES.overview);
  const [settings, setSettings] = useState<Settings>(FIXTURES.settings);
  const [books, setBooks] = useState<ManualBook[]>([]);
  const [recommendation, setRecommendation] = useState<RecommendationResponse>(
    FIXTURES.recommendation,
  );

  const [overviewLoading, setOverviewLoading] = useState(true);
  const [booksLoading, setBooksLoading] = useState(true);
  const [recLoading, setRecLoading] = useState(true);
  const [refreshingOverview, setRefreshingOverview] = useState(false);
  const [refreshingRec, setRefreshingRec] = useState(false);

  const [pageIndex, setPageIndex] = useState(0);
  const [dragX, setDragX] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bookModal, setBookModal] = useState<BookModalState>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const modeRef = useRef<AppMode>('loading');
  const previousCheckedIn = useRef<boolean | null>(FIXTURES.overview.today.checkedIn);
  const toastTimers = useRef(new Map<number, number>());
  const toastSeq = useRef(0);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const showToast: ShowToast = useCallback((message, kind = 'info') => {
    const id = ++toastSeq.current;
    setToasts((previous) => [...previous.slice(-2), { id, message, kind }]);
    const timer = window.setTimeout(() => {
      setToasts((previous) => previous.filter((toast) => toast.id !== id));
      toastTimers.current.delete(id);
    }, 3600);
    toastTimers.current.set(id, timer);
  }, []);

  const { compact, opacity, setCompact, setOpacity } = useAppearance(showToast);

  const openSettings = useCallback(async () => {
    if (await setCompact(false)) setSettingsOpen(true);
  }, [setCompact]);

  useEffect(
    () => () => {
      for (const timer of toastTimers.current.values()) window.clearTimeout(timer);
      toastTimers.current.clear();
    },
    [],
  );

  const applyOverview = useCallback(
    (next: WereadOverview, announceCheckin = true) => {
      const wasCheckedIn = previousCheckedIn.current;
      previousCheckedIn.current = next.today.checkedIn;
      setOverview(next);
      if (announceCheckin && wasCheckedIn === false && next.today.checkedIn) {
        showToast(`今日打卡成功 · 连续 ${next.today.streak} 天`, 'success');
      }
    },
    [showToast],
  );

  const loadOverview = useCallback(
    async (options?: { refresh?: boolean; fallback?: boolean; announce?: boolean }) => {
      try {
        const data = await api.getOverview(Boolean(options?.refresh));
        applyOverview(data, options?.announce !== false);
      } catch (error) {
        if (options?.fallback) {
          setOverview(FIXTURES.overview);
          previousCheckedIn.current = FIXTURES.overview.today.checkedIn;
        }
        showToast(
          `${options?.fallback ? '阅读数据加载失败，已显示预览数据' : '刷新失败'}：${errorMessage(error)}`,
          'error',
        );
      }
    },
    [applyOverview, showToast],
  );

  const loadSettings = useCallback(
    async (options?: { fallback?: boolean }) => {
      try {
        const data = await api.getSettings();
        setSettings(data);
      } catch (error) {
        if (options?.fallback) setSettings(FIXTURES.settings);
        showToast(
          `设置加载失败${options?.fallback ? '，已显示预览设置' : ''}：${errorMessage(error)}`,
          'error',
        );
      }
    },
    [showToast],
  );

  const reloadBooks = useCallback(
    async (fallback = false) => {
      try {
        const data = await api.getBooks();
        setBooks(data.items);
      } catch (error) {
        if (fallback) setBooks(FIXTURES.books.items);
        showToast(
          `书单加载失败${fallback ? '，已显示预览数据' : ''}：${errorMessage(error)}`,
          'error',
        );
      }
    },
    [showToast],
  );

  const loadRecommendation = useCallback(
    async (fallback = false) => {
      try {
        const data = await api.getRecommendation();
        setRecommendation(data);
      } catch (error) {
        if (fallback) setRecommendation(FIXTURES.recommendation);
        showToast(
          `今日文献加载失败${fallback ? '，已显示预览数据' : ''}：${errorMessage(error)}`,
          'error',
        );
      }
    },
    [showToast],
  );

  /* --------------------------- 启动与自动刷新 --------------------------- */

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      let live = false;
      try {
        const health = await api.health();
        live = Boolean(health.ok);
      } catch {
        live = false;
      }
      if (cancelled) return;

      if (!live) {
        setMode('preview');
        modeRef.current = 'preview';
        setOverview(FIXTURES.overview);
        setSettings(FIXTURES.settings);
        setBooks(FIXTURES.books.items);
        setRecommendation(FIXTURES.recommendation);
        previousCheckedIn.current = FIXTURES.overview.today.checkedIn;
        setOverviewLoading(false);
        setBooksLoading(false);
        setRecLoading(false);
        return;
      }

      setMode('live');
      modeRef.current = 'live';

      void (async () => {
        await loadOverview({ refresh: true, fallback: true, announce: false });
        if (!cancelled) setOverviewLoading(false);
      })();
      void loadSettings({ fallback: true });
      void (async () => {
        await reloadBooks(true);
        if (!cancelled) setBooksLoading(false);
      })();
      void (async () => {
        await loadRecommendation(true);
        if (!cancelled) setRecLoading(false);
      })();
    }

    void boot();

    return () => {
      cancelled = true;
    };
  }, [loadOverview, loadSettings, loadRecommendation, reloadBooks]);

  useEffect(() => {
    if (mode !== 'live') return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadOverview({ refresh: true });
      }
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [mode, loadOverview]);

  /* ------------------------------- 刷新 ------------------------------- */

  const refreshOverview = useCallback(async () => {
    if (modeRef.current === 'preview') {
      setOverview((previous) => ({ ...previous, updatedAt: new Date().toISOString() }));
      showToast('预览数据已刷新（不会写入后端）', 'info');
      return;
    }
    if (refreshingOverview) return;
    setRefreshingOverview(true);
    try {
      await loadOverview({ refresh: true });
    } finally {
      setRefreshingOverview(false);
    }
  }, [loadOverview, refreshingOverview, showToast]);

  const refreshRecommendation = useCallback(async () => {
    if (refreshingRec) return;
    setRefreshingRec(true);
    if (modeRef.current === 'preview') {
      await delay(650);
      setRecommendation((previous) => nextPreviewRecommendation(previous));
      setRefreshingRec(false);
      showToast('已换一篇（预览数据）', 'success');
      return;
    }
    try {
      const next = await api.refreshRecommendation(settings.recommendationSource);
      setRecommendation(next);
      showToast('已为你换了一篇', 'success');
    } catch (error) {
      showToast(`换一篇失败：${errorMessage(error)}`, 'error');
    } finally {
      setRefreshingRec(false);
    }
  }, [refreshingRec, settings.recommendationSource, showToast]);

  /* ------------------------------- 设置 ------------------------------- */

  const saveSettings = useCallback(
    async (patch: SettingsUpdate): Promise<boolean> => {
      const keyOnly = patch.wereadApiKey !== undefined && Object.keys(patch).length === 1;
      if (modeRef.current === 'preview') {
        setSettings((previous) => {
          const next: Settings = { ...previous };
          if (patch.goalMinutes !== undefined) next.goalMinutes = patch.goalMinutes;
          if (patch.checkinMinutes !== undefined) next.checkinMinutes = patch.checkinMinutes;
          if (patch.researchTags !== undefined) next.researchTags = [...patch.researchTags];
          if (patch.recommendationSource !== undefined) {
            next.recommendationSource = patch.recommendationSource;
          }
          if (patch.wereadApiKey !== undefined) {
            const configured = Boolean(patch.wereadApiKey.trim());
            next.wereadConfigured = configured;
            next.wereadKeyMasked = configured ? maskPreviewKey(patch.wereadApiKey) : null;
          }
          return next;
        });
        if (patch.goalMinutes !== undefined || patch.checkinMinutes !== undefined) {
          setOverview((previous) =>
            applyPreviewGoals(
              previous,
              patch.goalMinutes ?? previous.today.goalMinutes,
              patch.checkinMinutes ?? previous.today.checkinMinutes,
            ),
          );
        }
        showToast(keyOnly ? '微信读书 Key 已保存（预览）' : '设置已保存（预览）', 'success');
        return true;
      }

      try {
        const next = await api.putSettings(patch);
        setSettings(next);
        showToast(keyOnly ? '微信读书 Key 已保存' : '设置已保存', 'success');
        if (
          patch.goalMinutes !== undefined ||
          patch.checkinMinutes !== undefined ||
          patch.wereadApiKey !== undefined
        ) {
          void loadOverview({ refresh: true, announce: false });
        }
        return true;
      } catch (error) {
        showToast(errorMessage(error), 'error');
        return false;
      }
    },
    [loadOverview, showToast],
  );

  const saveReadingOrder = useCallback(async (readingOrder: string[]): Promise<boolean> => {
    if (modeRef.current === 'preview') {
      setSettings(previous => ({ ...previous, readingOrder }));
      return true;
    }
    try {
      const next = await api.putSettings({ readingOrder });
      setSettings(next);
      return true;
    } catch (error) {
      showToast(`顺序保存失败：${errorMessage(error)}`, 'error');
      return false;
    }
  }, [showToast]);

  const testWeread = useCallback(
    async (keyDraft: string): Promise<WereadTestResult> => {
      if (modeRef.current === 'preview') {
        await delay(650);
        if (!keyDraft.trim() && !settings.wereadConfigured) {
          return { ok: false, message: '请先填写微信读书 API Key' };
        }
        if (keyDraft.trim().length >= 8) {
          return { ok: true, message: '预览模式 · 已模拟连接成功（书架 42 本）', bookCount: 42 };
        }
        return { ok: false, message: 'API Key 无效或已过期（预览模拟）' };
      }
      if (keyDraft.trim()) {
        const next = await api.putSettings({ wereadApiKey: keyDraft.trim() });
        setSettings(next);
      }
      const result = await api.testWeread();
      if (keyDraft.trim()) void loadOverview({ refresh: true, announce: false });
      return result;
    },
    [loadOverview, settings.wereadConfigured],
  );

  const clearWereadKey = useCallback(async (): Promise<boolean> => {
    if (modeRef.current === 'preview') {
      setSettings((previous) => ({
        ...previous,
        wereadConfigured: false,
        wereadKeyMasked: null,
      }));
      showToast('已清除微信读书 Key（预览）', 'success');
      return true;
    }
    try {
      const next = await api.putSettings({ wereadApiKey: '' });
      setSettings(next);
      showToast('已清除微信读书 Key', 'success');
      void loadOverview({ refresh: true, announce: false });
      return true;
    } catch (error) {
      showToast(errorMessage(error), 'error');
      return false;
    }
  }, [loadOverview, showToast]);

  /* ------------------------------- 手动书 ------------------------------ */

  const saveBook = useCallback(
    async (input: ManualBookInput, id?: string): Promise<BookSaveResult> => {
      if (modeRef.current === 'preview') {
        const existing = id ? books.find((book) => book.id === id) : undefined;
        const item = makePreviewBook(input, existing);
        setBooks((previous) =>
          id ? previous.map((book) => (book.id === id ? item : book)) : [item, ...previous],
        );
        showToast(item.finished ? '已读完，已移至已读完书单' : id ? '进度已保存' : '已加入书单', 'success');
        return { ok: true };
      }
      try {
        const { item } = id ? await api.updateBook(id, input) : await api.createBook(input);
        setBooks(previous => id ? previous.map(book => book.id === id ? item : book) : [item, ...previous]);
        showToast(item.finished ? '已读完，已移至已读完书单' : id ? '进度已保存' : '已加入书单', 'success');
        return { ok: true };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },
    [books, showToast],
  );

  const deleteBook = useCallback(
    async (id: string): Promise<boolean> => {
      if (modeRef.current === 'preview') {
        setBooks((previous) => previous.filter((book) => book.id !== id));
        showToast('已删除这本书', 'success');
        return true;
      }
      try {
        await api.deleteBook(id);
        await reloadBooks();
        showToast('已删除这本书', 'success');
        return true;
      } catch (error) {
        showToast(errorMessage(error), 'error');
        return false;
      }
    },
    [reloadBooks, showToast],
  );

  /* ------------------------------- 外链 -------------------------------- */

  const openLink = useCallback(
    (url: string | null | undefined) => {
      if (!url) {
        showToast('这条内容暂时没有可打开的链接', 'error');
        return;
      }
      if (!openExternal(url)) showToast('浏览器拦截了新窗口，请重试', 'error');
    },
    [showToast],
  );

  const openWereadBook = useCallback(
    (book: WereadBook) => {
      if (!book.readerLink) {
        showToast('这本书暂无阅读链接', 'info');
        return;
      }
      openLink(book.readerLink);
    },
    [openLink, showToast],
  );

  /* ---------------------------- 键盘与滑动 ---------------------------- */

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (settingsOpen || bookModal) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setPageIndex((current) => Math.max(0, current - 1));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setPageIndex((current) => Math.min(2, current + 1));
      } else if (event.key === 'Escape' && !compact) {
        event.preventDefault();
        void setCompact(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [settingsOpen, bookModal, compact, setCompact]);

  const pointer = useRef<{
    id: number;
    x: number;
    y: number;
    axis: 'x' | 'y' | null;
    dragging: boolean;
  } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    pointer.current = null;
    suppressClick.current = false;
    setDragX(0);
    if (compact) {
      setSettingsOpen(false);
      setBookModal(null);
    }
  }, [compact]);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!event.isPrimary) {
      const active = pointer.current;
      pointer.current = null;
      setDragX(0);
      if (active && event.currentTarget.hasPointerCapture(active.id)) {
        event.currentTarget.releasePointerCapture(active.id);
      }
      return;
    }
    if (event.button !== 0 || settingsOpen || bookModal) return;
    // A new press starts a new interaction, including buttons after a swipe.
    suppressClick.current = false;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input, textarea, select, a, [contenteditable="true"], [data-no-swipe]')) return;
    // A normal mouse click on a book or action must reach that control.
    if (event.pointerType === 'mouse' && target?.closest('button, [role="button"]')) return;
    pointer.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      axis: null,
      dragging: false,
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const state = pointer.current;
    if (!state || state.id !== event.pointerId) return;
    if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) {
      handlePointerCancel(event);
      return;
    }
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (!state.axis) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
      state.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
    }
    if (state.axis !== 'x') {
      pointer.current = null;
      return;
    }
    if (!state.dragging) {
      state.dragging = true;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* Synthetic events and older devices may not support capture. */
      }
    }
    event.preventDefault();
    const atEdge = (pageIndex === 0 && dx > 0) || (pageIndex === 2 && dx < 0);
    setDragX(Math.max(-180, Math.min(180, atEdge ? dx * 0.25 : dx)));
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const state = pointer.current;
    if (!state || state.id !== event.pointerId) return;
    pointer.current = null;
    setDragX(0);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    const horizontal = state.axis === 'x' && Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.2;
    if (state.dragging) {
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 400);
    }
    if (horizontal) {
      setPageIndex((current) => (dx < 0 ? Math.min(2, current + 1) : Math.max(0, current - 1)));
    }
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    if (pointer.current?.id !== event.pointerId) return;
    pointer.current = null;
    setDragX(0);
  }

  function handleClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (suppressClick.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressClick.current = false;
    }
  }

  const trackStyle: CSSProperties = {
    transform: `translateX(calc(${-pageIndex * 100}% + ${dragX}px))`,
    transition: dragX === 0 ? undefined : 'none',
  };

  return (
    <ToastContext.Provider value={showToast}>
      <div
        className={`widget${compact ? ' widget--compact' : ''}`}
        style={{ opacity: window.desktop?.setOpacity ? undefined : opacity }}
      >
        <TitleBar
          mode={mode}
          overviewSource={overview.source}
          overviewError={overview.error}
          refreshing={refreshingOverview || overviewLoading}
          pageIndex={pageIndex}
          onSelectPage={setPageIndex}
          onRefresh={() => {
            void refreshOverview();
          }}
          onOpenSettings={() => { void openSettings(); }}
          onCompact={() => { void setCompact(true); }}
          compact={compact}
          onExpand={() => { void setCompact(false); }}
            />
        {compact ? (
          <CompactBar
            pageIndex={pageIndex}
            onSelectPage={setPageIndex}
            onExpand={() => { void setCompact(false); }}
            onOpenSettings={() => { void openSettings(); }}
            overview={overview}
            manualBooks={books}
            readingOrder={settings.readingOrder}
            recommendation={recommendation}
            loading={pageIndex === 2 ? recLoading : overviewLoading || (pageIndex === 0 && booksLoading)}
          />
        ) : (
          <>
            <main className="widget__body">
              <div
                className={`pages-viewport${dragX !== 0 ? ' is-dragging' : ''}`}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
                onLostPointerCapture={handlePointerCancel}
                onClickCapture={handleClickCapture}
              >
                <div className="pages-track" style={trackStyle}>
                  <section
                    className="page-slot"
                    id="panel-reading"
                    role="tabpanel"
                    aria-labelledby="tab-reading"
                    aria-hidden={pageIndex !== 0}
                    inert={pageIndex !== 0}
                  >
                    <ReadingPage
                      loading={overviewLoading}
                      booksLoading={booksLoading}
                      overview={overview}
                      manualBooks={books}
                      readingOrder={settings.readingOrder}
                      onReadingOrderChange={saveReadingOrder}
                      refreshing={refreshingOverview}
                      onRefresh={() => {
                        void refreshOverview();
                      }}
                      onAddBook={() => setBookModal('new')}
                      onEditBook={(book) => setBookModal(book)}
                      onOpenBook={openWereadBook}
                    />
                  </section>

                  <section
                    className="page-slot"
                    id="panel-stats"
                    role="tabpanel"
                    aria-labelledby="tab-stats"
                    aria-hidden={pageIndex !== 1}
                    inert={pageIndex !== 1}
                  >
                    <StatsPage loading={overviewLoading} overview={overview} />
                  </section>

                  <section
                    className="page-slot"
                    id="panel-daily"
                    role="tabpanel"
                    aria-labelledby="tab-daily"
                    aria-hidden={pageIndex !== 2}
                    inert={pageIndex !== 2}
                  >
                    <DailyPage
                      loading={recLoading}
                      data={recommendation}
                      refreshing={refreshingRec}
                      onRefresh={() => {
                        void refreshRecommendation();
                      }}
                      onOpenLink={openLink}
                    />
                  </section>
                </div>
              </div>
            </main>
          </>
        )}

        {settingsOpen ? (
          <SettingsModal
            settings={settings}
            opacity={opacity}
            onOpacityChange={(value) => { void setOpacity(value); }}
            onClose={() => setSettingsOpen(false)}
            onSave={saveSettings}
            onTestWeread={testWeread}
            onClearKey={clearWereadKey}
          />
        ) : null}

        {bookModal ? (
          <BookModal
            book={bookModal === 'new' ? null : bookModal}
            onClose={() => setBookModal(null)}
            onSubmit={saveBook}
            onDelete={deleteBook}
          />
        ) : null}

        <ToastViewport toasts={toasts} />
      </div>
    </ToastContext.Provider>
  );
}
