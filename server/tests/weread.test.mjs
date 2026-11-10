import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createApp } from '../app.mjs';
import { createStore } from '../store.mjs';
import {
  buildAnnualStats,
  buildWereadOverview,
  countShelfEntries,
  createWereadClient,
  mapWereadBook,
  readTimesToMonthlySeconds,
  shortWereadError,
  WereadError,
} from '../weread.mjs';
import { dateKeyToTimestampSec } from '../util.mjs';

const FIXED_NOW = () => new Date('2026-10-29T10:00:00+08:00');
const KEY = 'wrk-test-123456';

function ts(iso) {
  return Math.floor(Date.parse(iso) / 1000);
}

function makeFixture() {
  const book = (bookId, title, author, category, readUpdateTime, finishReading = 0) => ({
    bookId,
    title,
    author,
    category,
    cover: `https://example.com/${bookId}.jpg`,
    readUpdateTime,
    finishReading,
    readerLink: `https://weread.qq.com/web/reader/${bookId}`,
  });
  const shelf = {
    books: [
      book('b1', '活着', '余华', '文学', ts('2026-10-29T08:00:00+08:00'), 1),
      book('b2', '人类简史', '尤瓦尔·赫拉利', '历史', ts('2026-10-28T22:00:00+08:00')),
      book('b3', '原则', '瑞·达利欧', '经济', ts('2026-10-28T07:00:00+08:00')),
      book('b4', '深度学习', '伊恩·古德费洛', '计算机', ts('2026-10-27T21:00:00+08:00')),
      book('b5', '被讨厌的勇气', '岸见一郎', '心理', ts('2026-10-26T20:00:00+08:00')),
      book('b6', '山茶文具店', '小川糸', '生活', ts('2026-10-25T19:00:00+08:00')),
      book('b7', '三体', '刘慈欣', '小说', ts('2026-10-24T18:00:00+08:00')),
      book('b8', '经济学原理', '曼昆', '经济', ts('2026-10-23T17:00:00+08:00')),
    ],
    albums: [{ albumInfo: { albumId: 'a1', name: '某专辑' } }],
    mp: { name: '文章收藏' },
    bookCount: 8,
  };
  const progress = {
    b1: { book: { progress: 100, recordReadingTime: 7200, updateTime: ts('2026-10-29T08:00:00+08:00'), finishTime: ts('2026-10-29T08:00:00+08:00') } },
    b2: { book: { progress: 64, recordReadingTime: 3600, updateTime: ts('2026-10-28T22:00:00+08:00') } },
    b3: { book: { progress: 38, recordReadingTime: 1800, updateTime: ts('2026-10-28T07:00:00+08:00') } },
    b4: { book: { progress: 27, recordReadingTime: 900, updateTime: ts('2026-10-27T21:00:00+08:00') } },
    b5: { book: { progress: 72, recordReadingTime: 1200, updateTime: ts('2026-10-26T20:00:00+08:00') } },
    b6: { book: { progress: 45, recordReadingTime: 600, updateTime: ts('2026-10-25T19:00:00+08:00') } },
  };
  const day = (date, seconds) => [dateKeyToTimestampSec(date), seconds];
  const weekly = {
    totalReadTime: (38 + 52 + 45 + 42) * 60,
    readTimes: Object.fromEntries([
      day('2026-10-26', 38 * 60),
      day('2026-10-27', 52 * 60),
      day('2026-10-28', 45 * 60),
      day('2026-10-29', 42 * 60),
    ]),
  };
  const monthly = {
    totalReadTime: (600 + 448) * 60,
    readDays: 22,
    readTimes: Object.fromEntries([
      day('2026-10-01', 45 * 60),
      day('2026-10-02', 10 * 60),
      day('2026-10-26', 38 * 60),
      day('2026-10-27', 52 * 60),
      day('2026-10-28', 45 * 60),
      day('2026-10-29', 42 * 60),
    ]),
    preferCategory: [
      { categoryTitle: '文学', readingTime: 600 * 60, readingCount: 2 },
      { categoryTitle: '计算机', readingTime: 448 * 60, readingCount: 1 },
    ],
    readStat: [
      { stat: '读过', counts: '3本' },
      { stat: '读完', counts: '2本' },
    ],
  };
  const annual = {
    totalReadTime: 172102,
    readDays: 75,
    readTimes: Object.fromEntries(
      [600, 1200, 1800, 2400, 3000, 3600, 4200, 4800, 5400, 6000, 6600, 7200].map((seconds, index) => [
        dateKeyToTimestampSec(`2026-${String(index + 1).padStart(2, '0')}-01`),
        seconds,
      ]),
    ),
    readStat: [
      { stat: '读过', counts: '14本' },
      { stat: '读完', counts: '6本' },
      { stat: '阅读', counts: '75天' },
      { stat: '笔记', counts: '6条' },
    ],
  };
  return { shelf, progress, weekly, monthly, annual };
}

function makeMockFetch(fixture, { delayMs = 8 } = {}) {
  const calls = [];
  let inFlightProgress = 0;
  let maxInFlightProgress = 0;
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body, headers: options.headers });
    if (body.api_name === '/shelf/sync') return jsonResponse(fixture.shelf);
    if (body.api_name === '/readdata/detail') {
      if (body.mode === 'weekly') return jsonResponse(fixture.weekly);
      if (body.mode === 'monthly') return jsonResponse(fixture.monthly);
      if (body.mode === 'annually') return jsonResponse(fixture.annual);
      throw new Error(`unexpected readdata mode ${body.mode}`);
    }
    if (body.api_name === '/book/getprogress') {
      inFlightProgress += 1;
      maxInFlightProgress = Math.max(maxInFlightProgress, inFlightProgress);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      inFlightProgress -= 1;
      return jsonResponse(fixture.progress[body.bookId] || { book: { progress: 0, recordReadingTime: 0 } });
    }
    throw new Error(`unexpected api_name ${body.api_name}`);
  };
  return {
    fetchImpl,
    calls,
    get maxInFlightProgress() {
      return maxInFlightProgress;
    },
  };
}

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

function tempStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readscope-weread-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, store: createStore({ dataDir: dir, now: FIXED_NOW }) };
}

test('WeRead 网关请求格式与书架计数', async (t) => {
  const fixture = makeFixture();
  const mock = makeMockFetch(fixture);
  const { store } = tempStore(t);
  const client = createWereadClient({ store, fetchImpl: mock.fetchImpl, now: FIXED_NOW });
  const result = await client.testConnection(KEY);
  assert.equal(result.bookCount, 10); // 8 本书 + 1 专辑 + 1 文章收藏
  assert.equal(countShelfEntries(fixture.shelf), 10);
  const call = mock.calls[0];
  assert.equal(call.url, 'https://i.weread.qq.com/api/agent/gateway');
  assert.equal(call.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(call.body.api_name, '/shelf/sync');
  assert.equal(call.body.skill_version, '1.0.5');
});

test('loadData 归一化：Top6 并行进度、分钟换算、领域映射', async (t) => {
  const fixture = makeFixture();
  const mock = makeMockFetch(fixture);
  const { store } = tempStore(t);
  const client = createWereadClient({ store, fetchImpl: mock.fetchImpl, now: FIXED_NOW });

  const data = await client.loadData(KEY, { refresh: true });
  assert.equal(data.books.length, 6);
  assert.ok(mock.calls.some((call) => call.body.api_name === '/readdata/detail' && call.body.mode === 'weekly'));
  assert.ok(mock.calls.some((call) => call.body.api_name === '/readdata/detail' && call.body.mode === 'monthly'));
  assert.ok(mock.calls.some((call) => call.body.api_name === '/readdata/detail' && call.body.mode === 'annually'));
  assert.equal(mock.calls.filter((call) => call.body.api_name === '/book/getprogress').length, 6);
  assert.ok(mock.maxInFlightProgress <= 3);
  assert.ok(mock.maxInFlightProgress >= 2);

  const first = data.books[0];
  assert.equal(first.id, 'wr:b1');
  assert.equal(first.title, '活着');
  assert.equal(first.progress, 100);
  assert.equal(first.readingMinutes, 120);
  assert.equal(first.domain, 'literature');
  assert.equal(first.domainName, '文学');
  assert.deepEqual(first.tags, ['文学']);
  assert.equal(first.finished, true);
  assert.match(first.lastReadAt, /^2026-10-29T08:00:00\+08:00$/);

  const tech = data.books.find((book) => book.bookId === 'b4');
  assert.equal(tech.domain, 'tech');
  assert.equal(tech.readingMinutes, 15);
  assert.deepEqual(tech.tags, ['科技', '计算机']);
  // 7、8 名不在 Top6 内，不请求进度
  assert.equal(data.books.some((book) => book.bookId === 'b7'), false);
  assert.equal(data.weeklySecondsByDate['2026-10-29'], 42 * 60);
  assert.equal(data.monthlySecondsByDate['2026-10-01'], 45 * 60);
  assert.equal(data.annualSecondsByMonth.length, 12);
  assert.equal(data.annualSecondsByMonth[0], 600);
  assert.equal(data.annualSecondsByMonth[11], 7200);
  assert.equal(data.annual.readDays, 75);
});

test('网关限流与版本升级提示转为可读错误', async (t) => {
  const rate = tempStore(t);
  const rateClient = createWereadClient({
    store: rate.store,
    fetchImpl: async () => jsonResponse({ errcode: 429, errmsg: 'too many requests' }, 429),
    now: FIXED_NOW,
  });
  await assert.rejects(
    () => rateClient.testConnection(KEY),
    (error) => error instanceof WereadError && error.code === 'RATE_LIMIT' && /频繁/.test(error.message),
  );

  const upgrade = tempStore(t);
  const upgradeClient = createWereadClient({
    store: upgrade.store,
    fetchImpl: async () => jsonResponse({ upgrade_info: { message: '请升级到 1.1.0' }, books: [] }),
    now: FIXED_NOW,
  });
  await assert.rejects(
    () => upgradeClient.testConnection(KEY),
    (error) => error instanceof WereadError && error.code === 'UPGRADE' && /升级/.test(error.message),
  );
});

test('overview 缓存、refresh 绕过与客户端错误分类', async (t) => {
  const fixture = makeFixture();
  const mock = makeMockFetch(fixture);
  const { store } = tempStore(t);
  const client = createWereadClient({ store, fetchImpl: mock.fetchImpl, now: FIXED_NOW });

  await client.loadData(KEY, { refresh: true });
  const callsAfterFirst = mock.calls.length;
  await client.loadData(KEY);
  assert.equal(mock.calls.length, callsAfterFirst); // 90s overview 缓存命中

  await client.loadData(KEY, { refresh: true });
  assert.ok(mock.calls.length > callsAfterFirst);

  // 401 -> AUTH
  const authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'readscope-auth-'));
  t.after(() => fs.rmSync(authDir, { recursive: true, force: true }));
  const authClient = createWereadClient({
    store: createStore({ dataDir: authDir, now: FIXED_NOW }),
    fetchImpl: async () => jsonResponse({ errcode: 401 }, 401),
    now: FIXED_NOW,
  });
  await assert.rejects(
    () => authClient.testConnection(KEY),
    (error) => error instanceof WereadError && error.code === 'AUTH',
  );
  assert.equal(shortWereadError(new WereadError('API Key 无效或已过期', 'AUTH')), 'API Key 无效或已过期');
});

test('年度统计：按 Asia/Shanghai 解析月桶并读取真实回包字段', () => {
  const months = readTimesToMonthlySeconds({
    1767196800: 600, // 2026-01-01
    1769875200: 1200, // 2026-02-01
  });
  assert.equal(months.length, 12);
  assert.equal(months[0], 600);
  assert.equal(months[1], 1200);
  assert.equal(months[11], 0);

  const annual = buildAnnualStats({
    annual: {
      totalReadTime: 172102,
      readDays: 75,
      readTimes: { 1767196800: 600 },
      readStat: [
        { stat: '读过', counts: '14本' },
        { stat: '读完', counts: '6本' },
        { stat: '阅读', counts: '75天' },
        { stat: '笔记', counts: '6条' },
      ],
    },
    annualSecondsByMonth: months,
  });
  assert.equal(annual.yearMinutes, 2868); // 172102 秒 ≈ 2868 分钟
  assert.equal(annual.yearReadDays, 75);
  assert.equal(annual.yearStartedBooks, 14);
  assert.equal(annual.yearFinishedBooks, 6);
  assert.equal(annual.annualMonths.length, 12);
  assert.deepEqual(annual.annualMonths[0], { month: 1, minutes: 10 });
  assert.deepEqual(annual.annualMonths[1], { month: 2, minutes: 20 });
});

test('年度接口失败时年度字段降级为 0，月度统计仍可用', async (t) => {
  const fixture = makeFixture();
  const mock = makeMockFetch(fixture);
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    if (body.api_name === '/readdata/detail' && body.mode === 'annually') {
      return jsonResponse({ errcode: 500 }, 500);
    }
    return mock.fetchImpl(url, options);
  };
  const { store } = tempStore(t);
  const client = createWereadClient({ store, fetchImpl, now: FIXED_NOW });
  const data = await client.loadData(KEY, { refresh: true });
  assert.equal(data.annual, null);
  const overview = buildWereadOverview({
    data,
    settings: { goalMinutes: 45, checkinMinutes: 30 },
    now: FIXED_NOW(),
    todayRow: null,
    checkinHistory: [],
    streak: 0,
  });
  assert.equal(overview.stats.monthMinutes, 1048);
  assert.equal(overview.stats.monthStartedBooks, 3);
  assert.equal(overview.stats.monthFinishedBooks, 2);
  assert.equal(overview.stats.yearMinutes, 0);
  assert.equal(overview.stats.yearStartedBooks, 0);
  assert.equal(overview.stats.yearFinishedBooks, 0);
  assert.equal(overview.stats.yearReadDays, 0);
  assert.equal(overview.stats.annualMonths.length, 12);
  assert.equal(overview.stats.annualMonths.every((item) => item.minutes === 0), true);
});

test('buildWereadOverview：今日/本周/领域/统计', async (t) => {
  const fixture = makeFixture();
  const mock = makeMockFetch(fixture);
  const { store } = tempStore(t);
  const client = createWereadClient({ store, fetchImpl: mock.fetchImpl, now: FIXED_NOW });
  const data = await client.loadData(KEY, { refresh: true });
  const overview = buildWereadOverview({
    data,
    settings: { goalMinutes: 45, checkinMinutes: 30 },
    now: FIXED_NOW(),
    todayRow: { checkedIn: true, source: 'auto', updatedAt: '2026-10-29T09:41:00+08:00' },
    checkinHistory: [],
    streak: 6,
  });
  assert.equal(overview.today.date, '2026-10-29');
  assert.equal(overview.today.minutes, 42);
  assert.equal(overview.today.seconds, 2520);
  assert.equal(overview.today.goalPercent, 93);
  assert.equal(overview.today.checkedIn, true);
  assert.equal(overview.today.checkedInSource, 'auto');
  assert.equal(overview.today.streak, 6);
  assert.equal(overview.week.days.length, 7);
  assert.equal(overview.week.totalMinutes, 177);
  assert.equal(overview.week.activeDays, 4);
  assert.equal(overview.week.averageMinutes, 44);
  assert.equal(overview.week.days[6].isFuture, true);
  assert.equal(overview.domains.items.length, 8);
  assert.equal(overview.domains.covered, 2);
  assert.equal(overview.domains.score, 25);
  assert.equal(overview.domains.monthLabel, '2026年10月');
  assert.equal(overview.domains.items[0].minutes, 600);
  assert.equal(overview.stats.totalMinutes, 1048);
  assert.equal(overview.stats.readDays, 22);
  assert.equal(overview.stats.finishedBooks, 2);
  assert.equal(overview.stats.monthMinutes, 1048);
  assert.equal(overview.stats.monthStartedBooks, 3);
  assert.equal(overview.stats.monthFinishedBooks, 2);
  assert.equal(overview.stats.monthReadDays, 22);
  assert.equal(overview.stats.yearMinutes, 2868);
  assert.equal(overview.stats.yearStartedBooks, 14);
  assert.equal(overview.stats.yearFinishedBooks, 6);
  assert.equal(overview.stats.yearReadDays, 75);
  assert.equal(overview.stats.annualMonths.length, 12);
  assert.deepEqual(overview.stats.annualMonths[0], { month: 1, minutes: 10 });
  assert.deepEqual(overview.stats.annualMonths[9], { month: 10, minutes: 100 });
  assert.deepEqual(overview.stats.annualMonths[11], { month: 12, minutes: 120 });
  assert.equal(overview.books.length, 6);
  assert.equal(overview.source, 'weread');
  assert.equal(overview.connected, true);
});

test('单本书映射容忍缺失进度', () => {
  const mapped = mapWereadBook(
    {
      bookId: 'x1',
      title: '未知进度书',
      author: '',
      category: '医学',
      readUpdateTime: ts('2026-10-20T10:00:00+08:00'),
      finishReading: 1,
    },
    null,
  );
  assert.equal(mapped.progress, 100);
  assert.equal(mapped.finished, true);
  assert.equal(mapped.domain, 'tech');
  assert.equal(mapped.author, '未知作者');
  assert.equal(mapped.readingMinutes, 0);
  assert.equal(mapped.readerLink, null);

  // 真实网关把累计时长放在 readingTime，recordReadingTime 为 0。
  const liveShape = mapWereadBook(
    { bookId: 'x2', title: '真实回包', author: '作者', category: '文学' },
    { book: { progress: 1, readingTime: 502, recordReadingTime: 0 } },
  );
  assert.equal(liveShape.readingMinutes, 8);
  assert.equal(liveShape.progress, 1);
});

test('overview 服务：自动打卡 + 本月回填 + 缓存降级/演示降级', async (t) => {
  const fixture = makeFixture();
  const mock = makeMockFetch(fixture);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readscope-overview-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const app = createApp({ dataDir: dir, fetchImpl: mock.fetchImpl, now: FIXED_NOW });
  app.store.updateSettings({ wereadApiKey: KEY });

  const overview = await app.services.overview.getOverview();
  assert.equal(overview.source, 'weread');
  assert.equal(overview.today.minutes, 42);
  assert.equal(overview.today.checkedIn, true);
  assert.equal(overview.today.checkedInSource, 'auto');
  assert.equal(overview.today.streak, 4); // 10-26 ~ 10-29
  const rows = app.services.checkins.loadRows();
  assert.deepEqual(rows.map((row) => row.date), ['2026-10-01', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29']);
  assert.equal(app.services.checkins.loadRows().every((row) => row.source === 'auto'), true);

  // 失败但存在缓存 -> 继续展示 weread 缓存数据，并带 warning
  const failingFetch = async () => {
    throw new TypeError('network down');
  };
  const app2 = createApp({ dataDir: dir, fetchImpl: failingFetch, now: FIXED_NOW });
  app2.store.updateSettings({ wereadApiKey: KEY });
  const cached = await app2.services.overview.getOverview({ refresh: true });
  assert.equal(cached.source, 'weread');
  assert.equal(cached.error, '无法连接微信读书服务');
  assert.match(cached.notice, /上次同步/);

  // 无缓存 -> demo 降级
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'readscope-overview-empty-'));
  t.after(() => fs.rmSync(emptyDir, { recursive: true, force: true }));
  const app3 = createApp({ dataDir: emptyDir, fetchImpl: failingFetch, now: FIXED_NOW });
  app3.store.updateSettings({ wereadApiKey: KEY });
  const demo = await app3.services.overview.getOverview();
  assert.equal(demo.source, 'demo');
  assert.equal(demo.connected, false);
  assert.equal(demo.error, '无法连接微信读书服务');
  assert.match(demo.notice, /演示数据/);
  assert.equal(demo.today.minutes, 42);
  assert.equal(demo.stats.monthMinutes, 1048);
  assert.equal(demo.stats.monthStartedBooks, 5);
  assert.equal(demo.stats.monthFinishedBooks, 2);
  assert.equal(demo.stats.monthReadDays, 22);
  assert.ok(demo.stats.yearMinutes > demo.stats.monthMinutes);
  assert.ok(demo.stats.yearStartedBooks >= 5);
  assert.ok(demo.stats.yearFinishedBooks >= 2);
  assert.ok(demo.stats.yearReadDays >= 22);
  assert.equal(demo.stats.annualMonths.length, 12);
  assert.equal(demo.stats.annualMonths[9].minutes, 1048); // 2026-10
  assert.equal(demo.stats.annualMonths[10].minutes, 0); // 未来月份
  assert.ok(demo.books.every((book) => Array.isArray(book.tags) && book.tags.length > 0));
  assert.ok(demo.books[0].tags.includes('文学'));
});
