/**
 * 微信公众号推荐源：复用仓库内 vendor/wechat-article-search 的搜狗微信搜索脚本。
 * 只对最终选中的文章尝试还原真实链接（3.5s 预算），失败则保留搜狗跳转链接。
 */

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  collapseWhitespace,
  normalizeTitle,
  normalizeUrl,
  truncateText,
  withTimeout,
  TimeoutError,
} from '../util.mjs';

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const WECHAT_SEARCH_SCRIPT = path.join(REPO_ROOT, 'vendor', 'wechat-article-search', 'scripts', 'search_wechat.js');

let cachedSearcher = null;

function loadSearcher() {
  if (!cachedSearcher) {
    const module = require(WECHAT_SEARCH_SCRIPT);
    if (typeof module?.searchWechatArticles !== 'function') {
      throw new Error('微信文章搜索脚本不可用');
    }
    cachedSearcher = module.searchWechatArticles;
  }
  return cachedSearcher;
}

const QUERY_RULES = Object.freeze([
  { keywords: ['ris', '智能超表面', '可重构智能表面'], query: '可重构智能表面 RIS', tag: 'RIS' },
  { keywords: ['毫米波雷达', '毫米波', 'mmwave'], query: '毫米波雷达 人体感知', tag: '毫米波雷达' },
  { keywords: ['人体感知', 'human sensing'], query: '毫米波雷达 人体感知', tag: '人体感知' },
  { keywords: ['isac', '通感一体化', '通信感知一体化'], query: 'ISAC 通感一体化', tag: 'ISAC' },
  { keywords: ['三维重建', '3d reconstruction'], query: '三维重建 毫米波雷达', tag: '三维重建' },
  { keywords: ['多传感器融合', '传感器融合', 'fusion'], query: '多传感器融合 人体感知', tag: '多传感器融合' },
]);

const FALLBACK_QUERIES = [
  { query: '可重构智能表面 RIS', tag: 'RIS' },
  { query: '毫米波雷达 人体感知', tag: '毫米波雷达' },
  { query: 'ISAC 通感一体化', tag: 'ISAC' },
];

/** 研究关键词 -> 轮换的中文查询 */
export function buildWechatQueries(researchTags) {
  const queries = [];
  const seen = new Set();
  for (const rawTag of Array.isArray(researchTags) ? researchTags : []) {
    const tag = String(rawTag || '').trim();
    if (!tag) continue;
    const lower = tag.toLowerCase();
    const rule = QUERY_RULES.find((item) => item.keywords.some((keyword) => lower.includes(keyword)));
    const query = rule ? rule.query : tag;
    if (seen.has(query)) continue;
    seen.add(query);
    queries.push({ query, tag: rule ? rule.tag : tag });
  }
  if (queries.length === 0) return FALLBACK_QUERIES.map((item) => ({ ...item }));
  return queries;
}

function parseYear(article) {
  const text = String(article?.datetime || article?.date_text || '').trim();
  const match = text.match(/(\d{4})/);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isInteger(year) && year >= 1000 && year <= 3000 ? year : null;
}

const SUMMARY_NOISE = [
  /^电脑端视频播放地址[^。]*?[。:：]?/i,
  /^点击上方[^。]{0,40}[。！!]?/,
  /^微信扫一扫[^。]*?[。！!]?/,
  /^关注[^。]{0,24}公众号[^。]*?[。！!]?/,
  /^[（(][^）)]{0,30}(学习平台|b站|视频号)[^）)]*[)）][:：]?/i,
  /^论文短视频\s*[|｜]?\s*/,
  /^[（(]?视频[)）]?[:：]?/,
  /https?:\/\/\S+/g,
  /阅读原文/g,
];

/** 搜狗摘要常带"电脑端视频播放地址"等模板噪声，清洗后再截断。 */
export function cleanWechatSummary(value) {
  let text = collapseWhitespace(value);
  // 每清洗一步都收敛空白，避免前一条规则留下前导空格导致后面的 ^ 锚点失效。
  for (const pattern of SUMMARY_NOISE) {
    text = collapseWhitespace(text.replace(pattern, ' '));
  }
  return truncateText(text, 60);
}

/**
 * 把搜狗结果映射为推荐候选（不处理去重，供内部/测试使用）。
 * @returns {Array<object>}
 */
export function mapWechatArticles(articles, tag = '') {
  const out = [];
  for (const article of Array.isArray(articles) ? articles : []) {
    if (!article || typeof article !== 'object') continue;
    const title = collapseWhitespace(article.title);
    const url = String(article.url || '').trim();
    if (!title || !url) continue;
    const venue = collapseWhitespace(article.source) || '微信公众号';
    out.push({
      type: 'article',
      title,
      venue,
      year: parseYear(article),
      url,
      summary: cleanWechatSummary(article.summary || ''),
      source: 'wechat',
      sourceLabel: `公众号：${venue}`,
      tags: tag ? [tag] : [],
      language: 'zh',
    });
  }
  return out;
}

const RESOLVE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

/** 尝试把搜狗跳转链接还原成 mp.weixin.qq.com 真实链接；失败/超时返回原链接 */
export async function tryResolveWechatUrl(url, { fetchImpl, timeoutMs = 3500 } = {}) {
  const original = String(url || '').trim();
  if (!original || !/weixin\.sogou\.com/i.test(original)) return original;
  const doFetch = fetchImpl || globalThis.fetch;
  try {
    return await withTimeout(
      (async () => {
        const response = await doFetch(original, {
          method: 'GET',
          redirect: 'follow',
          headers: {
            'User-Agent': RESOLVE_USER_AGENT,
            Referer: 'https://weixin.sogou.com/',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
        const finalUrl = String(response?.url || '');
        if (/mp\.weixin\.qq\.com/i.test(finalUrl)) return finalUrl;
        if (response && typeof response.text === 'function') {
          const html = await response.text();
          const match = String(html).match(/https?:\/\/mp\.weixin\.qq\.com\/[^\s"'<>\\]+/i);
          if (match) return match[0].replace(/&amp;/g, '&');
        }
        return original;
      })(),
      timeoutMs,
      '还原公众号链接超时',
    );
  } catch (error) {
    if (error instanceof TimeoutError) return original;
    return original;
  }
}

/**
 * @param {{ searchImpl?: Function, fetchImpl?: Function, resolveRealUrl?: boolean }} [options]
 */
export function createWechatSource({ searchImpl = null, fetchImpl = null, resolveRealUrl = true } = {}) {
  const search = searchImpl || ((query, count) => loadSearcher()(query, count));

  return async function fetchWechatRecommendation({
    settings,
    usedUrls = new Set(),
    usedTitles = new Set(),
    variant = 0,
  } = {}) {
    const queries = buildWechatQueries(settings?.researchTags);
    if (queries.length === 0) return { item: null, total: 0 };
    const start = Math.abs(Math.round(Number(variant) || 0)) % queries.length;
    let total = 0;

    for (let offset = 0; offset < Math.min(queries.length, 3); offset += 1) {
      const { query, tag } = queries[(start + offset) % queries.length];
      let articles = await search(query, 10);
      if (articles && !Array.isArray(articles) && Array.isArray(articles.articles)) {
        articles = articles.articles;
      }
      const candidates = mapWechatArticles(articles, tag);
      total += candidates.length;
      const localUrls = new Set();
      const localTitles = new Set();
      for (const candidate of candidates) {
        const urlKey = normalizeUrl(candidate.url);
        const titleKey = normalizeTitle(candidate.title);
        if (alreadyUsed(urlKey, titleKey)) continue;
        if (localUrls.has(urlKey) || localTitles.has(titleKey)) continue;
        localUrls.add(urlKey);
        localTitles.add(titleKey);
        const finalUrl = resolveRealUrl
          ? await tryResolveWechatUrl(candidate.url, { fetchImpl })
          : candidate.url;
        if (alreadyUsed(normalizeUrl(finalUrl), titleKey)) continue;
        return { item: { ...candidate, url: finalUrl }, total };
      }
    }

    return { item: null, total };

    function alreadyUsed(urlKey, titleKey) {
      return usedUrls.has(urlKey) || usedTitles.has(titleKey);
    }
  };
}
