import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createStore } from '../store.mjs';
import { createBooksService } from '../books.mjs';
import { createPapersService } from '../papers.mjs';
import { AppError } from '../util.mjs';

const FIXED_NOW = () => new Date('2026-10-29T10:00:00+08:00');

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readscope-docs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createStore({ dataDir: dir, now: FIXED_NOW });
  return {
    dir,
    store,
    books: createBooksService({ store, now: FIXED_NOW }),
    papers: createPapersService({ store, now: FIXED_NOW }),
  };
}

test('手动书：按页数计算进度、读完与剩余时间估算', (t) => {
  const { books } = setup(t);
  const created = books.create({
    title: '毫米波雷达感知',
    author: '张三',
    totalPages: 320,
    currentPage: 48,
    domain: 'tech',
    tags: ['雷达', '感知'],
  });
  assert.equal(created.item.progress, 15);
  assert.equal(created.item.finished, false);
  assert.equal(created.item.domain, 'tech');
  assert.equal(created.item.domainName, '科技');
  assert.equal(created.item.estimatedMinutesRemaining, 454); // ceil(272/0.6)
  assert.equal(created.item.finishedAt, null);

  const half = books.patch(created.item.id, { currentPage: 160 });
  assert.equal(half.item.progress, 50);
  assert.equal(half.item.finished, false);

  const done = books.patch(created.item.id, { currentPage: 320 });
  assert.equal(done.item.progress, 100);
  assert.equal(done.item.finished, true);
  assert.equal(done.item.estimatedMinutesRemaining, 0);
  assert.ok(done.item.finishedAt);

  const back = books.patch(created.item.id, { currentPage: 100 });
  assert.equal(back.item.finished, false);
  assert.equal(back.item.finishedAt, null);
  assert.equal(back.item.estimatedMinutesRemaining, 367);

  const list = books.list();
  assert.equal(list.items.length, 1);
  assert.equal(list.stats.reading, 1);
  assert.equal(list.stats.finished, 0);
  assert.equal(list.stats.totalPagesRead, 100);
});

test('手动书：新增/删除/统计与排序', (t) => {
  const { books } = setup(t);
  const a = books.create({ title: '书 A', totalPages: 100, currentPage: 100, domain: 'literature' });
  assert.equal(a.item.finished, true);
  const b = books.create({ title: '书 B', totalPages: 200, domain: 'psychology' });
  assert.equal(b.item.currentPage, 0);
  assert.equal(b.item.progress, 0);
  const list = books.list();
  assert.equal(list.items.length, 2);
  assert.equal(list.stats.finished, 1);
  assert.equal(list.stats.reading, 1);
  assert.equal(list.stats.totalPagesRead, 100);
  assert.deepEqual(list.items.map((item) => item.title).sort(), ['书 A', '书 B']);
  assert.equal(books.remove(a.item.id).ok, true);
  assert.equal(books.list().items.length, 1);
  assert.throws(() => books.remove('missing'), (error) => error instanceof AppError && error.status === 404);
});

test('手动书：校验错误均为 400', (t) => {
  const { books } = setup(t);
  const cases = [
    {},
    { title: '', totalPages: 10 },
    { title: 'x', totalPages: 0 },
    { title: 'x', totalPages: -3 },
    { title: 'x', totalPages: 10, currentPage: 11 },
    { title: 'x', totalPages: 10, domain: 'cooking' },
    { title: 'x', totalPages: 10, tags: 'not-array' },
  ];
  for (const body of cases) {
    assert.throws(
      () => books.create(body),
      (error) => error instanceof AppError && error.status === 400,
    );
  }
  const created = books.create({ title: '合法书', totalPages: 10 });
  assert.throws(
    () => books.patch(created.item.id, { currentPage: 11 }),
    (error) => error.status === 400,
  );
  assert.throws(
    () => books.patch(created.item.id, { domain: 'bad' }),
    (error) => error.status === 400,
  );
});

test('文献：状态流转、页数进度与统计', (t) => {
  const { papers } = setup(t);
  const created = papers.create({
    title: 'RIS-Aided ISAC',
    venue: 'IEEE TWC',
    year: 2025,
    url: 'https://example.com/paper',
    tags: ['RIS', 'ISAC'],
    totalPages: 14,
    currentPage: 0,
  });
  assert.equal(created.item.status, 'todo');
  assert.equal(created.item.progress, 0);
  assert.equal(created.item.finishedAt, null);

  const reading = papers.patch(created.item.id, { currentPage: 6, status: 'reading' });
  assert.equal(reading.item.status, 'reading');
  assert.equal(reading.item.progress, 43);

  const done = papers.patch(created.item.id, { status: 'done' });
  assert.equal(done.item.status, 'done');
  assert.equal(done.item.currentPage, 14);
  assert.equal(done.item.progress, 100);
  assert.ok(done.item.finishedAt);

  const reopened = papers.patch(created.item.id, { status: 'reading' });
  assert.equal(reopened.item.status, 'reading');
  assert.equal(reopened.item.finishedAt, null);

  const second = papers.create({ title: '另一篇', status: 'todo', tags: ['RIS'] });
  assert.equal(second.item.totalPages, 0);
  assert.equal(second.item.progress, 0);

  const list = papers.list();
  assert.equal(list.items[0].title, 'RIS-Aided ISAC'); // reading 状态优先
  assert.equal(list.items.length, 2);
  assert.deepEqual(list.stats, { todo: 1, reading: 1, done: 0, total: 2 });
  assert.deepEqual(list.tagCounts, [
    { tag: 'RIS', count: 2 },
    { tag: 'ISAC', count: 1 },
  ]);
  const readOnly = list.items.find((item) => item.status === 'reading');
  assert.equal(readOnly.title, 'RIS-Aided ISAC');
});

test('文献：状态排序 reading -> todo -> done，各按更新时间倒序', (t) => {
  const { papers } = setup(t);
  const done = papers.create({ title: 'done', status: 'done', totalPages: 10 });
  const todo = papers.create({ title: 'todo', status: 'todo' });
  const reading = papers.create({ title: 'reading', status: 'reading', totalPages: 10, currentPage: 2 });
  // 更新 done 让它的 updatedAt 最新
  papers.patch(done.item.id, { summary: 'updated' });
  const order = papers.list().items.map((item) => item.title);
  assert.deepEqual(order, ['reading', 'todo', 'done']);
  assert.equal(reading.item.id, papers.list().items[0].id);
});

test('文献：校验、删除与 done 状态强制满页', (t) => {
  const { papers } = setup(t);
  const cases = [
    {},
    { title: '' },
    { title: 'x', status: 'archived' },
    { title: 'x', year: '2025' },
    { title: 'x', totalPages: -1 },
    { title: 'x', totalPages: 10, currentPage: 11 },
    { title: 'x', tags: 'bad' },
  ];
  for (const body of cases) {
    assert.throws(
      () => papers.create(body),
      (error) => error instanceof AppError && error.status === 400,
    );
  }
  const paper = papers.create({ title: 'done 文献', status: 'done', totalPages: 0 });
  assert.equal(paper.item.progress, 100);
  assert.equal(paper.item.currentPage, 0);
  assert.ok(paper.item.finishedAt);

  // done 状态下增大总页数，会保持满页已读
  const expanded = papers.patch(paper.item.id, { totalPages: 20 });
  assert.equal(expanded.item.currentPage, 20);
  assert.equal(expanded.item.progress, 100);
  assert.ok(expanded.item.finishedAt);

  assert.throws(() => papers.remove('missing'), (error) => error.status === 404);
  assert.equal(papers.remove(paper.item.id).ok, true);
});

test('manual book: 319/320 stays at 99%, exact last page completes, correction reopens', t => {
  const {books}=setup(t);
  const {item}=books.create({title:'最后一页',totalPages:320,currentPage:319});
  assert.equal(item.progress,99);assert.equal(item.finished,false);
  assert.equal(books.list().stats.reading,1);
  const completed=books.patch(item.id,{currentPage:320}).item;
  assert.equal(completed.progress,100);assert.equal(completed.finished,true);assert.ok(completed.finishedAt);
  assert.equal(books.list().stats.reading,0);assert.equal(books.list().stats.finished,1);
  const reopened=books.patch(item.id,{currentPage:300}).item;
  assert.equal(reopened.finished,false);assert.equal(reopened.finishedAt,null);
  assert.equal(books.list().stats.reading,1);
});
