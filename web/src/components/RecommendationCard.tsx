import { formatMonthDayDots } from '../lib/format';
import { publicationDetails } from '../lib/publication';
import type { Recommendation } from '../lib/types';
import { IconArrowUpRight } from './Icons';

const SOURCE_FALLBACK: Record<Recommendation['source'], string> = {
  arxiv: 'arXiv 实时检索',
  curated: '精选文献库',
  wechat: '公众号',
  crossref: 'Crossref 出版记录',
};

export interface RecommendationCardProps {
  item: Recommendation;
  onOpen: () => void;
  onOpenPublication?: () => void;
}

/** 每日文献主卡：分别展示获取来源与期刊、会议信息。 */
export function RecommendationCard({ item, onOpen, onOpenPublication }: RecommendationCardProps) {
  const isPaper = item.type === 'paper';
  const sourceLabel = item.sourceLabel || SOURCE_FALLBACK[item.source] || '精选推荐';
  const publication = publicationDetails(item);
  const tags = Array.isArray(item.tags) ? item.tags.slice(0, 3) : [];

  return (
    <article className="daily-card" aria-label="今日文献">
      <div className="daily-card__top">
        <span className={`type-chip type-chip--${isPaper ? 'paper' : 'article'}`}>
          {isPaper ? '论文' : '公众号'}
        </span>
        <span className="daily-source" title={`获取来源：${sourceLabel}`}>来源：{sourceLabel}</span>
        <span className="daily-date">{formatMonthDayDots(item.date)}</span>
      </div>

      <h2 className="daily-title" title={item.title}>
        {item.title}
      </h2>

      <div className="daily-venue">
        <span className="daily-venue__label">{publication.label}</span>
        <span className="daily-venue__value">
          <span className="daily-venue__name">{publication.venue}</span>
          {publication.year ? <span className="daily-venue__year"> · {publication.year}</span> : null}
        </span>
      </div>
      {item.publicationUrl && onOpenPublication ? (
        <button type="button" className="text-btn publication-link" onClick={onOpenPublication}>
          核对出版记录 <IconArrowUpRight size={11} />
        </button>
      ) : null}

      <p className="daily-summary">{item.summary}</p>

      {tags.length > 0 ? (
        <div className="daily-tags">
          {tags.map((tag) => (
            <span className="tag-chip tag-chip--static" key={tag}>
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <div className="daily-actions">
        <button
          type="button"
          className="btn btn-primary daily-open"
          onClick={onOpen}
          disabled={!item.url}
          aria-label="在浏览器阅读全文"
        >
          阅读全文
          <IconArrowUpRight size={14} />
        </button>
      </div>
    </article>
  );
}

/** 主卡加载骨架。 */
export function RecommendationSkeleton() {
  return (
    <section className="daily-card daily-card--skeleton" aria-busy="true" aria-label="正在加载今日文献">
      <div className="daily-card__top">
        <span className="sk sk-chip" />
        <span className="sk sk-line sk-w30" />
      </div>
      <span className="sk sk-title" />
      <span className="sk sk-title sk-title--short" />
      <span className="sk sk-line sk-w40" />
      <span className="sk sk-line" />
      <span className="sk sk-line sk-w80" />
      <div className="daily-actions">
        <span className="sk sk-button" />
        <span className="sk sk-button sk-button--sm" />
      </div>
    </section>
  );
}
