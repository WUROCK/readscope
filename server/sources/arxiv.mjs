/**
 * arXiv 实时推荐源：export.arxiv.org Atom API + cheerio(xmlMode) 解析。
 * 研究关键词会映射为英文检索词；结果按提交时间倒序，去重后取最新一篇。
 */

import * as cheerio from 'cheerio';
import { collapseWhitespace, normalizeTitle, normalizeUrl, truncateText } from '../util.mjs';

const RESEARCH_TERM_RULES = Object.freeze([
  { keywords: ['ris', '智能超表面', '可重构智能表面', 'reconfigurable intelligent surface'], term: 'reconfigurable intelligent surface' },
  { keywords: ['毫米波雷达', '毫米波', 'mmwave', 'millimeter wave'], term: 'mmWave radar' },
  { keywords: ['人体感知', 'human sensing', '生命体征', '姿态估计'], term: 'human sensing' },
  { keywords: ['三维重建', '3d reconstruction', '三维人体'], term: '3D reconstruction' },
  { keywords: ['多传感器融合', '传感器融合', 'multi-sensor fusion', 'sensor fusion'], term: 'multi-sensor fusion' },
  { keywords: ['isac', '通感一体化', 'integrated sensing and communication', '通信感知一体化'], term: 'integrated sensing and communication' },
]);

const FALLBACK_TERMS = ['reconfigurable intelligent surface', 'mmWave radar', 'integrated sensing and communication'];

export const ARXIV_API_URL = 'https://export.arxiv.org/api/query';

export function mapResearchTagToEnglish(tag) {
  const text = String(tag || '').trim().toLowerCase();
  if (!text) return null;
  for (const rule of RESEARCH_TERM_RULES) {
    if (rule.keywords.some((keyword) => text.includes(keyword))) return rule.term;
  }
  // 已是英文关键词则直接使用；未知中文关键词丢掉，避免 arXiv 查不到
  return /^[\x20-\x7e]+$/.test(text) ? text : null;
}

export function buildArxivTerms(researchTags) {
  const terms = [];
  const seen = new Set();
  for (const tag of Array.isArray(researchTags) ? researchTags : []) {
    const term = mapResearchTagToEnglish(tag);
    if (!term || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
  }
  if (terms.length === 0) terms.push(...FALLBACK_TERMS);
  return terms;
}

export function buildArxivSearchQuery(researchTags) {
  return buildArxivQueries(researchTags)[0];
}

const PROFILE_RULES = Object.freeze([
  { pattern: /reconfigurable intelligent surface|\bris\b/i, weight: 3 },
  { pattern: /integrated sensing and communication|\bisac\b/i, weight: 3 },
  { pattern: /mmwave|millimeter[-\s]?wave/i, weight: 2 },
  { pattern: /radar/i, weight: 1 },
  { pattern: /human (pose|activity|sensing|motion|activity recognition)|pose estimation|human activity recognition/i, weight: 2 },
  { pattern: /3d (reconstruction|pose)|point cloud/i, weight: 1 },
  { pattern: /multi[-\s]?sensor fusion|sensor fusion|multi[-\s]?modal/i, weight: 2 },
]);

/** 与用户研究画像（RIS / 毫米波感知 / 三维重建 / 多传感器融合 / ISAC）的相关性打分。 */
export function scoreArxivRelevance(item) {
  const title = String(item?.title || '');
  const abstract = String(item?.summary || '');
  let score = 0;
  for (const rule of PROFILE_RULES) {
    if (rule.pattern.test(title)) score += rule.weight * 2;
    else if (rule.pattern.test(abstract)) score += rule.weight;
  }
  if (item?.venue && item.venue !== 'arXiv 预印本') score += 1;
  return score;
}

/**
 * 面向研究画像的组合检索式，而不是把 8 个关键词简单 OR 起来。
 * 这样能避免 arXiv 最新提交里混入的泛 3D / 泛雷达论文。
 */
export function buildArxivQueries(researchTags) {
  const terms = buildArxivTerms(researchTags);
  const text = terms.join(' ').toLowerCase();
  const queries = [];
  const wantsRis = /reconfigurable intelligent surface|ris/.test(text);
  const wantsIsac = /integrated sensing and communication|isac/.test(text);
  const wantsMmwave = /mmwave|millimeter wave/.test(text);
  const wantsHuman = /human sensing|human pose|human activity/.test(text);
  const wantsFusion = /multi-sensor fusion|multimodal|multi-modal/.test(text);

  if (wantsRis) {
    queries.push(
      '(all:"reconfigurable intelligent surface" OR all:RIS) AND (all:sensing OR all:radar OR all:ISAC OR all:"integrated sensing and communication")',
    );
  }
  if (wantsMmwave) {
    queries.push(
      '(all:mmWave OR all:"millimeter wave") AND (all:human OR all:radar OR all:"pose estimation" OR all:"human activity recognition" OR all:"3D reconstruction")',
    );
  }
  if (wantsIsac) {
    queries.push(
      'all:"integrated sensing and communication" AND (all:RIS OR all:"reconfigurable intelligent surface" OR all:mmWave OR all:radar)',
    );
  }
  if (wantsHuman || wantsFusion) {
    queries.push(
      '(all:"multi-sensor fusion" OR all:"multi-modal fusion" OR all:"human sensing") AND (all:radar OR all:mmWave OR all:"pose estimation")',
    );
  }

  const deduped = [];
  const seen = new Set();
  for (const query of queries) {
    if (!query || seen.has(query)) continue;
    seen.add(query);
    deduped.push(query);
  }
  if (deduped.length > 0) return deduped;

  const fallback = buildArxivTerms(researchTags)
    .map((term) => `all:"${term.replace(/"/g, '')}"`)
    .join(' OR ');
  return [fallback];
}

export function buildArxivUrlForQuery(searchQuery, { maxResults = 20 } = {}) {
  const url = new URL(ARXIV_API_URL);
  url.searchParams.set('search_query', searchQuery);
  url.searchParams.set('start', '0');
  url.searchParams.set('max_results', String(Math.max(1, Math.min(50, maxResults))));
  url.searchParams.set('sortBy', 'submittedDate');
  url.searchParams.set('sortOrder', 'descending');
  return url.toString();
}

export function buildArxivUrl(researchTags, { maxResults = 20 } = {}) {
  return buildArxivUrlForQuery(buildArxivSearchQuery(researchTags), { maxResults });
}

function textOf($, $entry, localName) {
  let value = '';
  $entry.find('*').each((_, element) => {
    const name = String(element?.name || element?.tagName || '');
    if (name === localName || name.endsWith(`:${localName}`)) {
      value = collapseWhitespace($(element).text());
      return false;
    }
    return undefined;
  });
  return value;
}

function cleanSummary(raw) {
  return collapseWhitespace(String(raw || '').replace(/^abstract[:\s]*/i, ''));
}

/** 解析 arXiv Atom XML -> 推荐候选列表（按 submittedDate 倒序） */
export function parseArxivAtom(xml) {
  const $ = cheerio.load(String(xml || ''), { xmlMode: true });
  const items = [];
  $('entry').each((_, element) => {
    const $entry = $(element);
    const title = collapseWhitespace($entry.find('title').first().text());
    const rawId = collapseWhitespace($entry.find('id').first().text());
    const alternate = $entry.find('link[rel="alternate"]').attr('href');
    let url = String(alternate || rawId || '').trim();
    if (!url) return;
    url = url.replace(/^http:/i, 'https:').replace(/v\d+$/i, '');
    if (!/^https?:\/\//i.test(url)) return;
    const publishedText = $entry.find('published').first().text() || $entry.find('updated').first().text();
    const publishedTs = Date.parse(publishedText);
    const yearMatch = String(publishedText).trim().match(/^(\d{4})/);
    const journalRef = textOf($, $entry, 'journal_ref');
    const doi = textOf($, $entry, 'doi');
    const categories = [];
    $entry.find('*').each((__, node) => {
      const term = $(node).attr('term');
      if (term && !categories.includes(term)) categories.push(term);
    });
    if (!title) return;
    items.push({
      type: 'paper',
      title,
      venue: journalRef || 'arXiv 预印本',
      doi: doi || null,
      year: yearMatch ? Number(yearMatch[1]) : null,
      url,
      summary: truncateText(cleanSummary($entry.find('summary').first().text()), 140),
      source: 'arxiv',
      sourceLabel: 'arXiv 实时检索',
      tags: categories.slice(0, 2),
      language: 'en',
      publishedTs: Number.isFinite(publishedTs) ? publishedTs : 0,
    });
  });

  items.sort((a, b) => b.publishedTs - a.publishedTs);
  const deduped = [];
  const seenUrls = new Set();
  const seenTitles = new Set();
  for (const item of items) {
    const urlKey = normalizeUrl(item.url);
    const titleKey = normalizeTitle(item.title);
    if (seenUrls.has(urlKey) || seenTitles.has(titleKey)) continue;
    seenUrls.add(urlKey);
    seenTitles.add(titleKey);
    deduped.push(item);
  }
  return deduped;
}

/**
 * 拉取 arXiv 并挑一条与研究方向相关、且未推荐过的论文。
 * 多检索式聚合后按研究画像打分（相关性优先，时间次之），避免「最新但跑题」。
 * @returns {Promise<{item: any|null, total: number}>}
 */
export async function fetchArxivRecommendation({ fetchImpl, settings, usedUrls = new Set(), usedTitles = new Set(), timeoutMs = 12000 } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  const queries = buildArxivQueries(settings?.researchTags || []).slice(0, 3);
  const allItems = [];
  let lastError = null;
  let succeeded = 0;

  for (const searchQuery of queries) {
    try {
      const response = await doFetch(buildArxivUrlForQuery(searchQuery, { maxResults: 12 }), {
        method: 'GET',
        headers: {
          'User-Agent': 'ReadScope/0.1 (desktop reading widget; +https://arxiv.org)',
          Accept: 'application/atom+xml,application/xml,text/xml',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`arXiv 检索失败（HTTP ${response.status}）`);
      const xml = await response.text();
      allItems.push(...parseArxivAtom(xml));
      succeeded += 1;
    } catch (error) {
      lastError = error;
    }
  }

  if (succeeded === 0 && allItems.length === 0) {
    throw lastError || new Error('arXiv 检索失败');
  }

  // URL/title 去重
  const unique = [];
  const seenUrls = new Set();
  const seenTitles = new Set();
  for (const item of allItems) {
    const urlKey = normalizeUrl(item.url);
    const titleKey = normalizeTitle(item.title);
    if (seenUrls.has(urlKey) || seenTitles.has(titleKey)) continue;
    seenUrls.add(urlKey);
    seenTitles.add(titleKey);
    unique.push(item);
  }

  // 相关性优先，其次按提交时间；低于阈值的泛领域论文直接丢弃，让上层回退精选库。
  const ranked = unique
    .map((item) => ({ item, score: scoreArxivRelevance(item) }))
    .filter((entry) => entry.score >= 4)
    .sort((a, b) => b.score - a.score || (b.item.publishedTs || 0) - (a.item.publishedTs || 0));

  for (const entry of ranked) {
    const item = entry.item;
    if (usedUrls.has(normalizeUrl(item.url)) || usedTitles.has(normalizeTitle(item.title))) continue;
    const { publishedTs, ...rest } = item;
    return { item: rest, total: unique.length };
  }
  return { item: null, total: unique.length };
}
