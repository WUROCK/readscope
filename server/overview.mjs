/**
 * Overview 编排：微信读书 / 演示数据降级、自动打卡、打卡回填与历史合并。
 * 路由层只负责 HTTP，本模块专注业务规则。
 */

import { dateKey, roundNumber } from './util.mjs';
import { buildWereadOverview, shortWereadError } from './weread.mjs';
import { buildDemoHistory, buildDemoOverview, DEMO_NOTICE } from './demo.mjs';
import { buildCheckinHistory, computeStreak } from './checkins.mjs';

/** 秒/日 -> 分钟/日 */
export function secondsToMinutesByDate(secondsByDate = {}) {
  const out = {};
  for (const [key, value] of Object.entries(secondsByDate || {})) {
    const minutes = Math.max(0, Math.round(roundNumber(value, 0) / 60));
    if (minutes > 0) out[key] = minutes;
  }
  return out;
}

/**
 * @param {{
 *   store: ReturnType<import('./store.mjs').createStore>,
 *   weread: ReturnType<import('./weread.mjs').createWereadClient>,
 *   checkins: ReturnType<import('./checkins.mjs').createCheckinsService>,
 *   now?: () => Date,
 * }} deps
 */
export function createOverviewService({ store, weread, checkins, now = () => new Date() }) {
  function rowsMap() {
    return checkins.mapByDate(checkins.loadRows());
  }

  function buildLiveOverview({ data, settings, error = null, notice = null, applyCheckins = true }) {
    const today = dateKey(now());
    const monthlyMinutes = secondsToMinutesByDate(data?.monthlySecondsByDate || {});
    if (applyCheckins) {
      checkins.backfillPastDays({
        minutesByDate: monthlyMinutes,
        threshold: settings.checkinMinutes,
        todayKey: today,
      });
      const weeklySeconds = data?.weeklySecondsByDate || {};
      const monthlySeconds = data?.monthlySecondsByDate || {};
      const todaySeconds = Number(weeklySeconds[today] ?? monthlySeconds[today] ?? 0);
      // 用原始秒数换算分钟参与阈值比较，落盘时四舍五入。
      checkins.ensureAuto(todaySeconds / 60, settings.checkinMinutes, today);
    }
    const rows = checkins.loadRows();
    const history = buildCheckinHistory({
      days: 30,
      todayKey: today,
      rowsByDate: checkins.mapByDate(rows),
      minutesByDate: monthlyMinutes,
    });
    const checkedDates = new Set(rows.filter((row) => row.checkedIn).map((row) => row.date));
    const todayRow = checkins.mapByDate(rows).get(today) || null;
    const base = buildWereadOverview({
      data,
      settings,
      now: now(),
      todayRow,
      checkinHistory: history,
      streak: computeStreak(checkedDates, today),
    });
    return {
      ...base,
      source: 'weread',
      connected: true,
      error,
      notice,
    };
  }

  function buildDemo(settings, { error = null, notice = DEMO_NOTICE } = {}) {
    return buildDemoOverview({
      now: now(),
      settings,
      rowsByDate: rowsMap(),
      error,
      notice,
    });
  }

  async function getOverview({ refresh = false } = {}) {
    const settings = store.getSettings();
    if (!settings.wereadApiKey) {
      return buildDemo(settings);
    }
    try {
      const data = await weread.loadData(settings.wereadApiKey, { refresh });
      return buildLiveOverview({ data, settings });
    } catch (error) {
      const reason = shortWereadError(error);
      const cached = weread.loadCachedData(settings.wereadApiKey);
      if (cached) {
        return buildLiveOverview({
          data: cached,
          settings,
          error: reason,
          notice: `微信读书同步失败（${reason}），当前展示上次同步的数据`,
          applyCheckins: false,
        });
      }
      return buildDemo(settings, {
        error: reason,
        notice: `微信读书同步失败（${reason}），当前为演示数据，请检查 API Key 后重试`,
      });
    }
  }

  /** 打卡历史（不触发网络：无 Key 用演示数据，有 Key 仅用本地缓存月报补分钟数） */
  function getCheckinHistory({ days = 30 } = {}) {
    const settings = store.getSettings();
    const today = dateKey(now());
    const rows = checkins.loadRows();
    const rowsByDate = checkins.mapByDate(rows);
    if (!settings.wereadApiKey) {
      return buildDemoHistory({ now: now(), settings, rowsByDate, days });
    }
    const cached = weread.loadCachedData(settings.wereadApiKey);
    const monthlyMinutes = secondsToMinutesByDate(cached?.monthlySecondsByDate || {});
    return buildCheckinHistory({
      days,
      todayKey: today,
      rowsByDate,
      minutesByDate: monthlyMinutes,
    });
  }

  /**
   * 后台轻量自动打卡：只拉本周每日阅读时长，不拉书架/进度。
   * 用于 Electron 窗口隐藏时仍能在达标后写入打卡。
   */
  async function autoCheckinOnly({ refresh = false } = {}) {
    const settings = store.getSettings();
    if (!settings.wereadApiKey) {
      return { configured: false, checkedIn: false, changed: false };
    }
    const today = dateKey(now());
    try {
      const secondsByDate = await weread.loadWeeklyReadTimes(settings.wereadApiKey, { refresh });
      const seconds = Math.max(0, Math.round(Number(secondsByDate?.[today]) || 0));
      // 阈值用原始秒数比较，写入时四舍五入为整数分钟。
      const minutes = Math.floor(seconds / 60);
      const result = checkins.ensureAuto(seconds / 60, settings.checkinMinutes, today);
      const row = checkins.mapByDate(checkins.loadRows()).get(today) || result.row || null;
      return {
        configured: true,
        date: today,
        minutes,
        seconds,
        checkedIn: Boolean(row?.checkedIn),
        source: row?.source || null,
        changed: Boolean(result.changed),
        updatedAt: row?.updatedAt || null,
      };
    } catch (error) {
      return {
        configured: true,
        date: today,
        minutes: 0,
        checkedIn: false,
        changed: false,
        error: shortWereadError(error),
      };
    }
  }

  /** 手动打卡：写 source=manual 行，再返回最新 Today */
  async function manualCheckin({ minutes }) {
    const today = dateKey(now());
    const value = Math.max(0, Math.min(600, Math.round(Number(minutes) || 0)));
    const row = checkins.upsert({ date: today, minutes: value, checkedIn: true, source: 'manual' });
    const overview = await getOverview();
    return {
      day: {
        date: row.date,
        minutes: row.minutes,
        checkedIn: true,
        source: 'manual',
      },
      today: overview.today,
    };
  }

  return {
    getOverview,
    getCheckinHistory,
    manualCheckin,
    autoCheckinOnly,
    rowsMap,
  };
}
