import { useEffect, useState } from 'react';
import { togglePinWindow } from '../lib/api';
import type { AppMode } from '../lib/types';
import { IconBookOpen, IconClose, IconCollapse, IconExpand, IconGear, IconMinus, IconPin } from './Icons';
import { PAGES, TopTabs } from './TopTabs';

export interface TitleBarProps {
  mode: AppMode;
  overviewSource: 'weread' | 'demo' | 'error';
  overviewError: string | null;
  refreshing: boolean;
  pageIndex: number;
  onSelectPage: (index: number) => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
  onCompact?: () => void;
  compact?: boolean;
  onExpand?: () => void;
}

type SyncStatus = 'loading' | 'live' | 'demo' | 'error';

function resolveSyncStatus(mode: AppMode, source: TitleBarProps['overviewSource']): SyncStatus {
  if (mode === 'preview') return 'demo';
  if (mode === 'loading') return 'loading';
  if (source === 'error') return 'error';
  if (source === 'weread') return 'live';
  return 'demo';
}

/** 顶部圆角玻璃条：品牌 + 紧凑页签 + 窗口控制。 */
export function TitleBar({
  mode,
  overviewSource,
  overviewError,
  refreshing,
  pageIndex,
  onSelectPage,
  onRefresh,
  onOpenSettings,
  onCompact,
  compact = false,
  onExpand,
}: TitleBarProps) {
  const [pinned, setPinned] = useState(false);
  const syncStatus = resolveSyncStatus(mode, overviewSource);
  const isPreview = mode === 'preview';

  useEffect(() => {
    const desktop = window.desktop;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    const applyState = (state: unknown) => {
      if (!cancelled && state && typeof state === 'object') {
        const value = (state as { pinned?: unknown }).pinned;
        if (typeof value === 'boolean') setPinned(value);
      }
    };

    const request = desktop?.getState?.();
    if (request) {
      Promise.resolve(request)
        .then(applyState)
        .catch(() => {
          /* 桥接失败时保持本地状态 */
        });
    } else {
      const pinnedRequest = desktop?.getPinned?.();
      if (pinnedRequest) {
        Promise.resolve(pinnedRequest)
          .then((value) => {
            if (!cancelled && typeof value === 'boolean') setPinned(value);
          })
          .catch(() => {
            /* ignore */
          });
      }
    }

    if (desktop?.onState) {
      const off = desktop.onState(applyState);
      if (typeof off === 'function') unsubscribe = off;
    }

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  async function handleTogglePin() {
    const result = await togglePinWindow();
    setPinned((previous) => (result === null ? !previous : result));
  }

  const syncLabel = isPreview
    ? '预览数据'
    : syncStatus === 'live'
      ? '已连接微信读书'
      : syncStatus === 'error'
        ? `同步失败${overviewError ? `：${overviewError}` : ''}`
        : '演示数据';

  return (
    <header className={"titlebar" + (compact ? " titlebar--compact" : "")}>
      <div className="titlebar__brand">
        <span className="brand-logo" aria-hidden="true">
          <IconBookOpen size={13} strokeWidth={1.9} />
        </span>
        <span className="brand-name">阅界</span>
        {compact ? <nav className="compact-tabs" role="tablist" aria-label="摘要导航" data-no-drag>
          {PAGES.map((page, index) => <button key={page.key} type="button" role="tab"
            id={`compact-tab-${page.key}`} className={`compact-tab${pageIndex === index ? ' is-active' : ''}`}
            aria-label={page.label} aria-selected={pageIndex === index} aria-controls="compact-panel"
            title={page.label} onClick={() => onSelectPage(index)}>
            {index === 2 ? '文献' : page.label}
          </button>)}
        </nav> : null}
      </div>

      <TopTabs pageIndex={pageIndex} onSelect={onSelectPage} compact={compact} />

      <div className="titlebar__actions" role="group" aria-label="窗口控制" data-no-drag>
        {onCompact ? (
          <button
            type="button"
            className="icon-btn"
            title={compact ? "展开完整面板" : "收起为简洁横条"}
            aria-label={compact ? "展开完整面板" : "收起为简洁横条"}
            aria-expanded={!compact}
            onClick={compact ? onExpand : onCompact}
          >
            {compact ? <IconExpand size={14} /> : <IconCollapse size={14} />}
          </button>
        ) : null}
        <button
          type="button"
          className={`icon-btn sync-btn${refreshing ? ' is-refreshing' : ''}`}
          title={`${syncLabel} · 点击刷新`}
          aria-label={`${syncLabel}，点击刷新数据`}
          onClick={onRefresh}
        >
          <span className={`sync-dot sync-dot--${syncStatus}`} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-btn"
          title="设置"
          aria-label="打开设置"
          onClick={onOpenSettings}
        >
          <IconGear size={13} />
        </button>
        <button
          type="button"
          className={`icon-btn${pinned ? ' is-active' : ''}`}
          title={pinned ? '取消置顶' : '窗口置顶'}
          aria-label={pinned ? '取消窗口置顶' : '窗口置顶'}
          aria-pressed={pinned}
          onClick={() => {
            void handleTogglePin();
          }}
        >
          <IconPin size={13} filled={pinned} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title="最小化窗口"
          aria-label="最小化窗口"
          onClick={() => window.desktop?.minimize?.()}
        >
          <IconMinus size={13} />
        </button>
        <button
          type="button"
          className="icon-btn icon-btn--close"
          title="隐藏到托盘（不退出）"
          aria-label="隐藏到系统托盘，不退出应用"
          onClick={() => {
            const desktop = window.desktop;
            if (desktop?.hide) void desktop.hide();
            else if (desktop?.close) void desktop.close();
          }}
        >
          <IconClose size={13} />
        </button>
      </div>
    </header>
  );
}
