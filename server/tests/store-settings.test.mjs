import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createStore, DEFAULT_RESEARCH_TAGS } from '../store.mjs';
import { AppError } from '../util.mjs';

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readscope-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('settings：默认值、Key 掩码、明文落盘但永不回传', (t) => {
  const dir = tempDir(t);
  const store = createStore({ dataDir: dir, now: () => new Date('2026-10-29T10:00:00+08:00') });

  const defaults = store.getPublicSettings();
  assert.equal(defaults.wereadConfigured, false);
  assert.equal(defaults.wereadKeyMasked, null);
  assert.equal(defaults.goalMinutes, 45);
  assert.equal(defaults.checkinMinutes, 30);
  assert.equal(defaults.recommendationSource, 'paper');
  assert.deepEqual(defaults.researchTags, [...DEFAULT_RESEARCH_TAGS]);
  assert.equal(defaults.dataDir, dir);
  assert.equal(defaults.recommendationsCsv, path.join(dir, 'recommendations.csv'));

  store.updateSettings({ wereadApiKey: '  wrk-abcdef123456  ', goalMinutes: 60, checkinMinutes: 20 });
  const masked = store.getPublicSettings();
  assert.equal(masked.wereadConfigured, true);
  assert.equal(masked.wereadKeyMasked, 'wrk-abcd••••••••');
  assert.equal(JSON.stringify(masked).includes('abcdef123456'), false);
  assert.equal(masked.goalMinutes, 60);

  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  assert.equal(onDisk.wereadApiKey, 'wrk-abcdef123456');

  // 空字符串 = 清除 Key
  store.updateSettings({ wereadApiKey: '' });
  assert.equal(store.getPublicSettings().wereadConfigured, false);
  assert.equal(store.getPublicSettings().wereadKeyMasked, null);
});

test('settings：边界校验与标签去重', (t) => {
  const dir = tempDir(t);
  const store = createStore({ dataDir: dir });

  for (const bad of [{ goalMinutes: 14 }, { goalMinutes: 241 }, { goalMinutes: 45.5 }, { checkinMinutes: 4 }, { checkinMinutes: 241 }]) {
    assert.throws(() => store.updateSettings(bad), (error) => error instanceof AppError && error.status === 400);
  }
  assert.throws(
    () => store.updateSettings({ researchTags: [] }),
    (error) => error.status === 400 && error.message.includes('至少保留'),
  );
  assert.throws(
    () => store.updateSettings({ researchTags: Array.from({ length: 13 }, (_, i) => `tag${i}`) }),
    (error) => error.status === 400 && error.message.includes('最多 12'),
  );
  assert.throws(
    () => store.updateSettings({ recommendationSource: 'twitter' }),
    (error) => error.status === 400,
  );

  store.updateSettings({ researchTags: [' RIS ', 'ris', 'ISAC', '', 'RIS'] });
  assert.deepEqual(store.getPublicSettings().researchTags, ['RIS', 'ISAC']);
  assert.throws(() => store.updateSettings(null), (error) => error.status === 400);
});

test('损坏的 settings.json 自动备份并回退默认值', (t) => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, 'settings.json'), '{ not json', 'utf8');
  const store = createStore({ dataDir: dir });
  assert.equal(store.getPublicSettings().goalMinutes, 45);
  const backups = fs.readdirSync(dir).filter((name) => name.startsWith('settings.json.corrupt-'));
  assert.equal(backups.length, 1);
});

test('books.json 损坏时备份并从空列表开始', (t) => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, 'books.json'), '{{{', 'utf8');
  const store = createStore({ dataDir: dir });
  assert.deepEqual(store.readBooks().items, []);
  const backups = fs.readdirSync(dir).filter((name) => name.startsWith('books.json.corrupt-'));
  assert.equal(backups.length, 1);
});

test('缓存读写与刷新语义', (t) => {
  const dir = tempDir(t);
  const store = createStore({ dataDir: dir });
  store.cacheSetSync('shelf-test', { books: 1 });
  assert.deepEqual(store.cacheGetSync('shelf-test', 60_000), { books: 1 });
  assert.equal(store.cacheGetSync('shelf-test', 60_000, { refresh: true }), null);
  assert.deepEqual(store.cacheGetSync('shelf-test', Infinity), { books: 1 });
  assert.equal(store.cacheGetSync('missing', 60_000), null);
  assert.equal(fs.existsSync(path.join(dir, 'cache', 'weread-shelf-test.json')), true);
  assert.deepEqual(store.readSeedCurated(), {
    items: [],
    error: '精选文献库为空，请先导入 data/seed/curated_papers.json',
  });
});

test('reading order persists across a fresh store and unrelated settings edits', t => {
  const dir = tempDir(t), store = createStore({ dataDir: dir });
  assert.deepEqual(store.getPublicSettings().readingOrder, []);
  store.updateSettings({ readingOrder: ['wr-2', 'manual-1', 'wr-2'] });
  store.updateSettings({ goalMinutes: 60 });
  const restarted = createStore({ dataDir: dir });
  assert.deepEqual(restarted.getPublicSettings().readingOrder, ['wr-2', 'manual-1']);
  const publicCopy = restarted.getPublicSettings(); publicCopy.readingOrder.push('mutated');
  const privateCopy = restarted.getSettings(); privateCopy.readingOrder.reverse();
  assert.deepEqual(restarted.getPublicSettings().readingOrder, ['wr-2', 'manual-1']);
  restarted.updateSettings({ readingOrder: [] });
  assert.deepEqual(createStore({ dataDir: dir }).getPublicSettings().readingOrder, []);
});
test('reading order rejects invalid input without changing saved preferences', t => {
  const store = createStore({ dataDir: tempDir(t) });
  store.updateSettings({ readingOrder: ['first'] });
  for (const readingOrder of [null, 'first', [null], [1], [''], ['x'.repeat(257)], Array(2001).fill('id')]) {
    assert.throws(() => store.updateSettings({ readingOrder }), error => error.status === 400);
    assert.deepEqual(store.getPublicSettings().readingOrder, ['first']);
  }
});
test('legacy settings get a safe empty reading order, malformed entries are discarded', t => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ readingOrder: [null, 'a', 'a', 2, 'b'] }));
  assert.deepEqual(createStore({ dataDir: dir }).getPublicSettings().readingOrder, ['a', 'b']);
});
