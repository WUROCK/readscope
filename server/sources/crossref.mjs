import { buildArxivTerms, scoreArxivRelevance } from './arxiv.mjs';
import { fetchMetadataJson, publicationFromCrossref } from './publication.mjs';
import { collapseWhitespace, dateKey, hashId, normalizeTitle, normalizeUrl, truncateText } from '../util.mjs';

export function buildCrossrefQueries(tags) {
  const terms = buildArxivTerms(tags);
  return [...new Set(terms.map((term) => /intelligent surface/i.test(term) ? `${term} sensing communication`
    : /mmwave/i.test(term) ? `${term} human sensing` : term))].slice(0, 4);
}

export function parseCrossrefCandidates(records, { now = new Date(), tags = [] } = {}) {
  return (Array.isArray(records) ? records : []).flatMap((record) => {
    const publication = publicationFromCrossref(record, { now });
    const title = collapseWhitespace(record.title?.[0]);
    if (!publication || !title) return [];
    const abstract = collapseWhitespace(String(record.abstract || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/gi, '&'));
    const item = {
      type: 'paper', title, ...publication, year: publication.publicationYear,
      url: publication.publicationUrl,
      summary: abstract ? truncateText(abstract, 140) : '出版记录已核实，来源未提供摘要；请查看原文。',
      source: 'crossref', sourceLabel: 'Crossref 出版记录',
      tags: (record.subject || tags).slice(0, 3), language: abstract ? 'en' : 'zh',
    };
    return scoreArxivRelevance({ ...item, summary: abstract }) >= 4 ? [item] : [];
  }).sort((a, b) => scoreArxivRelevance(b) - scoreArxivRelevance(a) || b.publicationYear - a.publicationYear);
}

/** Cache whole candidate pools so repeated refreshes do not repeat public API calls. */
export async function fetchCrossrefRecommendation({ fetchImpl = globalThis.fetch, store, settings, usedUrls = new Set(), usedTitles = new Set(), variant = 0, now = () => new Date(), timeoutMs = 4000 } = {}) {
  const queries = buildCrossrefQueries(settings?.researchTags || []);
  const plans = queries.flatMap((query) => ['journal-article', 'proceedings-article'].map((type) => ({ query, type })));
  let lastError = null;
  for (let index = 0; index < Math.min(3, plans.length); index++) {
    const plan = plans[(Math.abs(variant) + index) % plans.length];
    const key = `crossref-pool-${hashId(`${plan.query}|${plan.type}|${dateKey(now())}`, 20)}`;
    let records = store?.cacheGetSync?.(key, 24 * 60 * 60 * 1000);
    try {
      if (!records) {
        const url = new URL('https://api.crossref.org/works');
        url.searchParams.set('query.bibliographic', plan.query);
        url.searchParams.set('filter', `prefix:10.1109,type:${plan.type},from-pub-date:2018-01-01,until-pub-date:${dateKey(now())}`);
        url.searchParams.set('rows', '30');
        const data = await fetchMetadataJson(fetchImpl, url.toString(), timeoutMs);
        records = parseCrossrefCandidates(data?.message?.items, { now: now(), tags: settings?.researchTags || [] });
        store?.cacheSetSync?.(key, records);
      }
      const item = records.find((candidate) => !usedUrls.has(normalizeUrl(candidate.url)) && !usedTitles.has(normalizeTitle(candidate.title)));
      if (item) return { item, total: records.length };
    } catch (error) { lastError = error; }
  }
  if (lastError) throw lastError;
  return { item: null, total: 0 };
}
