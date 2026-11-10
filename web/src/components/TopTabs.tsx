export const PAGES = [
  { key: 'reading', label: '在读', panelId: 'panel-reading' },
  { key: 'stats', label: '统计', panelId: 'panel-stats' },
  { key: 'daily', label: '每日文献', panelId: 'panel-daily' },
] as const;

export type PageKey = (typeof PAGES)[number]['key'];

export interface TopTabsProps {
  pageIndex: number;
  onSelect: (index: number) => void;
  compact?: boolean;
}

/** 顶部 3 个胶囊标签页；无底部导航。 */
export function TopTabs({ pageIndex, onSelect, compact = false }: TopTabsProps) {
  return (
    <nav className="tabs" role="tablist" aria-label="页面导航" aria-hidden={compact} inert={compact}>
      {PAGES.map((page, index) => {
        const active = index === pageIndex;
        return (
          <button
            key={page.key}
            type="button"
            role="tab"
            id={`tab-${page.key}`}
            aria-label={page.label}
            aria-selected={active}
            aria-controls={page.panelId}
            tabIndex={active ? 0 : -1}
            className={`tab${active ? ' is-active' : ''}`}
            onClick={() => onSelect(index)}
          >
            {page.label}
          </button>
        );
      })}
    </nav>
  );
}
