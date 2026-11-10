import { formatMonthDayDots } from '../lib/format';
import { publicationDetails } from '../lib/publication';
import type { Recommendation, RecommendationResponse } from '../lib/types';
import { IconArrowUpRight, IconBookOpen, IconRefresh } from '../components/Icons';
import { RecommendationCard, RecommendationSkeleton } from '../components/RecommendationCard';

export interface DailyPageProps {
  loading: boolean;
  data: RecommendationResponse;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenLink: (url: string | null | undefined) => void;
}

function RecentRow({ item, onOpen }: { item: Recommendation; onOpen: () => void }) {
  const publication = publicationDetails(item);
  return (
    <button
      type="button"
      className="recent-row"
      onClick={onOpen}
      aria-label={`打开历史推荐：${item.title}`}
      title={item.title}
    >
      <span className="recent-row__date">{formatMonthDayDots(item.date)}</span>
      <span className="recent-row__body">
        <span className="recent-row__title">{item.title}</span>
        <span className="recent-row__venue">
          {publication.label}：{publication.venue}
          {publication.year ? ` · ${publication.year}` : ''}
        </span>
      </span>
      <IconArrowUpRight size={12} />
    </button>
  );
}

/** 第三页：每日文献。 */
export function DailyPage({
  loading,
  data,
  refreshing,
  onRefresh,
  onOpenLink,
}: DailyPageProps) {
  const item = data.item;
  const recent = data.history.filter((entry) => entry.id !== item?.id).slice(0, 2);
  const busy = loading || refreshing;

  return (
    <div className="page">
      <div className="page-stack">
        <header className="page-head">
          <div className="page-head__lead">
            <h1 className="page-title">
              每日文献
              <span className="page-title__date">{formatMonthDayDots(data.date)}</span>
            </h1>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onRefresh}
            disabled={busy}
            aria-label="换一篇文献"
          >
            <IconRefresh size={13} className={busy ? 'spin' : undefined} />
            换一篇
          </button>
        </header>

        {data.warning ? <p className="notice-line">{data.warning}</p> : null}

        {loading ? <RecommendationSkeleton /> : null}

        {!loading && item ? (
          <RecommendationCard
            item={item}
            onOpen={() => onOpenLink(item.url)}
            onOpenPublication={() => onOpenLink(item.publicationUrl)}
          />
        ) : null}

        {!loading && !item ? (
          <section className="daily-card daily-card--empty" aria-label="今日文献暂缺">
            <span className="daily-empty__icon" aria-hidden="true">
              <IconBookOpen size={24} />
            </span>
            <h2>今天还没找到合适的文献</h2>
            <p>{data.warning || '会自动改试另一个来源，稍后再试一次。'}</p>
            <button type="button" className="btn btn-primary" onClick={onRefresh} disabled={busy}>
              <IconRefresh size={13} className={busy ? 'spin' : undefined} />
              换一篇
            </button>
          </section>
        ) : null}

        {!loading && recent.length > 0 ? (
          <section className="recent" aria-label="最近文献">
            <header className="recent__head">
              <span className="eyebrow">最近文献</span>
            </header>
            <div className="recent__list">
              {recent.map((entry) => (
                <RecentRow key={entry.id} item={entry} onOpen={() => onOpenLink(entry.url)} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
