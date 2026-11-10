/**
 * 精选文献库推荐源：只读 data/seed/curated_papers.json，按日期 + 历史条数做确定性轮换。
 */

import { normalizeTagList, normalizeTitle, normalizeUrl, truncateText } from '../util.mjs';
import { hasPublicationVenue } from './publication.mjs';

/** 判断候选是否已被历史推荐（按归一化 URL / 标题） */
function isUsed(item, usedUrls, usedTitles) {
  const url = String(item?.url || '').trim();
  const title = String(item?.title || '').trim();
  if (!url || !title) return true;
  if (usedUrls.has(normalizeUrl(url))) return true;
  if (usedTitles.has(normalizeTitle(title))) return true;
  return false;
}

/**
 * 从精选库挑一条未推荐过的文献。
 * @param {{
 *   items: any[],
 *   usedUrls: Set<string>,
 *   usedTitles: Set<string>,
 *   dayOfYear: number,
 *   historyCount: number,
 * }} options
 * @returns {null | {type:'paper', title:string, venue:string, year:number|null, url:string,
 *   summary:string, source:'curated', sourceLabel:string, tags:string[], language:'zh'|'en'}}
 */
export function pickCuratedItem({ items, usedUrls, usedTitles, dayOfYear = 1, historyCount = 0 } = {}) {
  const candidates = (Array.isArray(items) ? items : []).filter(
    (item) =>
      item &&
      typeof item.title === 'string' &&
      typeof item.url === 'string' &&
      !isUsed(item, usedUrls, usedTitles),
  );
  if (candidates.length === 0) return null;
  const verified = candidates.filter((item) => item.venueStatus === 'published' && hasPublicationVenue(item.venue));
  const reported = candidates.filter((item) => hasPublicationVenue(item.venue));
  const preferred = verified.length ? verified : reported.length ? reported : candidates;
  const index = Math.abs(Number(dayOfYear) + Number(historyCount)) % preferred.length;
  const item = preferred[index];
  const language = item.language === 'en' ? 'en' : 'zh';
  const summary = truncateText(item.summary || '', language === 'en' ? 140 : 60);
  return {
    type: 'paper',
    title: String(item.title).trim(),
    venue: String(item.venue || '精选文献库').trim(),
    year: Number.isInteger(item.year) ? item.year : null,
    url: String(item.url).trim(),
    summary,
    source: 'curated',
    sourceLabel: '精选文献库',
    tags: normalizeTagList(item.tags, { max: 3 }),
    language,
    publicationYear: item.publicationYear || null,
    publicationDoi: item.publicationDoi || item.doi || null,
    publicationUrl: item.publicationUrl || null,
    venueSource: item.venueSource || null,
    venueStatus: item.venueStatus || null,
  };
}
