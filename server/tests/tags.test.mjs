import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createStore } from '../store.mjs';
import { createBooksService } from '../books.mjs';
import { deriveManualTags, deriveWereadTags, mergeBookTags, MAX_BOOK_TAGS } from '../tags.mjs';

const FIXED_NOW = () => new Date('2026-10-29T10:00:00+08:00');

function tempBooks(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readscope-tags-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createStore({ dataDir: dir, now: FIXED_NOW });
  const books = createBooksService({ store, now: FIXED_NOW });
  return { dir, store, books };
}

test('微信读书标签：分类 + 领域，中文、去重、最多 6 个', () => {
  assert.deepEqual(deriveWereadTags('文学-纪实文学', '文学'), ['文学', '纪实']);
  assert.deepEqual(deriveWereadTags('文学-小说', '文学'), ['文学', '小说']);
  assert.deepEqual(deriveWereadTags('文学-外国文学', '文学'), ['文学', '外国文学']);
  assert.deepEqual(deriveWereadTags('计算机', '科技'), ['科技', '计算机']);
  assert.deepEqual(deriveWereadTags('计算机-编程语言', '科技'), ['科技', '计算机', '编程语言']);
  assert.deepEqual(deriveWereadTags('历史', 'humanities'), ['人文社科', '历史']);
  assert.deepEqual(deriveWereadTags('', '其他'), ['其他']);
  assert.deepEqual(deriveWereadTags('', '科技'), ['科技']);
  assert.deepEqual(deriveWereadTags('文学-文学', '文学'), ['文学']);

  const many = deriveWereadTags('A-B-C-D-E-F-G-H', '科技');
  assert.equal(many.length, MAX_BOOK_TAGS);
  assert.deepEqual(many, ['科技', 'A', 'B', 'C', 'D', 'E']);
});

test('手动书自动标签：领域 + 标题/作者关键词', () => {
  assert.deepEqual(deriveManualTags({ title: '毫米波雷达感知', author: '张三', domain: 'tech' }), [
    '科技',
    '雷达',
    '感知',
  ]);
  assert.deepEqual(deriveManualTags({ title: '活着', author: '余华', domain: 'literature' }), ['文学']);
  assert.deepEqual(
    deriveManualTags({ title: '原则', author: '瑞·达利欧', domain: 'business', domainName: '商业财经' }),
    ['商业财经'],
  );
  const rich = deriveManualTags({
    title: '深度学习与计算机视觉',
    author: 'AI 作者',
    domain: 'tech',
    domainName: '科技',
  });
  assert.equal(rich.length <= MAX_BOOK_TAGS, true);
  assert.ok(rich.includes('AI'));
  assert.ok(rich.includes('三维重建') === false);
});

test('标签合并：自动标签在前，用户标签补齐，去重且最多 6 个', () => {
  assert.deepEqual(mergeBookTags(['科技', '雷达'], ['雷达', '精读']), ['科技', '雷达', '精读']);
  const merged = mergeBookTags(
    ['科技', '雷达', '感知', 'AI', '通信', '编程'],
    ['精读', '待读'],
  );
  assert.equal(merged.length, MAX_BOOK_TAGS);
  assert.deepEqual(merged, ['科技', '雷达', '感知', 'AI', '通信', '编程']);
  assert.deepEqual(mergeBookTags([], ['自读']), ['自读']);
});

test('手动书：创建时合并并持久化标签，接口不泄露内部 userTags', (t) => {
  const { dir, books } = tempBooks(t);
  const created = books.create({
    title: '毫米波雷达感知',
    author: '张三',
    totalPages: 320,
    currentPage: 48,
    domain: 'tech',
    tags: ['精读', '雷达'],
  });
  assert.deepEqual(created.item.tags, ['科技', '雷达', '感知', '精读']);
  assert.equal(Object.prototype.hasOwnProperty.call(created.item, 'userTags'), false);
  assert.equal(created.item.domainName, '科技');

  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'books.json'), 'utf8'));
  assert.deepEqual(onDisk.items[0].tags, ['科技', '雷达', '感知', '精读']);
  assert.deepEqual(onDisk.items[0].userTags, ['精读', '雷达']);

  // PATCH 替换用户标签，自动标签根据新字段重算
  const patched = books.patch(created.item.id, {
    title: '通信系统设计',
    domain: 'tech',
    tags: ['教材'],
  });
  assert.deepEqual(patched.item.tags, ['科技', '通信', '设计', '教材']);
  assert.equal(Object.prototype.hasOwnProperty.call(patched.item, 'userTags'), false);
  const afterPatch = JSON.parse(fs.readFileSync(path.join(dir, 'books.json'), 'utf8')).items[0];
  assert.deepEqual(afterPatch.tags, ['科技', '通信', '设计', '教材']);
  assert.deepEqual(afterPatch.userTags, ['教材']);
});

test('手动书：旧数据无 userTags 时读取也自动补齐标签，且不泄露内部字段', (t) => {
  const { dir, store } = tempBooks(t);
  fs.writeFileSync(
    path.join(dir, 'books.json'),
    JSON.stringify(
      {
        items: [
          {
            id: 'legacy-1',
            title: '人类简史',
            author: '尤瓦尔·赫拉利',
            totalPages: 440,
            currentPage: 200,
            domain: 'humanities',
            tags: ['历史', '自读'],
            addedAt: '2026-10-01T10:00:00+08:00',
            updatedAt: '2026-10-02T10:00:00+08:00',
            finishedAt: null,
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );
  const books = createBooksService({ store, now: FIXED_NOW });
  const listed = books.list().items[0];
  assert.deepEqual(listed.tags, ['人文社科', '历史', '自读']);
  assert.equal(Object.prototype.hasOwnProperty.call(listed, 'userTags'), false);
  assert.equal(listed.domainName, '人文社科');
  assert.equal(listed.progress, 45);
});
