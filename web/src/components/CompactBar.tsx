import { useMemo } from 'react';
import { applyReadingOrder, mergeReadingItems } from '../lib/books';
import { formatMinutes } from '../lib/format';
import type { ManualBook, RecommendationResponse, WereadOverview } from '../lib/types';
import { ReadingRow } from './ReadingRow';

export interface CompactBarProps {
  pageIndex: number;
  onSelectPage: (index: number) => void;
  onExpand: () => void;
  onOpenSettings: () => void;
  overview: WereadOverview;
  manualBooks: ManualBook[];
  readingOrder: string[];
  recommendation: RecommendationResponse;
  loading: boolean;
}

export function CompactBar({ pageIndex, onExpand, overview, manualBooks, readingOrder, recommendation, loading }: CompactBarProps) {
  const book = useMemo(() => applyReadingOrder(mergeReadingItems(overview.books, manualBooks), readingOrder).find(item => !item.finished), [overview.books, manualBooks, readingOrder]);
  return (
    <section id="compact-panel" role="tabpanel" className="compact-content" aria-labelledby={['compact-tab-reading', 'compact-tab-stats', 'compact-tab-daily'][pageIndex]} aria-busy={loading}>
      {loading ? <button className="compact-summary" onClick={onExpand}>正在加载…</button>
        : pageIndex === 0 && book ? <ReadingRow item={book} onOpen={onExpand} onEdit={onExpand} />
        : <button type="button" className="compact-summary" onClick={onExpand}
            aria-label="展开当前页面" title="点击展开；左右方向键切换摘要">
            {pageIndex === 0 ? <span>暂无在读书籍，点击添加</span>
              : pageIndex === 1 ? <>
                  <span className="compact-stats">
                    <span><span className="compact-stats__label">本周累计</span><strong>{formatMinutes(overview.week.totalMinutes)}</strong></span>
                    <span><span className="compact-stats__label">本月累计</span><strong>{formatMinutes(overview.stats.monthMinutes)}</strong></span>
                  </span>
                </>
              : <span className="compact-summary__text" title={recommendation.item?.title}>{recommendation.item?.title || '暂无推荐文献'}</span>}
          </button>}
    </section>
  );
}
