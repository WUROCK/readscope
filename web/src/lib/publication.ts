import { shouldShowYear } from './format';
import type { Recommendation } from './types';

const UNKNOWN_VENUES = new Set([
  '', '精选文献库', '精选论文', '未标注期刊', '未标注期刊或会议',
  '未标注', '未知', '未提供', '暂未提供', '预印本', 'preprint',
  'unknown', 'n/a', 'na', 'none', '-', '–', '—',
]);

function isArxivPlaceholder(venue: string): boolean {
  return /^arxiv(?:\.org)?(?=$|[\s:：]|预印本)/i.test(venue);
}

/** Keep the retrieval platform separate from the reported publication venue. */
export function publicationDetails(item: Pick<Recommendation, 'type' | 'source' | 'venue' | 'year' | 'publicationYear'>) {
  const venue = String(item.venue ?? '').replace(/\s+/g, ' ').trim();
  const isPaper = item.type === 'paper';
  const missing = UNKNOWN_VENUES.has(venue.toLowerCase()) || isArxivPlaceholder(venue);
  // arXiv's year currently means the first submission year, not publication year.
  const providedYear = item.publicationYear || (item.source !== 'arxiv' ? item.year : null);
  const year = !missing && Number.isInteger(providedYear) && shouldShowYear(venue, providedYear) ? providedYear : null;
  return {
    label: isPaper ? '期刊 / 会议' : '公众号',
    venue: missing ? (isPaper ? '暂未收录期刊或会议信息' : '暂未提供') : venue,
    year,
  };
}
