/**
 * 每日推荐引擎：data/recommendations.csv 去重 + /today 生成 + /refresh 换一篇。
 *
 * 来源：
 *  - curated：data/seed/curated_papers.json（只读，无网络，速度快）
 *  - arxiv  ：export.arxiv.org 实时 Atom 检索
 *  - wechat ：vendor/wechat-article-search 的搜狗微信搜索
 *  - auto   ：按年积日奇偶轮换论文/公众号，失败依次回退另一个实时源、精选库
 */

import {
  csvDownloadText,
  dateKey,
  dayOfYearFromKey,
  hashId,
  isoShanghai,
  normalizeTagList,
  normalizeTitle,
  normalizeUrl,
  truncateText,
  withTimeout,
  TimeoutError,
} from './util.mjs';
import { RECOMMENDATION_COLUMNS } from './store.mjs';
import { pickCuratedItem } from './sources/curated.mjs';
import { fetchArxivRecommendation } from './sources/arxiv.mjs';
import { createWechatSource } from './sources/wechat.mjs';
import { fetchCrossrefRecommendation } from './sources/crossref.mjs';
import { createPublicationResolver, hasPublicationVenue } from './sources/publication.mjs';

const VALID_SOURCES = new Set(['arxiv', 'curated', 'wechat', 'crossref']);
const LIVE_TIMEOUT_MS = 15000;

export const RECOMMENDATION_SOURCE_LABELS = Object.freeze({
  arxiv: 'arXiv 实时检索',
  curated: '精选文献库',
  crossref: 'Crossref 出版记录',
});

export function defaultSourceLabel(source, venue) {
  if (source === 'arxiv') return RECOMMENDATION_SOURCE_LABELS.arxiv;
  if (source === 'curated') return RECOMMENDATION_SOURCE_LABELS.curated;
  if (source === 'crossref') return RECOMMENDATION_SOURCE_LABELS.crossref;
  if (source === 'wechat') return `公众号：${venue || '微信公众号'}`;
  return '每日推荐';
}

/** CSV 原始行 -> Recommendation */
export function parseRecommendationRow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const dateValue = String(raw.date || '').trim();
  const title = String(raw.title || '').trim();
  const url = String(raw.url || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue) || !title || !url) return null;
  let source = String(raw.source || '').trim();
  if (!VALID_SOURCES.has(source)) source = 'curated';
  const yearNumber = Number(raw.year);
  const year = Number.isInteger(yearNumber) && yearNumber > 0 ? yearNumber : null;
  const tags = normalizeTagList(String(raw.tags || '').split(/[;,]/), { max: 12 });
  const venue = String(raw.venue || '').trim();
  const sourceLabel = String(raw.source_label || '').trim() || defaultSourceLabel(source, venue);
  const type = raw.type === 'article' || source === 'wechat' ? 'article' : 'paper';
  const language = raw.language === 'en' ? 'en' : raw.language === 'zh' ? 'zh' : source === 'arxiv' ? 'en' : 'zh';
  return {
    id: hashId(`${dateValue}|${normalizeUrl(url)}|${normalizeTitle(title)}`, 10),
    date: dateValue,
    type,
    title,
    venue,
    year,
    summary: String(raw.summary || '').trim(),
    url,
    source,
    sourceLabel,
    tags,
    language,
    fetchedAt: String(raw.fetched_at || '').trim(),
    publicationYear: Number(raw.publication_year) > 0 ? Number(raw.publication_year) : null,
    publicationDoi: String(raw.publication_doi || '').trim() || null,
    publicationUrl: String(raw.publication_url || '').trim() || null,
    venueSource: String(raw.venue_source || '').trim() || null,
    venueStatus: String(raw.venue_status || '').trim() || null,
  };
}

/** Recommendation -> CSV 行（tags 用 ; 分隔，逗号/换行由 csv-stringify 自动加引号） */
export function serializeRecommendationRow(item) {
  return {
    date: item.date,
    type: item.type,
    title: item.title,
    venue: item.venue || '',
    year: item.year === null || item.year === undefined ? '' : String(item.year),
    summary: item.summary || '',
    url: item.url,
    source: item.source,
    source_label: item.sourceLabel || defaultSourceLabel(item.source, item.venue),
    tags: Array.isArray(item.tags) ? item.tags.join(';') : '',
    language: item.language || 'zh',
    fetched_at: item.fetchedAt || '',
    publication_year: item.publicationYear || '',
    publication_doi: item.publicationDoi || '',
    publication_url: item.publicationUrl || '',
    venue_source: item.venueSource || '',
    venue_status: item.venueStatus || '',
  };
}

/** 所有历史行的归一化 URL / 标题集合（去重依据） */
export function buildUsedSets(rows) {
  const urls = new Set();
  const titles = new Set();
  for (const row of rows) {
    urls.add(normalizeUrl(row.url));
    titles.add(normalizeTitle(row.title));
    if (row.publicationUrl) urls.add(normalizeUrl(row.publicationUrl));
  }
  return { urls, titles };
}

/** 根据设置/调用参数决定尝试顺序 */
export function planRecommendationSources(source, dayOfYear) {
  if (source === 'paper') return ['crossref', 'curated', 'arxiv'];
  if (source === 'wechat') return ['wechat', 'curated'];
  if (source === 'curated') return ['curated'];
  const preferArxiv = dayOfYear % 2 === 0;
  return preferArxiv ? ['crossref', 'arxiv', 'wechat', 'curated'] : ['wechat', 'crossref', 'arxiv', 'curated'];
}

function normalizeCandidate(candidate, { dateValue, fetchedAt }) {
  const source = VALID_SOURCES.has(candidate?.source) ? candidate.source : 'curated';
  const type = source === 'wechat' || candidate?.type === 'article' ? 'article' : 'paper';
  const venue = String(candidate?.venue || '').trim();
  const language = candidate?.language === 'en' ? 'en' : candidate?.language === 'zh' ? 'zh' : source === 'arxiv' ? 'en' : 'zh';
  const title = String(candidate?.title || '').trim();
  const url = String(candidate?.url || '').trim();
  if (!title || !url) return null;
  return {
    id: hashId(`${dateValue}|${normalizeUrl(url)}|${normalizeTitle(title)}`, 10),
    date: dateValue,
    type,
    title,
    venue,
    year: Number.isInteger(candidate?.year) ? candidate.year : null,
    summary: truncateText(candidate?.summary || '', language === 'en' ? 140 : 60),
    url,
    source,
    sourceLabel: candidate?.sourceLabel || defaultSourceLabel(source, venue),
    tags: normalizeTagList(candidate?.tags, { max: 3 }),
    language,
    fetchedAt,
    publicationYear: candidate.publicationYear || null,
    publicationDoi: candidate.publicationDoi || candidate.doi || null,
    publicationUrl: candidate.publicationUrl || null,
    venueSource: candidate.venueSource || null,
    venueStatus: candidate.venueStatus || null,
  };
}

/**
 * @param {{
 *   store: ReturnType<import('./store.mjs').createStore>,
 *   now?: () => Date,
 *   fetchImpl?: Function,
 *   sourceImpls?: { arxiv?: Function, wechat?: Function },
 *   liveTimeoutMs?: number,
 *   wechatSource?: Function,
 * }} deps
 */
export function createRecommendationService({
  store,
  now = () => new Date(),
  fetchImpl = null,
  sourceImpls = {},
  liveTimeoutMs = LIVE_TIMEOUT_MS,
} = {}) {
  const wechatSource = sourceImpls.wechat || createWechatSource({ fetchImpl });
  const arxivSource =
    sourceImpls.arxiv ||
    (({ settings, usedUrls, usedTitles }) =>
      fetchArxivRecommendation({ fetchImpl, settings, usedUrls, usedTitles }));

  let generationQueue = Promise.resolve();
  const crossrefSource = sourceImpls.crossref || ((options) => fetchCrossrefRecommendation({
    ...options, store, now, fetchImpl: fetchImpl || globalThis.fetch,
  }));
  const resolvePublication = createPublicationResolver({ fetchImpl: fetchImpl || globalThis.fetch, store, now });
  /** @type {Map<string, {statuses: any, warning: string|null}>} */
  const lastGeneration = new Map();
  const upgradeAttempts = new Set();

  function readRows() {
    return store
      .readRecommendationRows()
      .map(parseRecommendationRow)
      .filter(Boolean);
  }

  function appendRow(item) {
    const rawRows = store.readRecommendationRows();
    rawRows.push(serializeRecommendationRow(item));
    // 保证列顺序稳定（旧 CSV 缺列时也补全）
    store.writeRecommendationRows(rawRows);
  }

  function todayKey() {
    return dateKey(now());
  }

  function latestRowFrom(rows, dateValue) {
    const matches = rows.filter((row) => row.date === dateValue);
    return matches.length > 0 ? matches[matches.length - 1] : null;
  }

  function response({ dateValue, item, rows, statuses, warning }) {
    return {
      date: dateValue,
      item,
      history: rows.slice(-8).reverse(),
      stats: {
        total: rows.length,
        csvPath: store.paths.recommendations,
      },
      sources: statuses,
      warning,
    };
  }

  function enqueue(task) {
    const run = generationQueue.then(task, task);
    generationQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function generate({ sourceOverride = null, dateValue = todayKey(), publishedOnly = false } = {}) {
    const settings = store.getSettings();
    const preferred = sourceOverride || settings.recommendationSource || 'paper';
    const doy = dayOfYearFromKey(dateValue);
    const order = planRecommendationSources(preferred, doy);
    const rows = readRows();
    const used = buildUsedSets(rows);
    const statuses = { crossref: 'idle', arxiv: 'idle', wechat: 'idle' };
    const errors = [];
    let candidate = null;
    let preprint = null;

    for (const kind of order) {
      if (candidate) break;
      if (kind === 'curated') {
        const seed = store.readSeedCurated();
        if (seed.error) {
          errors.push(seed.error);
          continue;
        }
        const picked = pickCuratedItem({
          items: seed.items,
          usedUrls: used.urls,
          usedTitles: used.titles,
          dayOfYear: doy,
          historyCount: rows.length,
        });
        if (picked && hasPublicationVenue(picked.venue)) candidate = picked;
        else if (picked) preprint ||= picked;
        else errors.push('精选文献库中的文献都已推荐过，请补充 seed 或切换来源');
        continue;
      }

      const label = kind === 'crossref' ? 'Crossref' : kind === 'arxiv' ? 'arXiv' : '公众号';
      try {
        const sourcePromise =
          kind === 'crossref'
            ? crossrefSource({ settings, usedUrls: used.urls, usedTitles: used.titles, variant: doy + rows.length })
            : kind === 'arxiv'
            ? arxivSource({ settings, usedUrls: used.urls, usedTitles: used.titles, variant: doy + rows.length })
            : wechatSource({
                settings,
                usedUrls: used.urls,
                usedTitles: used.titles,
                variant: doy + rows.length,
              });
        const result = await withTimeout(sourcePromise, liveTimeoutMs, `${label}检索超时`);
        const item = result?.item || null;
        statuses[kind] = 'ok';
        if (item) {
          const urlKey = normalizeUrl(item.url);
          const titleKey = normalizeTitle(item.title);
          if (used.urls.has(urlKey) || used.titles.has(titleKey)) {
            errors.push(`${label}返回的内容已推荐过`);
            continue;
          }
          if (item.type !== 'article' && !hasPublicationVenue(item.venue)) {
            const publication = await resolvePublication(item);
            if (publication) candidate = { ...item, ...publication };
            else preprint ||= item;
          } else candidate = item;
        } else {
          errors.push(kind === 'wechat' ? '暂无新的相关公众号文章' : `${label} 暂无新的相关论文`);
        }
      } catch (error) {
        if (error instanceof TimeoutError || error?.code === 'TIMEOUT') {
          statuses[kind] = 'timeout';
          errors.push(`${label}检索超时`);
        } else {
          statuses[kind] = 'error';
          errors.push(`${label}检索失败`);
        }
      }
    }

    if (!candidate && !publishedOnly) candidate = preprint;
    if (!candidate) {
      const warning = errors.length > 0 ? `今天暂时没有找到合适的推荐：${errors[0]}` : '今天暂时没有找到合适的推荐，请稍后重试';
      lastGeneration.set(dateValue, { statuses, warning });
      return { item: null, statuses, warning, rows };
    }

    const item = normalizeCandidate(candidate, { dateValue, fetchedAt: isoShanghai(now()) });
    if (!item) {
      const warning = '推荐内容缺少标题或链接，已跳过';
      lastGeneration.set(dateValue, { statuses, warning });
      return { item: null, statuses, warning, rows };
    }
    appendRow(item);
    const nextRows = readRows();
    const warning = item.type === 'paper' && !hasPublicationVenue(item.venue)
      ? '当前暂无新的已发表论文，先展示预印本；它的期刊或会议信息尚未核实。' : null;
    lastGeneration.set(dateValue, { statuses, warning });
    return { item, statuses, warning, rows: nextRows };
  }

  async function getToday() {
    const dateValue = todayKey();
    return enqueue(async () => {
      let latest = latestRowFrom(readRows(), dateValue);
      if (latest) {
        const preferred = store.getSettings().recommendationSource;
        if (latest.type === 'paper' && !hasPublicationVenue(latest.venue)
          && ['paper', 'auto'].includes(preferred) && !upgradeAttempts.has(latest.id)) {
          upgradeAttempts.add(latest.id);
          const publication = await resolvePublication(latest);
          if (publication) {
            const rows = readRows().map((row) => row.id === latest.id ? { ...row, ...publication } : row);
            store.writeRecommendationRows(rows.map(serializeRecommendationRow));
            latest = { ...latest, ...publication };
          } else {
            const upgraded = await generate({ sourceOverride: 'paper', dateValue, publishedOnly: true });
            if (upgraded.item) return response({ dateValue, ...upgraded });
          }
        }
        const cached = lastGeneration.get(dateValue);
        return response({
          dateValue,
          item: latest,
          rows: readRows(),
          statuses: cached?.statuses || { crossref: 'idle', arxiv: 'idle', wechat: 'idle' },
          warning: cached?.warning || (latest.type === 'paper' && !hasPublicationVenue(latest.venue)
            ? '这篇论文的出版信息尚未核实；换一篇会优先选择有期刊或会议出处的论文。' : null),
        });
      }
      const result = await generate({ dateValue });
      return response({
        dateValue,
        item: result.item,
        rows: result.rows,
        statuses: result.statuses,
        warning: result.warning,
      });
    });
  }

  async function refresh({ source } = {}) {
    return enqueue(async () => {
      const dateValue = todayKey();
      const result = await generate({ sourceOverride: source || null, dateValue });
      return {
        ...response({
          dateValue,
          item: result.item,
          rows: result.rows,
          statuses: result.statuses,
          warning: result.warning,
        }),
        replaced: true,
      };
    });
  }

  function getHistory({ limit = 100 } = {}) {
    const rows = readRows();
    const safeLimit = Math.max(1, Math.min(1000, Math.round(Number(limit) || 100)));
    return {
      items: rows.slice(-safeLimit).reverse(),
      total: rows.length,
      csvPath: store.paths.recommendations,
    };
  }

  function exportCsv() {
    return csvDownloadText(store.paths.recommendations, [...RECOMMENDATION_COLUMNS]);
  }

  return {
    getToday,
    refresh,
    getHistory,
    readRows,
    exportCsv,
    exportColumns: () => [...RECOMMENDATION_COLUMNS],
  };
}
