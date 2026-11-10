import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  addDaysKey,
  buildCsvText,
  dateKey,
  dateKeyToTimestampSec,
  dayOfYearFromKey,
  isoShanghai,
  maskSecret,
  normalizeTitle,
  normalizeUrl,
  readCsvSync,
  timestampSecToDateKey,
  truncateText,
  weekStartKey,
  weekdayNameFromKey,
  writeCsvAtomicSync,
} from '../util.mjs';
import {
  DOMAINS,
  breadthLabel,
  buildDomainStats,
  isDomainId,
  mapCategoryToDomain,
} from '../domains.mjs';

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readscope-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('日期工具固定使用 UTC+8，跨日正确', () => {
  assert.equal(dateKey(new Date('2026-10-29T02:30:00Z')), '2026-10-29');
  assert.equal(isoShanghai(new Date('2026-10-29T02:30:00Z')), '2026-10-29T10:30:00+08:00');
  assert.equal(dateKey(new Date('2026-10-29T17:00:00Z')), '2026-10-30');
  assert.equal(weekStartKey('2026-10-29'), '2026-10-26');
  assert.equal(weekdayNameFromKey('2026-10-29'), '四');
  assert.equal(addDaysKey('2026-10-31', 1), '2026-11-01');
  assert.equal(addDaysKey('2026-11-01', -1), '2026-10-31');
  assert.equal(dayOfYearFromKey('2026-10-29'), 302);
  assert.equal(timestampSecToDateKey(dateKeyToTimestampSec('2026-10-29')), '2026-10-29');
});

test('8 个固定领域与分类映射', () => {
  assert.equal(DOMAINS.length, 8);
  assert.deepEqual(
    DOMAINS.map((domain) => domain.id),
    ['literature', 'humanities', 'business', 'tech', 'psychology', 'arts', 'education', 'other'],
  );
  assert.equal(mapCategoryToDomain('文学小说'), 'literature');
  assert.equal(mapCategoryToDomain('历史'), 'humanities');
  assert.equal(mapCategoryToDomain('社会科学'), 'humanities');
  assert.equal(mapCategoryToDomain('经济'), 'business');
  assert.equal(mapCategoryToDomain('计算机'), 'tech');
  assert.equal(mapCategoryToDomain('医学'), 'tech');
  assert.equal(mapCategoryToDomain('心理'), 'psychology');
  assert.equal(mapCategoryToDomain('生活'), 'arts');
  assert.equal(mapCategoryToDomain('外语'), 'education');
  assert.equal(mapCategoryToDomain(''), 'other');
  assert.equal(mapCategoryToDomain('未知分类'), 'other');
  assert.equal(isDomainId('tech'), true);
  assert.equal(isDomainId('unknown'), false);
});

test('领域统计 percent 自洽且固定 8 项', () => {
  const items = buildDomainStats(
    { literature: { minutes: 60, books: 2 }, tech: { minutes: 30, books: 1 } },
    120,
  );
  assert.equal(items.length, 8);
  assert.equal(items[0].id, 'literature');
  assert.equal(items[0].percent, 50);
  assert.equal(items[0].covered, true);
  assert.equal(items[3].percent, 25);
  assert.equal(items[6].covered, false);
  assert.equal(items[6].percent, 0);
  assert.equal(breadthLabel(8), '博览群书');
  assert.equal(breadthLabel(6), '视野开阔');
  assert.equal(breadthLabel(1), '深耕一域');
});

test('URL / 标题归一化用于去重', () => {
  const a = normalizeUrl('https://Example.COM/abs/123?utm_source=x&scene=1&fbclid=abc&id=7#top');
  const b = normalizeUrl('https://example.com/abs/123?id=7');
  assert.equal(a, b);
  assert.equal(a.includes('utm_source'), false);
  assert.equal(a.includes('scene='), false);
  assert.equal(a.includes('fbclid'), false);
  assert.equal(normalizeUrl('not a url'), 'not a url');
  assert.equal(normalizeTitle('  RIS: A   Survey!  '), 'ris a survey');
  assert.equal(normalizeTitle('RIS，A Survey'), 'ris a survey');
  assert.equal(normalizeTitle('同 一 标 题：测试'), '同 一 标 题 测试');
});

test('文本与 Key 掩码', () => {
  assert.equal(maskSecret('wrk-abcdef123456'), 'wrk-abcd••••••••');
  assert.equal(maskSecret(''), null);
  assert.equal(maskSecret('short'), 'shor••••••••');
  const long = '这是一段很长的中文摘要'.repeat(20);
  const truncated = truncateText(long, 60);
  assert.equal(Array.from(truncated).length, 61);
  assert.equal(truncated.endsWith('…'), true);
  assert.equal(truncateText('短文本', 60), '短文本');
});

test('CSV 写入带 BOM、支持逗号/换行/引号并可读回', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'checkins.csv');
  const columns = ['date', 'minutes', 'checked_in', 'source', 'updated_at'];
  writeCsvAtomicSync(file, columns, [
    { date: '2026-10-28', minutes: '40', checked_in: 'true', source: 'auto', updated_at: '2026-10-28T10:00:00+08:00' },
    { date: '2026-10-29', minutes: '42', checked_in: 'false', source: '', updated_at: '2026-10-29T10:00:00+08:00' },
  ]);
  const raw = fs.readFileSync(file, 'utf8');
  assert.equal(raw.charCodeAt(0), 0xfeff);
  assert.equal(raw.includes('\uFEFFdate,minutes,checked_in,source,updated_at'), true);
  const rows = readCsvSync(file, columns);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].minutes, '40');
  assert.equal(rows[1].source, '');

  const richFile = path.join(dir, 'rich.csv');
  writeCsvAtomicSync(richFile, ['title', 'summary'], [
    { title: 'A, B', summary: '第一行\n第二行 "quoted"' },
  ]);
  const richRows = readCsvSync(richFile, ['title', 'summary']);
  assert.equal(richRows[0].title, 'A, B');
  assert.equal(richRows[0].summary, '第一行\n第二行 "quoted"');
  assert.match(buildCsvText(['a', 'b'], [{ a: '1,2', b: 'x\ny' }]), /"1,2"/);
});
