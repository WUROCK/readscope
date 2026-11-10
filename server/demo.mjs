/**
 * 演示数据：未配置 API Key（或连接失败且无缓存）时展示。
 * 数据按 Asia/Shanghai 当天日期计算，同一天内完全确定，适合截图与验收。
 */

import {
  addDaysKey,
  dateKey,
  isoShanghai,
  monthLabelOf,
  roundNumber,
  weekStartKey,
  weekdayIndexFromKey,
  weekdayNameFromKey,
} from './util.mjs';
import { breadthLabel, buildDomainStats, domainName, mapCategoryToDomain } from './domains.mjs';
import { deriveWereadTags } from './tags.mjs';
import { computeStreak } from './checkins.mjs';

export const DEMO_NOTICE = '当前为演示数据，连接微信读书后自动同步真实进度';

export const DEMO_TODAY_MINUTES = 42;
export const DEMO_MONTH_MINUTES = 1048;
export const DEMO_MONTH_READ_DAYS = 22;
export const DEMO_MONTH_STARTED_BOOKS = 5;
export const DEMO_MONTH_FINISHED_BOOKS = 2;
export const DEMO_YEAR_STARTED_BOOKS = 31;
const DEMO_ANNUAL_MONTH_PATTERN = [612, 540, 728, 480, 690, 755, 520, 610, 580, 1048, 0, 0];
const DEMO_WEEK_PATTERN = [38, 52, 45, 28, 60, 41, 42]; // 周一 -> 周日（今天固定 42）
const DEMO_DOMAIN_MINUTES = Object.freeze({
  literature: 286,
  humanities: 192,
  business: 134,
  tech: 208,
  psychology: 118,
  arts: 110,
  education: 0,
  other: 0,
});
const DEMO_DOMAIN_BOOKS = Object.freeze({
  literature: 2,
  humanities: 1,
  business: 1,
  tech: 2,
  psychology: 1,
  arts: 1,
  education: 0,
  other: 0,
});

const DEMO_BOOK_SEED = Object.freeze([
  {
    bookId: 'demo-huozhe',
    title: '活着',
    author: '余华',
    category: '文学',
    progress: 100,
    readingMinutes: 312,
    hoursAgo: 3,
    finished: true,
  },
  {
    bookId: 'demo-renleijianshi',
    title: '人类简史',
    author: '尤瓦尔·赫拉利',
    category: '历史',
    progress: 64,
    readingMinutes: 186,
    hoursAgo: 14,
    finished: false,
  },
  {
    bookId: 'demo-yuanze',
    title: '原则',
    author: '瑞·达利欧',
    category: '经济',
    progress: 38,
    readingMinutes: 92,
    hoursAgo: 20,
    finished: false,
  },
  {
    bookId: 'demo-shenduxuexi',
    title: '深度学习',
    author: '伊恩·古德费洛',
    category: '计算机',
    progress: 27,
    readingMinutes: 64,
    hoursAgo: 49,
    finished: false,
  },
  {
    bookId: 'demo-beitaoyan',
    title: '被讨厌的勇气',
    author: '岸见一郎',
    category: '心理',
    progress: 72,
    readingMinutes: 121,
    hoursAgo: 73,
    finished: false,
  },
  {
    bookId: 'demo-shancha',
    title: '山茶文具店',
    author: '小川糸',
    category: '生活',
    progress: 45,
    readingMinutes: 38,
    hoursAgo: 97,
    finished: false,
  },
]);

function shanghaiIsoHoursAgo(now, hours) {
  return isoShanghai(new Date(now.getTime() - hours * 3600 * 1000));
}

/** 演示书籍（lastReadAt 相对现在，保证截图里“最近在读”自然） */
export function buildDemoBooks(now = new Date()) {
  return DEMO_BOOK_SEED.map((seed) => {
    const domainId = seed.category ? mapDemoCategory(seed.category) : 'other';
    const label = demoDomainName(domainId);
    return {
      id: `wr:${seed.bookId}`,
      bookId: seed.bookId,
      title: seed.title,
      author: seed.author,
      cover: null,
      category: seed.category,
      domain: domainId,
      domainName: label,
      tags: deriveWereadTags(seed.category, label),
      progress: seed.progress,
      readingMinutes: seed.readingMinutes,
      lastReadAt: shanghaiIsoHoursAgo(now, seed.hoursAgo),
      finished: seed.finished,
      readerLink: null,
    };
  });
}

/** 演示年度 12 个月分钟（当前月为 1048，未来月份为 0，确定性可截图） */
export function buildDemoAnnualMonths(now = new Date()) {
  const currentMonth = Number(dateKey(now).slice(5, 7));
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    let minutes = 0;
    if (month === currentMonth) minutes = DEMO_MONTH_MINUTES;
    else if (month < currentMonth) minutes = DEMO_ANNUAL_MONTH_PATTERN[index] || 0;
    return { month, minutes };
  });
}

function mapDemoCategory(category) {
  return mapCategoryToDomain(category);
}

function demoDomainName(domainId) {
  return domainName(domainId);
}

/** 演示打卡种子（最后一天为今天；默认 30 分钟阈值下最近 6 天连续） */
export function buildDemoCheckinDays({ now = new Date(), settings, rowsByDate = new Map(), days = 30 } = {}) {
  const today = dateKey(now);
  const threshold = Math.max(1, Number(settings?.checkinMinutes) || 30);
  const span = Math.max(1, Math.min(366, Math.round(Number(days) || 30)));
  const previousStreakMinutes = { 1: 48, 2: 41, 3: 52, 4: 37, 5: 44 };
  const result = [];
  for (let i = span - 1; i >= 0; i -= 1) {
    const key = addDaysKey(today, -i);
    let minutes;
    if (i === 0) {
      minutes = DEMO_TODAY_MINUTES;
    } else if (i <= 5) {
      minutes = previousStreakMinutes[i] ?? DEMO_TODAY_MINUTES;
    } else if (i === 6) {
      minutes = 18; // 故意打断，默认阈值下连续天数正好为 6
    } else {
      minutes = (i * 13 + 17) % 50;
    }
    const row = rowsByDate.get(key);
    const actualChecked = row ? Boolean(row.checkedIn) : false;
    const checkedIn = actualChecked || minutes >= threshold;
    result.push({
      date: key,
      minutes: row ? Math.max(0, roundNumber(row.minutes, 0)) : minutes,
      checkedIn,
      source: checkedIn ? (row?.source || 'auto') : null,
      updatedAt: row?.updatedAt || '',
    });
  }
  return result;
}


/**
 * 最近 N 天打卡历史（演示 + 真实手动记录覆盖）。
 * @param {{now?: Date, settings: any, rowsByDate?: Map<string, any>, days?: number}} options
 */
export function buildDemoHistory({ now = new Date(), settings, rowsByDate = new Map(), days = 30 } = {}) {
  const span = Math.max(1, Math.min(366, Math.round(Number(days) || 30)));
  return buildDemoCheckinDays({ now, settings, rowsByDate, days: span }).map((day) => ({
    date: day.date,
    minutes: day.minutes,
    checkedIn: day.checkedIn,
    source: day.checkedIn ? day.source || 'auto' : null,
  }));
}

function demoCheckedSet(days) {
  return new Set(days.filter((day) => day.checkedIn).map((day) => day.date));
}

function buildDemoWeek(now) {
  const today = dateKey(now);
  const start = weekStartKey(today);
  const todayIndex = weekdayIndexFromKey(today);
  const days = [];
  let totalMinutes = 0;
  let activeDays = 0;
  for (let i = 0; i < 7; i += 1) {
    const key = addDaysKey(start, i);
    const isToday = key === today;
    const isFuture = key > today;
    let minutes = 0;
    if (isToday) minutes = DEMO_TODAY_MINUTES;
    else if (!isFuture) minutes = DEMO_WEEK_PATTERN[i] || 0;
    if (minutes > 0) activeDays += 1;
    totalMinutes += minutes;
    days.push({ date: key, weekday: weekdayNameFromKey(key), minutes, isToday, isFuture });
  }
  const elapsedDays = Math.min(7, todayIndex + 1);
  return {
    days,
    totalMinutes,
    activeDays,
    averageMinutes: elapsedDays > 0 ? Math.round(totalMinutes / elapsedDays) : 0,
  };
}

/**
 * 完整演示 overview。
 * @param {{
 *   now?: Date,
 *   settings: any,
 *   rowsByDate?: Map<string, any>,
 *   error?: string | null,
 *   notice?: string | null,
 * }} options
 */
export function buildDemoOverview({ now = new Date(), settings, rowsByDate = new Map(), error = null, notice = DEMO_NOTICE } = {}) {
  const todayKey = dateKey(now);
  const history = buildDemoHistory({ now, settings, rowsByDate });
  const demoDays = buildDemoCheckinDays({ now, settings, rowsByDate });
  const checkedSet = demoCheckedSet(demoDays);
  const todayDay = demoDays[demoDays.length - 1];
  const actualToday = rowsByDate.get(todayKey);
  const checkedIn = Boolean(todayDay?.checkedIn || actualToday?.checkedIn);
  const todayMinutes = Math.max(DEMO_TODAY_MINUTES, actualToday?.minutes || 0);
  const goalMinutes = settings?.goalMinutes || 45;
  const checkinMinutes = settings?.checkinMinutes || 30;
  const today = {
    date: todayKey,
    minutes: todayMinutes,
    seconds: todayMinutes * 60,
    goalMinutes,
    checkinMinutes,
    goalPercent: Math.min(100, Math.round((todayMinutes / goalMinutes) * 100)),
    checkinPercent: Math.min(100, Math.round((todayMinutes / checkinMinutes) * 100)),
    checkedIn,
    checkedInAt: checkedIn
      ? actualToday?.updatedAt || `${todayKey}T09:41:00+08:00`
      : null,
    checkedInSource: checkedIn ? actualToday?.source || 'auto' : null,
    streak: checkedIn ? computeStreak(checkedSet, todayKey) : 0,
    remainingToGoal: Math.max(0, goalMinutes - todayMinutes),
    remainingToCheckin: Math.max(0, checkinMinutes - todayMinutes),
  };

  const week = buildDemoWeek(now);
  const demoDomainMap = Object.fromEntries(
    Object.keys(DEMO_DOMAIN_MINUTES).map((id) => [
      id,
      { minutes: DEMO_DOMAIN_MINUTES[id], books: DEMO_DOMAIN_BOOKS[id] },
    ]),
  );
  const monthMinutes = Object.values(DEMO_DOMAIN_MINUTES).reduce((sum, value) => sum + value, 0);
  const domainItems = buildDomainStats(demoDomainMap, monthMinutes);
  const covered = domainItems.filter((item) => item.covered).length;
  const domains = {
    items: domainItems,
    covered,
    total: 8,
    score: Math.round((covered / 8) * 100),
    label: breadthLabel(covered),
    monthLabel: monthLabelOf(todayKey),
  };

  const annualMonths = buildDemoAnnualMonths(now);
  const yearMinutes = annualMonths.reduce((sum, item) => sum + item.minutes, 0);
  const currentMonth = Number(todayKey.slice(5, 7));
  const yearReadDays = Math.max(DEMO_MONTH_READ_DAYS, Math.round(yearMinutes / 30));
  const yearFinishedBooks = Math.max(DEMO_MONTH_FINISHED_BOOKS, Math.round(currentMonth * 1.7));

  return {
    source: 'demo',
    connected: false,
    error,
    updatedAt: isoShanghai(now),
    today,
    week,
    domains,
    books: buildDemoBooks(now),
    checkinHistory: history,
    stats: {
      // 保留原有月度字段
      readDays: DEMO_MONTH_READ_DAYS,
      totalMinutes: monthMinutes,
      finishedBooks: DEMO_MONTH_FINISHED_BOOKS,
      // 新统计页字段
      monthMinutes,
      monthStartedBooks: DEMO_MONTH_STARTED_BOOKS,
      monthFinishedBooks: DEMO_MONTH_FINISHED_BOOKS,
      monthReadDays: DEMO_MONTH_READ_DAYS,
      yearMinutes,
      yearStartedBooks: DEMO_YEAR_STARTED_BOOKS,
      yearFinishedBooks,
      yearReadDays,
      annualMonths,
    },
    notice,
  };
}

export { DEMO_DOMAIN_MINUTES, DEMO_DOMAIN_BOOKS };
