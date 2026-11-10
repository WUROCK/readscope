import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createStore } from '../store.mjs';
import {
  buildCheckinHistory,
  computeStreak,
  createCheckinsService,
  normalizeCheckinRows,
} from '../checkins.mjs';

const FIXED_NOW = () => new Date('2026-10-29T10:00:00+08:00');

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readscope-checkin-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createStore({ dataDir: dir, now: FIXED_NOW });
  const checkins = createCheckinsService({ store, now: FIXED_NOW });
  return { dir, store, checkins };
}

test('CSV 行归一化：去重、布尔、非法行过滤', () => {
  const rows = normalizeCheckinRows([
    { date: '2026-10-28', minutes: '40', checked_in: 'true', source: 'auto', updated_at: 'x' },
    { date: '2026-10-28', minutes: '42', checked_in: '1', source: 'manual', updated_at: 'y' },
    { date: 'bad-date', minutes: '10', checked_in: 'true' },
    { date: '2026-10-29', minutes: '-5', checked_in: 'false', source: '' },
    { date: '2026-10-30', minutes: 'abc', checked_in: 'true', source: 'weird' },
  ]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].date, '2026-10-28');
  assert.equal(rows[0].minutes, 42);
  assert.equal(rows[0].checkedIn, true);
  assert.equal(rows[0].source, 'manual');
  assert.equal(rows[1].minutes, 0);
  assert.equal(rows[1].checkedIn, false);
  assert.equal(rows[2].source, 'auto'); // 非 auto/manual 但已打卡 -> auto
});

test('computeStreak：今天/昨天/断档', () => {
  const today = '2026-10-29';
  assert.equal(computeStreak(new Set(['2026-10-27', '2026-10-28', '2026-10-29']), today), 3);
  assert.equal(computeStreak(new Set(['2026-10-26', '2026-10-27', '2026-10-28']), today), 3);
  assert.equal(computeStreak(new Set(['2026-10-25', '2026-10-27', '2026-10-28']), today), 2);
  assert.equal(computeStreak(new Set(), today), 0);
  assert.equal(computeStreak(new Set(['2026-10-29']), today), 1);
});

test('自动打卡：未达阈值不写，达到阈值写 auto，manual 不被覆盖', (t) => {
  const { store, checkins } = setup(t);

  const below = checkins.ensureAuto(29, 30);
  assert.equal(below.changed, false);
  assert.equal(checkins.loadRows().length, 0);

  const at = checkins.ensureAuto(30, 30);
  assert.equal(at.changed, true);
  assert.equal(at.row.source, 'auto');
  assert.equal(at.row.checkedIn, true);
  const rows = checkins.loadRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, '2026-10-29');
  assert.equal(rows[0].minutes, 30);

  // 重复调用且分钟数不变不重复写
  assert.equal(checkins.ensureAuto(30, 30).changed, false);

  // 手动打卡优先
  checkins.upsert({ date: '2026-10-29', minutes: 55, checkedIn: true, source: 'manual' });
  const afterManual = checkins.ensureAuto(42, 30);
  assert.equal(afterManual.changed, false);
  assert.equal(afterManual.row.source, 'manual');
  assert.equal(afterManual.row.minutes, 55);

  const raw = fs.readFileSync(store.paths.checkins, 'utf8');
  assert.equal(raw.charCodeAt(0), 0xfeff);
  assert.match(raw, /date,minutes,checked_in,source,updated_at/);
});

test('月度回填：只回填本月过去日期且达阈值，不写今天/未来', (t) => {
  const { checkins } = setup(t);
  const minutesByDate = {
    '2026-09-30': 90, // 上月
    '2026-10-01': 45, // 过去，达标
    '2026-10-02': 10, // 过去，未达标
    '2026-10-28': 38, // 过去，达标
    '2026-10-29': 42, // 今天，不回填
    '2026-10-30': 60, // 未来
    '2026-11-01': 60, // 下月
  };
  const result = checkins.backfillPastDays({ minutesByDate, threshold: 30, todayKey: '2026-10-29' });
  assert.equal(result.changed, 2);
  assert.deepEqual(result.dates.sort(), ['2026-10-01', '2026-10-28']);
  const rows = checkins.loadRows();
  assert.deepEqual(rows.map((row) => row.date), ['2026-10-01', '2026-10-28']);
  assert.equal(rows.every((row) => row.source === 'auto' && row.checkedIn), true);

  // 已回填且分钟不变的日期不会重复写
  assert.equal(checkins.backfillPastDays({ minutesByDate, threshold: 30, todayKey: '2026-10-29' }).changed, 0);

  // manual 行不被回填覆盖
  checkins.upsert({ date: '2026-10-27', minutes: 20, checkedIn: true, source: 'manual' });
  checkins.backfillPastDays({ minutesByDate: { '2026-10-27': 50 }, threshold: 30, todayKey: '2026-10-29' });
  const manualRow = checkins.loadRows().find((row) => row.date === '2026-10-27');
  assert.equal(manualRow.source, 'manual');
  assert.equal(manualRow.minutes, 20);
});

test('打卡历史：最近 N 天升序、最后一天是今天、合并阅读分钟', (t) => {
  const { checkins } = setup(t);
  checkins.upsert({ date: '2026-10-27', minutes: 40, checkedIn: true, source: 'auto' });
  checkins.upsert({ date: '2026-10-29', minutes: 42, checkedIn: true, source: 'auto' });
  const history = checkins.history({
    days: 5,
    minutesByDate: { '2026-10-28': 25, '2026-10-29': 999 },
  });
  assert.equal(history.length, 5);
  assert.deepEqual(history.map((day) => day.date), [
    '2026-10-25',
    '2026-10-26',
    '2026-10-27',
    '2026-10-28',
    '2026-10-29',
  ]);
  assert.equal(history[2].checkedIn, true);
  assert.equal(history[2].minutes, 40);
  assert.equal(history[3].checkedIn, false);
  assert.equal(history[3].minutes, 25);
  assert.equal(history[4].checkedIn, true);
  assert.equal(history[4].minutes, 42); // 打卡行优先于月度分钟
  assert.equal(history[4].source, 'auto');

  // fallback（演示数据）注入
  const demo = buildCheckinHistory({
    days: 2,
    todayKey: '2026-10-29',
    rowsByDate: new Map(),
    fallbackByDate: new Map([['2026-10-29', { minutes: 42, checkedIn: true, source: 'auto' }]]),
  });
  assert.equal(demo[1].checkedIn, true);
  assert.equal(demo[1].minutes, 42);
});

test('30 天历史为升序且连续打卡天数可计算', (t) => {
  const { checkins } = setup(t);
  for (const day of ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29']) {
    checkins.upsert({ date: day, minutes: 40, checkedIn: true, source: 'auto' });
  }
  const history = checkins.history({ days: 30 });
  assert.equal(history.length, 30);
  assert.equal(history[29].date, '2026-10-29');
  assert.equal(history[0].date, '2026-09-30');
  assert.equal(checkins.streak(), 6);
});
