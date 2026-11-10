import { collapseWhitespace, hashId, withTimeout } from '../util.mjs';

const DAY = 24 * 60 * 60 * 1000;
const PUBLICATION_TYPES = new Set(['journal-article', 'proceedings-article']);

export function hasPublicationVenue(value) {
  const text = collapseWhitespace(value);
  return Boolean(text) && !/^(?:arxiv(?:\.org)?(?:\b|预印本)|preprint\b|预印本|精选文献库|精选论文|未标注|未提供|暂未|未知|unknown|n\/?a$|[-–—]+$)/i.test(text);
}

export function normalizeDoi(value) {
  const doi = String(value || '').trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : '';
}

function titleKey(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/gi, '&').normalize('NFKD')
    .replace(/\p{M}/gu, '').toLowerCase().replace(/&/g, 'and').replace(/[^\p{L}\p{N}]/gu, '');
}

export function publicationFromCrossref(record, { title, doi, now = new Date() } = {}) {
  if (!record || !PUBLICATION_TYPES.has(record.type)) return null;
  const identifier = normalizeDoi(record.DOI);
  const expectedDoi = normalizeDoi(doi);
  if (!identifier || (expectedDoi && identifier !== expectedDoi)) return null;
  const titles = Array.isArray(record.title) ? record.title : [];
  if (title && !titles.some((candidate) => titleKey(candidate) === titleKey(title))) return null;
  const venue = collapseWhitespace(record['container-title']?.find?.((value) => hasPublicationVenue(value)));
  if (!hasPublicationVenue(venue)) return null;
  const dates = ['published-online', 'published-print', 'published', 'issued'].flatMap((field) => {
    const parts = record[field]?.['date-parts']?.[0];
    if (!Array.isArray(parts) || !Number.isInteger(parts[0]) || parts[0] < 1900) return [];
    const date = new Date(Date.UTC(parts[0], (parts[1] || 1) - 1, parts[2] || 1));
    return Number.isFinite(date.getTime()) && date <= now ? [date] : [];
  });
  if (!dates.length) return null;
  const published = dates.sort((a, b) => a - b)[0];
  return {
    venue, publicationYear: published.getUTCFullYear(), publicationDoi: identifier,
    publicationUrl: `https://doi.org/${identifier}`, venueSource: 'crossref', venueStatus: 'published',
  };
}

export async function fetchMetadataJson(fetchImpl, url, timeoutMs = 3500) {
  const controller = new AbortController();
  try {
    return await withTimeout((async () => {
      const response = await fetchImpl(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'ReadScope/0.1 (desktop research reading assistant)' },
        signal: controller.signal,
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Publication metadata HTTP ${response.status}`);
      return response.json();
    })(), timeoutMs, 'Publication metadata timeout');
  } finally {
    controller.abort();
  }
}

/** Only exact DOI/title matches can fill a missing venue. Network failures are not negative-cached. */
export function createPublicationResolver({ fetchImpl = globalThis.fetch, store, timeoutMs = 3500, now = () => new Date() } = {}) {
  const memory = new Map();
  const pending = new Map();
  return async function resolvePublication(item) {
    const reported = collapseWhitespace(item.journalRef || item.journal_ref || item.venue);
    if (hasPublicationVenue(reported)) {
      return {
        venue: reported,
        publicationYear: item.publicationYear || (item.source !== 'arxiv' ? item.year : null),
        publicationDoi: normalizeDoi(item.publicationDoi || item.doi) || null,
        publicationUrl: item.publicationUrl || null,
        venueSource: item.venueSource || (item.source === 'arxiv' ? 'arxiv' : 'reported'),
        venueStatus: item.venueStatus || 'reported',
      };
    }
    const doi = normalizeDoi(item.publicationDoi || item.doi || item.url);
    const title = collapseWhitespace(item.title);
    if (!doi && !title) return null;
    const key = `publication-${hashId(`${doi}|${titleKey(title)}`, 24)}`;
    const timestamp = now().getTime();
    const cached = memory.get(key) || store?.cacheGetSync?.(key, 7 * DAY);
    if (cached && timestamp - cached.checkedAt < (cached.result ? 7 * DAY : 6 * 60 * 60 * 1000)) return cached.result;
    if (pending.has(key)) return pending.get(key);
    const request = (async () => {
      try {
        const url = doi ? `https://api.crossref.org/works/${encodeURIComponent(doi)}` : (() => {
          const query = new URL('https://api.crossref.org/works');
          query.searchParams.set('query.title', title);
          query.searchParams.set('rows', '5');
          return query.toString();
        })();
        const data = await fetchMetadataJson(fetchImpl, url, timeoutMs);
        const records = doi ? (data?.message ? [data.message] : []) : data?.message?.items || [];
        const matches = records.map((record) => publicationFromCrossref(record, { title, doi, now: now() })).filter(Boolean);
        const identifiers = new Set(matches.map((entry) => entry.publicationDoi));
        const result = identifiers.size === 1 ? matches[0] : null;
        const entry = { checkedAt: timestamp, result };
        memory.set(key, entry);
        store?.cacheSetSync?.(key, entry);
        return result;
      } catch {
        return null;
      } finally {
        pending.delete(key);
      }
    })();
    pending.set(key, request);
    return request;
  };
}
