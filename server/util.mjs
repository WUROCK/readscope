/**
 * 阅界服务端通用工具：时间（Asia/Shanghai）、原子文件写入、CSV/JSON 读写、文本归一化。
 * 所有对外时间戳均为带 +08:00 的 ISO 8601；日期键为 UTC+8 的 YYYY-MM-DD。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse as parseCsv } from 'csv-parse/sync';
import { stringify as stringifyCsv } from 'csv-stringify/sync';

export const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* 错误类型                                                             */
/* ------------------------------------------------------------------ */

export class AppError extends Error {
  /**
   * @param {number} status HTTP 状态码
   * @param {string} code 业务错误码
   * @param {string} message 中文提示
   */
  constructor(status, code, message) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

export function badRequest(message) {
  return new AppError(400, 'BAD_REQUEST', message);
}

export function notFound(message) {
  return new AppError(404, 'NOT_FOUND', message);
}

export class TimeoutError extends Error {
  constructor(message = '操作超时') {
    super(message);
    this.name = 'TimeoutError';
    this.code = 'TIMEOUT';
  }
}

/* ------------------------------------------------------------------ */
/* 时间 / 日期（固定 UTC+8，中国无夏令时）                              */
/* ------------------------------------------------------------------ */

const pad2 = (n) => String(n).padStart(2, '0');

/** @param {Date} [date] */
export function shanghaiParts(date = new Date()) {
  const d = new Date(date.getTime() + CHINA_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    weekday: d.getUTCDay(), // 0=周日
  };
}

/** Date -> 'YYYY-MM-DD'（UTC+8） */
export function dateKey(date = new Date()) {
  const p = shanghaiParts(date);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** Unix 秒 -> 'YYYY-MM-DD'（UTC+8） */
export function timestampSecToDateKey(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return null;
  // 兼容毫秒时间戳
  const seconds = n > 1e12 ? Math.floor(n / 1000) : n;
  return dateKey(new Date(seconds * 1000));
}

/** 'YYYY-MM-DD' -> 当地（UTC+8）零点 Unix 秒 */
export function dateKeyToTimestampSec(key) {
  const ms = Date.parse(`${key}T00:00:00+08:00`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

/** Date -> 'YYYY-MM-DDTHH:mm:ss+08:00' */
export function isoShanghai(date = new Date()) {
  const p = shanghaiParts(date);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}+08:00`;
}

export function isDateKey(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** 日期键加减天数（纯日期运算，不受服务器本地时区影响） */
export function addDaysKey(key, delta) {
  const [y, m, d] = key.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + delta * 86400000;
  const nd = new Date(t);
  return `${nd.getUTCFullYear()}-${pad2(nd.getUTCMonth() + 1)}-${pad2(nd.getUTCDate())}`;
}

/** 周一=0 ... 周日=6 */
export function weekdayIndexFromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export const WEEKDAY_NAMES = ['一', '二', '三', '四', '五', '六', '日'];

export function weekdayNameFromKey(key) {
  return WEEKDAY_NAMES[weekdayIndexFromKey(key)];
}

/** 本周周一日期键 */
export function weekStartKey(todayKey = dateKey()) {
  return addDaysKey(todayKey, -weekdayIndexFromKey(todayKey));
}

/** 当前月所有日期键，按升序 */
export function monthDateKeys(anyDateKey = dateKey()) {
  const [y, m] = anyDateKey.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => `${y}-${pad2(m)}-${pad2(i + 1)}`);
}

export function monthKeyOf(anyDateKey = dateKey()) {
  return anyDateKey.slice(0, 7);
}

export function monthLabelOf(anyDateKey = dateKey()) {
  const [y, m] = anyDateKey.split('-').map(Number);
  return `${y}年${m}月`;
}

/** 年积日（1-366），用于每日推荐轮换 */
export function dayOfYearFromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  const start = Date.UTC(y, 0, 1);
  const cur = Date.UTC(y, m - 1, d);
  return Math.floor((cur - start) / 86400000) + 1;
}

/** 时间戳（秒）-> ISO（UTC+8） */
export function timestampSecToIso(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return null;
  return isoShanghai(new Date((n > 1e12 ? Math.floor(n / 1000) : n) * 1000));
}

/* ------------------------------------------------------------------ */
/* 数值 / 文本                                                          */
/* ------------------------------------------------------------------ */

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function roundNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

export function toFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function collapseWhitespace(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/** 按 Unicode 码点截断，超出时追加省略号 */
export function truncateText(text, maxChars, suffix = '…') {
  const clean = collapseWhitespace(text);
  const chars = Array.from(clean);
  if (chars.length <= maxChars) return clean;
  return chars.slice(0, maxChars).join('').trimEnd() + suffix;
}

/** 归一化 URL：小写 host、去掉 utm_* / scene / fbclid 参数、去掉 hash */
export function normalizeUrl(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  let url;
  try {
    url = new URL(text);
  } catch {
    return text.toLowerCase();
  }
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  const params = [...url.searchParams.entries()].filter(([key]) => {
    const k = key.toLowerCase();
    return !k.startsWith('utm_') && k !== 'scene' && k !== 'fbclid';
  });
  params.sort(([a], [b]) => a.localeCompare(b));
  url.search = '';
  for (const [key, value] of params) url.searchParams.append(key, value);
  let out = url.toString();
  // 去掉路径末尾多余的 /
  if (out.endsWith('/') && url.pathname !== '/') out = out.slice(0, -1);
  return out.toLowerCase();
}

/** 归一化标题：去标点、压缩空白、小写 */
export function normalizeTitle(raw) {
  return String(raw ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hashId(value, length = 10) {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, length);
}

/** 掩码 API Key：wrk-abcd•••••••• */
export function maskSecret(key) {
  const text = String(key ?? '');
  if (!text) return null;
  const visible = text.length <= 8 ? text.slice(0, 4) : text.slice(0, 8);
  return `${visible}${'•'.repeat(8)}`;
}

export function parseBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'y', '是'].includes(text)) return true;
  if (['false', '0', 'no', 'n', '否', ''].includes(text)) return false;
  return fallback;
}

/** 标签归一化：trim、去空、去重、限制数量与单条长度 */
export function normalizeTagList(values, { max = 12, maxLength = 40 } = {}) {
  if (!Array.isArray(values)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of values) {
    if (typeof raw !== 'string') continue;
    const tag = raw.trim().slice(0, maxLength);
    if (!tag) continue;
    const dedupeKey = tag.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 并发 / 超时                                                          */
/* ------------------------------------------------------------------ */

/** 限制并发数的 map */
export async function mapLimit(items, limit, mapper) {
  const list = Array.from(items);
  const results = new Array(list.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit || 1, list.length));
  async function worker() {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(list[index], index);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/** 给 Promise 加超时；超时抛出 TimeoutError，避免迟到的 rejection 变成 unhandled */
export async function withTimeout(promise, ms, message = '操作超时') {
  const guarded = Promise.resolve(promise);
  guarded.catch(() => {});
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(message)), ms);
  });
  try {
    return await Promise.race([guarded, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* 文件写入（temp + rename，单进程内同步串行）                          */
/* ------------------------------------------------------------------ */

export function ensureDirSync(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function fileExists(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function makeTempPath(file) {
  return `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 原子写入文本：先写同目录临时文件再 rename */
export function writeTextAtomicSync(file, content) {
  ensureDirSync(path.dirname(file));
  const tmp = makeTempPath(file);
  try {
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, file);
  } catch (error) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw error;
  }
}

/** 原子写入 JSON（带缩进，便于人工查看） */
export function writeJsonAtomicSync(file, data) {
  writeTextAtomicSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

/** 损坏文件改名备份为 *.corrupt-<ts> */
export function backupCorruptFile(file) {
  if (!fileExists(file)) return null;
  const backup = `${file}.corrupt-${Date.now()}`;
  try {
    fs.renameSync(file, backup);
  } catch {
    try {
      fs.copyFileSync(file, backup);
    } catch {
      /* ignore */
    }
  }
  return backup;
}

/**
 * 读取 JSON；缺失/损坏则返回 fallback，损坏文件自动备份。
 * @template T
 * @param {string} file
 * @param {T} fallback
 * @param {(data: any) => boolean} [validate]
 * @returns {T}
 */
export function readJsonSync(file, fallback, validate) {
  if (!fileExists(file)) return structuredClone(fallback);
  try {
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    if (!text.trim()) return structuredClone(fallback);
    const data = JSON.parse(text);
    if (validate && !validate(data)) throw new Error('invalid shape');
    return data;
  } catch {
    backupCorruptFile(file);
    return structuredClone(fallback);
  }
}

export function readTextSync(file, fallback = '') {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
}

/* ------------------------------------------------------------------ */
/* CSV（UTF-8 BOM，兼容带逗号/换行的字段，Excel 友好）                  */
/* ------------------------------------------------------------------ */

/**
 * 读取 CSV 为对象数组；兼容 BOM、引号、空行。损坏时备份并返回 []。
 * @param {string} file
 * @param {string[]} columns
 */
export function readCsvSync(file, columns) {
  if (!fileExists(file)) return [];
  let text;
  try {
    text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  } catch {
    return [];
  }
  if (!text.trim()) return [];
  try {
    const records = parseCsv(text, {
      columns,
      bom: true,
      from_line: 2, // 我们的 CSV 首行固定是表头
      skip_empty_lines: true,
      relax_column_count: true,
      relax_quotes: true,
      trim: false,
    });
    return Array.isArray(records) ? records : [];
  } catch {
    backupCorruptFile(file);
    return [];
  }
}

/** 生成带 BOM 的 CSV 文本 */
export function buildCsvText(columns, rows) {
  const body = stringifyCsv(rows, {
    header: true,
    columns,
    record_delimiter: '\r\n',
    quoted: false,
  });
  return `\uFEFF${body}`;
}

/** 原子写入 CSV（UTF-8 BOM） */
export function writeCsvAtomicSync(file, columns, rows) {
  writeTextAtomicSync(file, buildCsvText(columns, rows));
}

/** CSV 下载用：若文件不存在返回仅含表头的 CSV（含 BOM） */
export function csvDownloadText(file, columns) {
  if (fileExists(file)) {
    const text = fs.readFileSync(file, 'utf8');
    return text.startsWith('\uFEFF') ? text : `\uFEFF${text}`;
  }
  return buildCsvText(columns, []);
}
