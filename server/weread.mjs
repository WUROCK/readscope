/**
 * 微信读书 Agent API 客户端与 overview 归一化。
 *
 * 接口：POST https://i.weread.qq.com/api/agent/gateway
 * Header: Authorization: Bearer <key>
 * Body:   { api_name, skill_version: "1.0.5", ...业务参数 }（业务参数平铺）
 *
 * 缓存（内存 + data/cache/weread-*.json）：overview 90s、书架 10min、进度 5min、月报 1h。
 * refresh=1 时跳过全部缓存。所有秒数对外统一换算为分钟。
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  dateKey,
  hashId,
  isoShanghai,
  mapLimit,
  monthKeyOf,
  roundNumber,
  timestampSecToDateKey,
  weekStartKey,
  weekdayIndexFromKey,
  weekdayNameFromKey,
} from './util.mjs';
import { DOMAINS, breadthLabel, buildDomainStats, domainName, mapCategoryToDomain } from './domains.mjs';
import { deriveWereadTags } from './tags.mjs';

export const WEREAD_GATEWAY = 'https://i.weread.qq.com/api/agent/gateway';
export const SKILL_VERSION = '1.0.5';
export const WEREAD_REQUEST_TIMEOUT_MS = 12000;

const TTL = Object.freeze({
  overview: 90 * 1000,
  shelf: 10 * 60 * 1000,
  progress: 5 * 60 * 1000,
  monthly: 60 * 60 * 1000,
  annual: 60 * 60 * 1000,
  weekly: 90 * 1000,
});

export class WereadError extends Error {
  /**
   * @param {string} message 中文短原因
   * @param {string} [code] AUTH / TIMEOUT / NETWORK / HTTP / API / INVALID
   */
  constructor(message, code = 'API') {
    super(message);
    this.name = 'WereadError';
    this.code = code;
  }
}

/** 把异常变成适合展示给用户的中文短原因 */
export function shortWereadError(error) {
  if (!error) return '微信读书接口异常';
  if (error.code === 'AUTH') return 'API Key 无效或已过期';
  if (error.code === 'TIMEOUT') return '连接微信读书超时';
  if (error.code === 'NETWORK') return '无法连接微信读书服务';
  if (error instanceof WereadError) return error.message || '微信读书接口异常';
  return '微信读书接口异常';
}

function normalizeGatewayError(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return new WereadError('连接微信读书超时', 'TIMEOUT');
  }
  if (error instanceof WereadError) return error;
  return new WereadError('无法连接微信读书服务', 'NETWORK');
}

/**
 * 调用 WeRead Agent API Gateway。
 * @param {{ fetchImpl?: Function, key: string, apiName: string, params?: object, timeoutMs?: number }} options
 */
export async function callWereadGateway({
  fetchImpl,
  key,
  apiName,
  params = {},
  timeoutMs = WEREAD_REQUEST_TIMEOUT_MS,
}) {
  if (!key) throw new WereadError('尚未配置微信读书 API Key', 'AUTH');
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') throw new WereadError('当前 Node 环境不支持 fetch', 'NETWORK');

  const body = { api_name: apiName, skill_version: SKILL_VERSION, ...params };
  let response;
  try {
    response = await doFetch(WEREAD_GATEWAY, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw normalizeGatewayError(error);
  }

  if (response.status === 401 || response.status === 403) {
    throw new WereadError('API Key 无效或已过期', 'AUTH');
  }
  if (response.status === 429) {
    throw new WereadError('微信读书接口请求过于频繁，请稍后再试', 'RATE_LIMIT');
  }
  if (!response.ok) {
    throw new WereadError(`微信读书接口返回异常（HTTP ${response.status}）`, 'HTTP');
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new WereadError('微信读书接口返回了无法解析的数据', 'INVALID');
  }

  if (payload && payload.errcode !== undefined && Number(payload.errcode) !== 0) {
    const message = payload.errmsg || payload.message || `错误码 ${payload.errcode}`;
    throw new WereadError(`微信读书接口错误：${message}`, 'API');
  }

  // 官方 skill 约定：回包出现 upgrade_info 时必须停止操作并提示升级。
  if (payload && payload.upgrade_info) {
    const upgrade = payload.upgrade_info;
    const message =
      typeof upgrade === 'string'
        ? upgrade
        : String(upgrade?.message || upgrade?.msg || '微信读书接口要求升级 skill 版本');
    throw new WereadError(`微信读书接口需要升级：${message}`, 'UPGRADE');
  }

  return payload && typeof payload === 'object' ? payload : {};
}

/** 书架条目数（电子书 + 专辑 + 文章收藏入口） */
export function countShelfEntries(shelf) {
  const books = Array.isArray(shelf?.books) ? shelf.books.length : 0;
  const albums = Array.isArray(shelf?.albums) ? shelf.albums.length : 0;
  const mp = shelf?.mp ? 1 : 0;
  return books + albums + mp;
}

function readTimesToSecondsByDate(readTimesInput) {
  /** @type {Record<string, number>} */
  const byDate = {};
  if (!readTimesInput || typeof readTimesInput !== 'object') return byDate;
  for (const [rawKey, rawValue] of Object.entries(readTimesInput)) {
    const key = timestampSecToDateKey(rawKey);
    if (!key) continue;
    const seconds = Number(rawValue);
    if (!Number.isFinite(seconds) || seconds <= 0) continue;
    byDate[key] = (byDate[key] || 0) + seconds;
  }
  return byDate;
}

/** 单本书的 shelf + getprogress -> WereadBook */
export function mapWereadBook(book, progressPayload) {
  const progressBook = progressPayload?.book && typeof progressPayload.book === 'object' ? progressPayload.book : {};
  const rawProgress = Number(progressBook.progress);
  let progress = Number.isFinite(rawProgress) ? Math.round(rawProgress) : Number(book?.finishReading) === 1 ? 100 : 0;
  progress = Math.max(0, Math.min(100, progress));
  const category = String(book?.category || '').trim();
  const domainId = mapCategoryToDomain(category);
  // 实际网关回包里累计时长常放在 readingTime，recordReadingTime 可能为 0；
  // 文档字段与真实回包不一致时优先取非零值。
  const recordSeconds = Number(progressBook.recordReadingTime);
  const readingSeconds = Number(progressBook.readingTime);
  const seconds =
    Number.isFinite(recordSeconds) && recordSeconds > 0
      ? recordSeconds
      : Number.isFinite(readingSeconds) && readingSeconds > 0
        ? readingSeconds
        : 0;
  const lastReadAt =
    timestampToIso(book?.readUpdateTime) || timestampToIso(progressBook.updateTime) || null;
  const label = domainName(domainId);
  return {
    id: `wr:${String(book?.bookId || '')}`,
    bookId: String(book?.bookId || ''),
    title: String(book?.title || '未命名').trim(),
    author: String(book?.author || '未知作者').trim(),
    cover: book?.cover ? String(book.cover) : null,
    category,
    domain: domainId,
    domainName: label,
    tags: deriveWereadTags(category, label),
    progress,
    readingMinutes: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds / 60) : 0,
    lastReadAt,
    finished: Number(book?.finishReading) === 1 || progress >= 100,
    readerLink: book?.readerLink ? String(book.readerLink) : null,
  };
}

function timestampToIso(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return null;
  return isoShanghai(new Date((n > 1e12 ? Math.floor(n / 1000) : n) * 1000));
}

/** 本周 7 天柱状数据 */
export function buildWeek({ weeklySecondsByDate = {}, now = new Date() } = {}) {
  const today = dateKey(now);
  const start = weekStartKey(today);
  const days = [];
  let activeDays = 0;
  for (let i = 0; i < 7; i += 1) {
    const key = addDay(start, i);
    const seconds = Number(weeklySecondsByDate[key]) || 0;
    const minutes = Math.max(0, Math.round(seconds / 60));
    if (minutes > 0) activeDays += 1;
    days.push({
      date: key,
      weekday: weekdayNameFromKey(key),
      minutes,
      isToday: key === today,
      isFuture: key > today,
    });
  }
  const totalMinutes = days.reduce((sum, day) => sum + day.minutes, 0);
  const elapsedDays = Math.min(7, weekdayIndexFromKey(today) + 1);
  return {
    days,
    totalMinutes,
    activeDays,
    averageMinutes: elapsedDays > 0 ? Math.round(totalMinutes / elapsedDays) : 0,
  };
}

function addDay(key, delta) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + delta));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function parseReadStatCount(monthly, statName) {
  const stats = Array.isArray(monthly?.readStat) ? monthly.readStat : [];
  const entry = stats.find((item) => String(item?.stat || '').includes(statName));
  if (!entry) return null;
  const match = String(entry.counts || '').replace(/,/g, '').match(/\d+/);
  return match ? Number(match[0]) : null;
}

/** 本月统计（分钟、阅读天数、读完本数） */
export function buildMonthlyStats({ monthly = {}, monthlySecondsByDate = {} } = {}) {
  const totalSeconds = Number(monthly?.totalReadTime);
  const daySeconds = Object.values(monthlySecondsByDate).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const totalMinutes =
    Number.isFinite(totalSeconds) && totalSeconds > 0
      ? Math.round(totalSeconds / 60)
      : Math.round(daySeconds / 60);
  const rawReadDays = Number(monthly?.readDays);
  const readDays =
    Number.isFinite(rawReadDays) && rawReadDays >= 0
      ? Math.round(rawReadDays)
      : Object.values(monthlySecondsByDate).filter((value) => Number(value) >= 60).length;
  return {
    readDays,
    totalMinutes,
    startedBooks: parseReadStatCount(monthly, '读过') ?? 0,
    finishedBooks: parseReadStatCount(monthly, '读完') ?? 0,
  };
}

/** 年度 readTimes（月起始时间戳）-> 12 个月的秒数，按 Asia/Shanghai 归属月份 */
export function readTimesToMonthlySeconds(readTimesInput) {
  const byMonth = Array.from({ length: 12 }, () => 0);
  if (!readTimesInput || typeof readTimesInput !== 'object') return byMonth;
  for (const [rawKey, rawValue] of Object.entries(readTimesInput)) {
    const key = timestampSecToDateKey(rawKey);
    if (!key) continue;
    const month = Number(key.slice(5, 7));
    if (!Number.isInteger(month) || month < 1 || month > 12) continue;
    const seconds = Number(rawValue);
    if (!Number.isFinite(seconds) || seconds <= 0) continue;
    byMonth[month - 1] += seconds;
  }
  return byMonth;
}

/**
 * 年度统计：总分钟/阅读天数/读完本数 + 12 个月柱状分钟。
 * 年度接口字段与月报一致：totalReadTime(秒)、readDays、readStat('读完')、readTimes(月桶)。
 */
export function buildAnnualStats({ annual = {}, annualSecondsByMonth = [] } = {}) {
  const monthlySeconds = Array.from({ length: 12 }, (_, index) =>
    Math.max(0, Number(annualSecondsByMonth?.[index]) || 0),
  );
  const totalSeconds = Number(annual?.totalReadTime);
  const bucketSeconds = monthlySeconds.reduce((sum, seconds) => sum + seconds, 0);
  const yearMinutes =
    Number.isFinite(totalSeconds) && totalSeconds > 0
      ? Math.round(totalSeconds / 60)
      : Math.round(bucketSeconds / 60);
  const rawReadDays = Number(annual?.readDays);
  const yearReadDays =
    Number.isFinite(rawReadDays) && rawReadDays >= 0 ? Math.round(rawReadDays) : 0;
  const annualMonths = monthlySeconds.map((seconds, index) => ({
    month: index + 1,
    minutes: Math.max(0, Math.round(seconds / 60)),
  }));
  return {
    yearMinutes,
    yearReadDays,
    yearStartedBooks: parseReadStatCount(annual, '读过') ?? 0,
    yearFinishedBooks: parseReadStatCount(annual, '读完') ?? 0,
    annualMonths,
  };
}

/**
 * overview.stats 完整形状：保留原有月度字段，新增月份/年度字段。
 * 原有 readDays/totalMinutes/finishedBooks 的语义保持「本月」不变。
 */
export function buildOverviewStats({
  monthly = {},
  monthlySecondsByDate = {},
  annual = {},
  annualSecondsByMonth = [],
} = {}) {
  const month = buildMonthlyStats({ monthly, monthlySecondsByDate });
  const year = buildAnnualStats({ annual, annualSecondsByMonth });
  return {
    ...month,
    monthMinutes: month.totalMinutes,
    monthStartedBooks: month.startedBooks,
    monthFinishedBooks: month.finishedBooks,
    monthReadDays: month.readDays,
    yearMinutes: year.yearMinutes,
    yearStartedBooks: year.yearStartedBooks,
    yearFinishedBooks: year.yearFinishedBooks,
    yearReadDays: year.yearReadDays,
    annualMonths: year.annualMonths,
  };
}

export function buildDomainMapFromMonthly(monthly = {}) {
  /** @type {Record<string, {minutes:number, books:number}>} */
  const byDomain = {};
  const ensure = (id) => {
    if (!byDomain[id]) byDomain[id] = { minutes: 0, books: 0 };
    return byDomain[id];
  };

  let categoryMinutes = 0;
  const categories = Array.isArray(monthly?.preferCategory) ? monthly.preferCategory : [];
  for (const entry of categories) {
    if (!entry || typeof entry !== 'object') continue;
    const title = entry.categoryTitle || entry.parentCategoryTitle || '';
    const domainId = mapCategoryToDomain(title);
    const minutes = Math.max(0, Math.round(roundNumber(entry.readingTime, 0) / 60));
    const books = Math.max(0, Math.round(Number(entry.readingCount) || 0));
    if (minutes <= 0 && books <= 0) continue;
    const target = ensure(domainId);
    target.minutes += minutes;
    target.books += books;
    categoryMinutes += minutes;
  }

  if (categoryMinutes === 0) {
    const longest = Array.isArray(monthly?.readLongest) ? monthly.readLongest : [];
    for (const entry of longest) {
      if (!entry || typeof entry !== 'object') continue;
      const info = entry.book || entry.albumInfo || {};
      const domainId = mapCategoryToDomain(info.category || info.categoryTitle || '');
      const minutes = Math.max(0, Math.round(roundNumber(entry.readTime, 0) / 60));
      if (minutes <= 0) continue;
      const target = ensure(domainId);
      target.minutes += minutes;
      target.books += 1;
    }
  }

  return byDomain;
}

/**
 * 构造 8 领域统计。
 * @param {object} monthly
 * @param {number} totalMinutes
 */
export function buildWereadDomains(monthly, totalMinutes) {
  const byDomain = buildDomainMapFromMonthly(monthly);
  const sumMinutes = Object.values(byDomain).reduce((sum, entry) => sum + entry.minutes, 0);
  const denominator = totalMinutes > 0 ? totalMinutes : sumMinutes;
  const items = buildDomainStats(byDomain, denominator);
  const covered = items.filter((item) => item.covered).length;
  return {
    items,
    covered,
    total: DOMAINS.length,
    score: Math.round((covered / DOMAINS.length) * 100),
    label: breadthLabel(covered),
    monthLabel: '',
  };
}

/** 今日 Today（打卡信息由调用方从 checkins 读取） */
export function buildToday({ todayKey, seconds, settings, todayRow = null, streak = 0 }) {
  const minutes = Math.max(0, Math.round((Number(seconds) || 0) / 60));
  const goalMinutes = Number(settings?.goalMinutes) || 45;
  const checkinMinutes = Number(settings?.checkinMinutes) || 30;
  const checkedIn = Boolean(todayRow?.checkedIn);
  return {
    date: todayKey,
    minutes,
    seconds: Math.max(0, Math.round(Number(seconds) || 0)),
    goalMinutes,
    checkinMinutes,
    goalPercent: Math.min(100, Math.round((minutes / goalMinutes) * 100)),
    checkinPercent: Math.min(100, Math.round((minutes / checkinMinutes) * 100)),
    checkedIn,
    checkedInAt: checkedIn ? todayRow.updatedAt || null : null,
    checkedInSource: checkedIn ? todayRow.source || 'auto' : null,
    streak: Number.isFinite(streak) ? streak : 0,
    remainingToGoal: Math.max(0, goalMinutes - minutes),
    remainingToCheckin: Math.max(0, checkinMinutes - minutes),
  };
}

/**
 * 用已加载的 WeRead 数据构造 WereadOverview（source/notice 由调用方补充）。
 * @param {{
 *   data: {books: any[], monthly: object, weekly: object, monthlySecondsByDate?: object, weeklySecondsByDate?: object},
 *   settings: any,
 *   now?: Date,
 *   todayRow?: any,
 *   checkinHistory?: any[],
 *   streak?: number,
 * }} options
 */
export function buildWereadOverview({
  data,
  settings,
  now = new Date(),
  todayRow = null,
  checkinHistory = [],
  streak = 0,
}) {
  const todayKey = dateKey(now);
  const weeklySeconds = data?.weeklySecondsByDate || {};
  const monthlySeconds = data?.monthlySecondsByDate || {};
  const todaySeconds = Number(weeklySeconds[todayKey] ?? monthlySeconds[todayKey] ?? 0);
  const today = buildToday({ todayKey, seconds: todaySeconds, settings, todayRow, streak });
  const week = buildWeek({ weeklySecondsByDate: weeklySeconds, now });
  const stats = buildOverviewStats({
    monthly: data?.monthly || {},
    monthlySecondsByDate: monthlySeconds,
    annual: data?.annual || {},
    annualSecondsByMonth: data?.annualSecondsByMonth || [],
  });
  const domains = buildWereadDomains(data?.monthly || {}, stats.totalMinutes);
  domains.monthLabel = `${todayKey.slice(0, 4)}年${Number(todayKey.slice(5, 7))}月`;
  return {
    source: 'weread',
    connected: true,
    error: null,
    updatedAt: isoShanghai(now),
    today,
    week,
    domains,
    books: Array.isArray(data?.books) ? data.books.slice(0, 8) : [],
    checkinHistory,
    stats,
    notice: null,
  };
}

function cacheKeyFor(tokenHash, name, suffix = '') {
  return `${name}-${tokenHash}${suffix}`;
}

/**
 * @param {{
 *   store: ReturnType<import('./store.mjs').createStore>,
 *   fetchImpl?: Function,
 *   now?: () => Date,
 * }} deps
 */
export function createWereadClient({ store, fetchImpl = null, now = () => new Date() }) {
  const doFetch = fetchImpl || ((...args) => globalThis.fetch(...args));

  async function cachedCall(name, ttlMs, loader, refresh) {
    if (!refresh) {
      const cached = store.cacheGetSync(name, ttlMs);
      if (cached !== null && cached !== undefined) return cached;
    }
    const data = await loader();
    store.cacheSetSync(name, data);
    return data;
  }

  async function loadData(key, { refresh = false } = {}) {
    const tokenHash = hashId(key, 8);
    const today = dateKey(now());
    const overviewKey = cacheKeyFor(tokenHash, 'overview', `-${today}`);
    if (!refresh) {
      const cached = store.cacheGetSync(overviewKey, TTL.overview);
      if (cached) return cached;
    }

    const shelf = await cachedCall(
      cacheKeyFor(tokenHash, 'shelf'),
      TTL.shelf,
      () => callWereadGateway({ fetchImpl: doFetch, key, apiName: '/shelf/sync', params: {} }),
      refresh,
    );
    const weekly = await cachedCall(
      cacheKeyFor(tokenHash, 'weekly', `-${weekStartKey(today)}`),
      TTL.weekly,
      () =>
        callWereadGateway({
          fetchImpl: doFetch,
          key,
          apiName: '/readdata/detail',
          params: { mode: 'weekly', baseTime: 0 },
        }),
      refresh,
    );
    const monthlyPromise = cachedCall(
      cacheKeyFor(tokenHash, 'monthly', `-${monthKeyOf(today)}`),
      TTL.monthly,
      () =>
        callWereadGateway({
          fetchImpl: doFetch,
          key,
          apiName: '/readdata/detail',
          params: { mode: 'monthly', baseTime: 0 },
        }),
      refresh,
    );
    // 年度统计失败不应拖垮整个今日页：月报仍可展示，年度字段回退为 0。
    const annualPromise = cachedCall(
      cacheKeyFor(tokenHash, 'annual', `-${today.slice(0, 4)}`),
      TTL.annual,
      () =>
        callWereadGateway({
          fetchImpl: doFetch,
          key,
          apiName: '/readdata/detail',
          params: { mode: 'annually', baseTime: 0 },
        }),
      refresh,
    ).catch(() => null);
    const [monthly, annual] = await Promise.all([monthlyPromise, annualPromise]);

    const shelfBooks = (Array.isArray(shelf?.books) ? shelf.books : [])
      .filter((book) => book && book.bookId)
      .sort((a, b) => Number(b.readUpdateTime || 0) - Number(a.readUpdateTime || 0))
      .slice(0, 6);

    const progressList = await mapLimit(shelfBooks, 3, async (book) => {
      try {
        return await cachedCall(
          cacheKeyFor(tokenHash, 'progress', `-${book.bookId}`),
          TTL.progress,
          () =>
            callWereadGateway({
              fetchImpl: doFetch,
              key,
              apiName: '/book/getprogress',
              params: { bookId: String(book.bookId) },
            }),
          refresh,
        );
      } catch {
        return null;
      }
    });

    const progressByBook = new Map();
    shelfBooks.forEach((book, index) => progressByBook.set(String(book.bookId), progressList[index]));

    const books = shelfBooks
      .map((book) => mapWereadBook(book, progressByBook.get(String(book.bookId))))
      .sort((a, b) => String(b.lastReadAt || '').localeCompare(String(a.lastReadAt || '')))
      .slice(0, 8);

    const data = {
      fetchedAt: isoShanghai(now()),
      books,
      weekly,
      monthly,
      annual,
      weeklySecondsByDate: readTimesToSecondsByDate(weekly?.readTimes),
      monthlySecondsByDate: readTimesToSecondsByDate(monthly?.readTimes),
      annualSecondsByMonth: readTimesToMonthlySeconds(annual?.readTimes),
    };
    store.cacheSetSync(overviewKey, data);
    return data;
  }

  /** 失败降级时读取任意时间的最近一份 overview 缓存 */
  function loadCachedData(key) {
    const tokenHash = hashId(key, 8);
    const today = dateKey(now());
    const todayCache = store.cacheGetSync(cacheKeyFor(tokenHash, 'overview', `-${today}`), Infinity);
    if (todayCache) return todayCache;
    let files = [];
    try {
      files = fs
        .readdirSync(store.paths.cacheDir)
        .filter((name) => name.startsWith(`weread-overview-${tokenHash}-`) && name.endsWith('.json'));
    } catch {
      return null;
    }
    let best = null;
    for (const name of files) {
      try {
        const entry = JSON.parse(fs.readFileSync(path.join(store.paths.cacheDir, name), 'utf8'));
        if (entry && entry.data && (!best || entry.savedAt > best.savedAt)) best = entry;
      } catch {
        /* ignore corrupt cache */
      }
    }
    return best ? best.data : null;
  }

  /**
   * 轻量读取本周每日阅读秒数（只调用一次 readdata/detail）。
   * 供后台自动打卡使用，避免为了打卡去拉书架与每本书进度。
   * @returns {Promise<Record<string, number>>}
   */
  async function loadWeeklyReadTimes(key, { refresh = false } = {}) {
    const tokenHash = hashId(key, 8);
    const today = dateKey(now());
    const weekly = await cachedCall(
      cacheKeyFor(tokenHash, 'weekly', `-${weekStartKey(today)}`),
      TTL.weekly,
      () =>
        callWereadGateway({
          fetchImpl: doFetch,
          key,
          apiName: '/readdata/detail',
          params: { mode: 'weekly', baseTime: 0 },
        }),
      refresh,
    );
    return readTimesToSecondsByDate(weekly?.readTimes);
  }

  async function testConnection(key) {
    const shelf = await callWereadGateway({ fetchImpl: doFetch, key, apiName: '/shelf/sync', params: {} });
    return { bookCount: countShelfEntries(shelf), shelf };
  }

  return { loadData, loadCachedData, loadWeeklyReadTimes, testConnection, countShelfEntries };
}
