/**
 * 本地数据仓库：settings.json / books.json / papers.json / checkins.csv /
 * recommendations.csv 的读写，以及 WeRead 的磁盘 TTL 缓存。
 *
 * 所有写入都是「临时文件 + rename」的原子写；同步写入在单进程事件循环里天然串行。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AppError,
  ensureDirSync,
  fileExists,
  readJsonSync,
  writeJsonAtomicSync,
  readCsvSync,
  writeCsvAtomicSync,
  readTextSync,
  maskSecret,
  normalizeTagList,
  isoShanghai,
} from './util.mjs';

/** server/ 的上一级即仓库根目录 */
export const REPO_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const PACKAGE_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version || '0.1.0';
  } catch {
    return '0.1.0';
  }
})();

export const APP_VERSION = PACKAGE_VERSION;

export const DEFAULT_RESEARCH_TAGS = Object.freeze([
  'RIS',
  '毫米波雷达',
  '人体感知',
  '三维重建',
  '多传感器融合',
  'ISAC',
  '通感一体化',
  '智能超表面',
]);

export const DEFAULT_SETTINGS = Object.freeze({
  wereadApiKey: '',
  goalMinutes: 45,
  checkinMinutes: 30,
  researchTags: [...DEFAULT_RESEARCH_TAGS],
  recommendationSource: 'paper',
  readingOrder: [],
});

export const RECOMMENDATION_SOURCES = Object.freeze(['auto', 'paper', 'wechat', 'curated']);

export const CHECKIN_COLUMNS = Object.freeze(['date', 'minutes', 'checked_in', 'source', 'updated_at']);

export const RECOMMENDATION_COLUMNS = Object.freeze([
  'date',
  'type',
  'title',
  'venue',
  'year',
  'summary',
  'url',
  'source',
  'source_label',
  'tags',
  'language',
  'fetched_at',
  'publication_year',
  'publication_doi',
  'publication_url',
  'venue_source',
  'venue_status',
]);

export const DEFAULT_DATA_DIR = path.join(REPO_ROOT, 'data');

export function resolveDataDir(explicit) {
  const configured = explicit || process.env.READSCOPE_DATA_DIR || DEFAULT_DATA_DIR;
  return path.resolve(configured);
}

function normalizeSettings(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const goalMinutes = Number(source.goalMinutes);
  const checkinMinutes = Number(source.checkinMinutes);
  const tags = normalizeTagList(source.researchTags, { max: 12 });
  return {
    wereadApiKey: typeof source.wereadApiKey === 'string' ? source.wereadApiKey.trim() : '',
    goalMinutes:
      Number.isInteger(goalMinutes) && goalMinutes >= 15 && goalMinutes <= 240 ? goalMinutes : DEFAULT_SETTINGS.goalMinutes,
    checkinMinutes:
      Number.isInteger(checkinMinutes) && checkinMinutes >= 5 && checkinMinutes <= 240
        ? checkinMinutes
        : DEFAULT_SETTINGS.checkinMinutes,
    researchTags: tags.length > 0 ? tags : [...DEFAULT_RESEARCH_TAGS],
    readingOrder: Array.isArray(source.readingOrder)
      ? [...new Set(source.readingOrder.filter(id => typeof id === 'string' && id.length > 0 && id.length <= 256))].slice(0, 2000) : [],
    recommendationSource: RECOMMENDATION_SOURCES.includes(source.recommendationSource)
      ? source.recommendationSource
      : DEFAULT_SETTINGS.recommendationSource,
  };
}

/**
 * 校验 PUT /api/settings 的 patch，返回合并后的完整设置；非法抛 400 AppError。
 * @param {any} patch
 * @param {ReturnType<typeof normalizeSettings>} current
 */
export function validateSettingsPatch(patch, current) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new AppError(400, 'BAD_REQUEST', '设置内容必须是 JSON 对象');
  }
  const next = { ...current };

  if (Object.prototype.hasOwnProperty.call(patch, 'wereadApiKey')) {
    if (patch.wereadApiKey !== null && typeof patch.wereadApiKey !== 'string') {
      throw new AppError(400, 'BAD_REQUEST', '微信读书 API Key 必须是字符串');
    }
    const key = typeof patch.wereadApiKey === 'string' ? patch.wereadApiKey.trim() : '';
    if (key.length > 512) throw new AppError(400, 'BAD_REQUEST', '微信读书 API Key 过长');
    next.wereadApiKey = key;
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'goalMinutes')) {
    const value = patch.goalMinutes;
    if (!Number.isInteger(value) || value < 15 || value > 240) {
      throw new AppError(400, 'BAD_REQUEST', '阅读目标必须是 15–240 之间的整数分钟');
    }
    next.goalMinutes = value;
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'checkinMinutes')) {
    const value = patch.checkinMinutes;
    if (!Number.isInteger(value) || value < 5 || value > 240) {
      throw new AppError(400, 'BAD_REQUEST', '自动打卡阈值必须是 5–240 之间的整数分钟');
    }
    next.checkinMinutes = value;
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'researchTags')) {
    if (!Array.isArray(patch.researchTags)) {
      throw new AppError(400, 'BAD_REQUEST', '研究关键词必须是字符串数组');
    }
    const tags = normalizeTagList(patch.researchTags, { max: 12 });
    const rawCount = patch.researchTags.filter((t) => typeof t === 'string' && t.trim()).length;
    if (tags.length === 0) throw new AppError(400, 'BAD_REQUEST', '至少保留 1 个研究关键词');
    if (rawCount > 12) throw new AppError(400, 'BAD_REQUEST', '研究关键词最多 12 个');
    if (rawCount !== tags.length) {
      // 去重后数量减少是允许的，这里只拦截超长
    }
    next.researchTags = tags;
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'recommendationSource')) {
    if (!RECOMMENDATION_SOURCES.includes(patch.recommendationSource)) {
      throw new AppError(400, 'BAD_REQUEST', '推荐来源必须是 auto、paper、wechat 或 curated');
    }
    next.recommendationSource = patch.recommendationSource;
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'readingOrder')) {
    if (!Array.isArray(patch.readingOrder) || patch.readingOrder.length > 2000 ||
        patch.readingOrder.some(id => typeof id !== 'string' || !id.length || id.length > 256)) {
      throw new AppError(400, 'BAD_REQUEST', '书籍顺序必须为有效的书籍编号数组，最多 2000 本');
    }
    next.readingOrder = [...new Set(patch.readingOrder)];
  }
  return next;
}

/** 对外 Settings（永不含原始 Key） */
export function toPublicSettings(settings, paths) {
  const apiKey = settings.wereadApiKey || '';
  return {
    wereadConfigured: Boolean(apiKey),
    wereadKeyMasked: maskSecret(apiKey),
    goalMinutes: settings.goalMinutes,
    checkinMinutes: settings.checkinMinutes,
    researchTags: [...settings.researchTags],
    recommendationSource: settings.recommendationSource,
    readingOrder: [...settings.readingOrder],
    dataDir: paths.dataDir,
    recommendationsCsv: paths.recommendations,
    appVersion: APP_VERSION,
  };
}

function sanitizeCacheName(name) {
  return String(name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

/**
 * @param {{ dataDir?: string, now?: () => Date }} [options]
 */
export function createStore({ dataDir, now = () => new Date() } = {}) {
  const resolvedDataDir = resolveDataDir(dataDir);
  const cacheDir = path.join(resolvedDataDir, 'cache');
  ensureDirSync(resolvedDataDir);
  ensureDirSync(cacheDir);

  const paths = {
    dataDir: resolvedDataDir,
    settings: path.join(resolvedDataDir, 'settings.json'),
    books: path.join(resolvedDataDir, 'books.json'),
    papers: path.join(resolvedDataDir, 'papers.json'),
    checkins: path.join(resolvedDataDir, 'checkins.csv'),
    recommendations: path.join(resolvedDataDir, 'recommendations.csv'),
    cacheDir,
    seedCurated: path.join(resolvedDataDir, 'seed', 'curated_papers.json'),
  };

  /** @type {Map<string, {savedAt: number, data: any}>} */
  const memoryCache = new Map();
  let settingsCache = null;

  function loadSettings() {
    const raw = readJsonSync(paths.settings, DEFAULT_SETTINGS, (data) => data && typeof data === 'object');
    return normalizeSettings({ ...DEFAULT_SETTINGS, ...raw });
  }

  function getSettings() {
    if (!settingsCache) settingsCache = loadSettings();
    return { ...settingsCache, researchTags: [...settingsCache.researchTags], readingOrder: [...settingsCache.readingOrder] };
  }

  function saveSettings(nextSettings) {
    const normalized = normalizeSettings(nextSettings);
    writeJsonAtomicSync(paths.settings, normalized);
    settingsCache = normalized;
    return getSettings();
  }

  function updateSettings(patch) {
    const current = getSettings();
    const next = validateSettingsPatch(patch, current);
    return saveSettings(next);
  }

  function getPublicSettings() {
    return toPublicSettings(getSettings(), paths);
  }

  function readBooks() {
    const data = readJsonSync(paths.books, { items: [] }, (value) => value && Array.isArray(value.items));
    return { items: data.items.filter((item) => item && typeof item === 'object') };
  }

  function writeBooks(items) {
    writeJsonAtomicSync(paths.books, { items });
  }

  function readPapers() {
    const data = readJsonSync(paths.papers, { items: [] }, (value) => value && Array.isArray(value.items));
    return { items: data.items.filter((item) => item && typeof item === 'object') };
  }

  function writePapers(items) {
    writeJsonAtomicSync(paths.papers, { items });
  }

  function readCheckinRows() {
    return readCsvSync(paths.checkins, [...CHECKIN_COLUMNS]);
  }

  function writeCheckinRows(rows) {
    writeCsvAtomicSync(paths.checkins, [...CHECKIN_COLUMNS], rows);
  }

  function readRecommendationRows() {
    return readCsvSync(paths.recommendations, [...RECOMMENDATION_COLUMNS]);
  }

  function writeRecommendationRows(rows) {
    writeCsvAtomicSync(paths.recommendations, [...RECOMMENDATION_COLUMNS], rows);
  }

  /** 只读加载精选文献库；缺失/损坏时返回错误提示，绝不修改 seed 文件 */
  function readSeedCurated() {
    if (!fileExists(paths.seedCurated)) {
      return { items: [], error: '精选文献库为空，请先导入 data/seed/curated_papers.json' };
    }
    try {
      const data = JSON.parse(readTextSync(paths.seedCurated, '[]').replace(/^\uFEFF/, ''));
      if (!Array.isArray(data)) throw new Error('seed 不是数组');
      const items = data.filter(
        (item) => item && typeof item.title === 'string' && item.title.trim() && typeof item.url === 'string' && item.url.trim(),
      );
      if (items.length === 0) return { items: [], error: '精选文献库中没有可用的文献' };
      return { items, error: null };
    } catch {
      return { items: [], error: '精选文献库文件已损坏，请检查 data/seed/curated_papers.json' };
    }
  }

  function cacheFilePath(name) {
    return path.join(cacheDir, `weread-${sanitizeCacheName(name)}.json`);
  }

  /**
   * 读取缓存；maxAgeMs=Infinity 表示忽略过期时间（仅在降级展示旧数据时使用）。
   * @param {string} name
   * @param {number} maxAgeMs
   * @param {{refresh?: boolean}} [options]
   */
  function cacheGetSync(name, maxAgeMs, { refresh = false } = {}) {
    if (refresh) return null;
    const key = sanitizeCacheName(name);
    const nowMs = Date.now();
    const mem = memoryCache.get(key);
    if (mem && Number.isFinite(maxAgeMs) && nowMs - mem.savedAt > maxAgeMs) {
      memoryCache.delete(key);
    } else if (mem && (maxAgeMs === Infinity || nowMs - mem.savedAt <= maxAgeMs)) {
      return mem.data;
    }
    const file = cacheFilePath(name);
    if (!fileExists(file)) return null;
    try {
      const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!entry || typeof entry.savedAt !== 'number' || !('data' in entry)) return null;
      if (Number.isFinite(maxAgeMs) && nowMs - entry.savedAt > maxAgeMs) return null;
      memoryCache.set(key, entry);
      return entry.data;
    } catch {
      return null;
    }
  }

  function cacheSetSync(name, data) {
    const entry = { savedAt: Date.now(), data };
    memoryCache.set(sanitizeCacheName(name), entry);
    try {
      writeJsonAtomicSync(cacheFilePath(name), entry);
    } catch {
      // 缓存写失败不影响主流程
    }
    return data;
  }

  return {
    dataDir: resolvedDataDir,
    paths,
    now,
    nowIso: () => isoShanghai(now()),
    getSettings,
    saveSettings,
    updateSettings,
    getPublicSettings,
    readBooks,
    writeBooks,
    readPapers,
    writePapers,
    readCheckinRows,
    writeCheckinRows,
    readRecommendationRows,
    writeRecommendationRows,
    readSeedCurated,
    cacheGetSync,
    cacheSetSync,
  };
}
