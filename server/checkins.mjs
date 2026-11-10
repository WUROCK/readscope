/**
 * 打卡记录：data/checkins.csv（UTF-8 BOM）。
 * 规则：
 *  - 今日阅读达到 checkinMinutes 自动写入 source=auto；
 *  - 连接微信读书后，用本月 readdata 回填过去日期的打卡，保证连续天数不丢；
 *  - 永远不写未来日期；连续天数 = 以今天（今天未打卡则从昨天）结尾的连续已打卡天数。
 */

import {
  addDaysKey,
  dateKey,
  isDateKey,
  isoShanghai,
  monthDateKeys,
  monthKeyOf,
  parseBool,
  roundNumber,
} from './util.mjs';

const VALID_SOURCE = new Set(['auto', 'manual']);

/** 归一化 CSV 行为内部结构（去重、按日期升序） */
export function normalizeCheckinRows(rawRows) {
  const byDate = new Map();
  for (const raw of Array.isArray(rawRows) ? rawRows : []) {
    if (!raw || !isDateKey(String(raw.date || '').trim())) continue;
    const key = String(raw.date).trim();
    const minutes = Math.max(0, Math.min(1440, roundNumber(raw.minutes, 0)));
    const checkedIn = parseBool(raw.checked_in, false);
    let source = String(raw.source || '').trim();
    if (!VALID_SOURCE.has(source)) source = checkedIn ? 'auto' : '';
    byDate.set(key, {
      date: key,
      minutes,
      checkedIn,
      source: checkedIn ? source : '',
      updatedAt: String(raw.updated_at || '').trim(),
    });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function rowsToCsvRows(rows) {
  return rows.map((row) => ({
    date: row.date,
    minutes: String(row.minutes),
    checked_in: row.checkedIn ? 'true' : 'false',
    source: row.source || '',
    updated_at: row.updatedAt || '',
  }));
}

/** 纯函数：连续打卡天数 */
export function computeStreak(checkedDates, todayKey = dateKey()) {
  const set = checkedDates instanceof Set ? checkedDates : new Set(checkedDates || []);
  let cursor = set.has(todayKey) ? todayKey : addDaysKey(todayKey, -1);
  let streak = 0;
  while (set.has(cursor)) {
    streak += 1;
    cursor = addDaysKey(cursor, -1);
  }
  return streak;
}

/**
 * 最近 N 天打卡历史（升序，最后一天是今天）。
 * 分钟数优先取打卡行，其次月度阅读分钟；演示数据通过 fallbackByDate 注入。
 * @param {{
 *   days?: number,
 *   todayKey: string,
 *   rowsByDate: Map<string, any>,
 *   minutesByDate?: Record<string, number>,
 *   fallbackByDate?: Map<string, {minutes:number, checkedIn:boolean, source:'auto'|'manual'|null}>,
 * }} options
 */
export function buildCheckinHistory({
  days = 30,
  todayKey,
  rowsByDate,
  minutesByDate = {},
  fallbackByDate = new Map(),
}) {
  const span = Math.max(1, Math.min(366, Math.round(Number(days) || 30)));
  const out = [];
  for (let i = span - 1; i >= 0; i -= 1) {
    const key = addDaysKey(todayKey, -i);
    const row = rowsByDate instanceof Map ? rowsByDate.get(key) : rowsByDate?.[key];
    const fallback = fallbackByDate instanceof Map ? fallbackByDate.get(key) : fallbackByDate?.[key];
    const readingMinutes = Math.max(
      0,
      roundNumber(row?.minutes ?? fallback?.minutes ?? minutesByDate?.[key] ?? 0, 0),
    );
    const checkedIn = row ? Boolean(row.checkedIn) : Boolean(fallback?.checkedIn);
    const source = checkedIn ? row?.source || fallback?.source || 'auto' : null;
    out.push({ date: key, minutes: readingMinutes, checkedIn, source });
  }
  return out;
}

/**
 * @param {{ store: ReturnType<import('./store.mjs').createStore>, now?: () => Date }} deps
 */
export function createCheckinsService({ store, now = () => new Date() }) {
  function loadRows() {
    return normalizeCheckinRows(store.readCheckinRows());
  }

  function mapByDate(rows = loadRows()) {
    return new Map(rows.map((row) => [row.date, row]));
  }

  function writeRows(rows) {
    store.writeCheckinRows(rowsToCsvRows(rows));
  }

  function todayKey() {
    return dateKey(now());
  }

  function upsert(day, rows = null) {
    const list = rows || loadRows();
    const map = mapByDate(list);
    const timestamp = isoShanghai(now());
    const row = {
      date: day.date,
      minutes: Math.max(0, Math.min(1440, roundNumber(day.minutes, 0))),
      checkedIn: day.checkedIn !== false,
      source: day.source === 'manual' ? 'manual' : 'auto',
      updatedAt: day.updatedAt || timestamp,
    };
    map.set(row.date, row);
    const next = [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
    writeRows(next);
    return row;
  }

  function upsertMany(days) {
    const map = mapByDate(loadRows());
    const timestamp = isoShanghai(now());
    let changed = 0;
    for (const day of days) {
      if (!isDateKey(day.date)) continue;
      const previous = map.get(day.date);
      const source = day.source === 'manual' ? 'manual' : 'auto';
      const row = {
        date: day.date,
        minutes: Math.max(0, Math.min(1440, roundNumber(day.minutes, 0))),
        checkedIn: day.checkedIn !== false,
        source,
        updatedAt: day.updatedAt || timestamp,
      };
      if (
        previous &&
        previous.checkedIn === row.checkedIn &&
        previous.source === row.source &&
        previous.minutes === row.minutes
      ) {
        continue;
      }
      map.set(row.date, row);
      changed += 1;
    }
    if (changed > 0) {
      writeRows([...map.values()].sort((a, b) => a.date.localeCompare(b.date)));
    }
    return changed;
  }

  /**
   * 今日自动打卡：达到阈值则写入/更新 auto 行；已有 manual 行时保持 manual。
   * @returns {{row: any, changed: boolean}}
   */
  function ensureAuto(minutes, threshold, key = todayKey()) {
    // 用原始分钟数与阈值比较（29分59秒不算达标），落盘时展示为四舍五入的整数分钟。
    const rawMinutes = Math.max(0, Number(minutes) || 0);
    const targetMinutes = Math.max(0, Math.round(rawMinutes));
    const map = mapByDate();
    const existing = map.get(key);
    if (rawMinutes < threshold) {
      return { row: existing || null, changed: false };
    }
    if (existing && existing.checkedIn && existing.source === 'manual') {
      return { row: existing, changed: false };
    }
    const nextMinutes = Math.max(existing?.minutes || 0, targetMinutes);
    if (existing && existing.checkedIn && existing.source === 'auto' && existing.minutes === nextMinutes) {
      return { row: existing, changed: false };
    }
    const row = upsert({ date: key, minutes: nextMinutes, checkedIn: true, source: 'auto' }, loadRows());
    return { row, changed: true };
  }

  /**
   * 用本月 readdata 的每日分钟回填过去日期（不含今天、不含未来）。
   * @param {{
   *   minutesByDate: Record<string, number>,
   *   threshold: number,
   *   todayKey?: string,
   *   monthKey?: string,
   * }} options
   */
  function backfillPastDays({ minutesByDate, threshold, todayKey: today = todayKey(), monthKey = monthKeyOf(today) }) {
    const map = mapByDate();
    const monthDays = new Set(monthDateKeys(today));
    const pending = [];
    for (const [key, rawMinutes] of Object.entries(minutesByDate || {})) {
      if (!monthDays.has(key) || !key.startsWith(monthKey)) continue;
      if (key >= today) continue; // 只回填过去日期
      const minutes = Math.max(0, roundNumber(rawMinutes, 0));
      if (minutes < threshold) continue;
      const existing = map.get(key);
      if (existing && existing.checkedIn && existing.source === 'manual') continue;
      if (existing && existing.checkedIn && existing.source === 'auto' && existing.minutes === minutes) continue;
      pending.push({ date: key, minutes, checkedIn: true, source: 'auto' });
    }
    const changed = upsertMany(pending);
    return { changed, dates: pending.map((item) => item.date) };
  }

  function history({ days = 30, minutesByDate = {}, fallbackByDate = new Map(), rows = null } = {}) {
    const today = todayKey();
    return buildCheckinHistory({
      days,
      todayKey: today,
      rowsByDate: mapByDate(rows || loadRows()),
      minutesByDate,
      fallbackByDate,
    });
  }

  function streak(extraCheckedDates = []) {
    const rows = loadRows();
    const checked = new Set(rows.filter((row) => row.checkedIn).map((row) => row.date));
    for (const key of extraCheckedDates) checked.add(key);
    return computeStreak(checked, todayKey());
  }

  function getTodayRow() {
    return mapByDate().get(todayKey()) || null;
  }

  return {
    loadRows,
    mapByDate,
    upsert,
    upsertMany,
    ensureAuto,
    backfillPastDays,
    history,
    streak,
    getTodayRow,
    todayKey,
  };
}
