import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
// Use the installed compiler so the suite also works on the supported Node 20.
const compiled = ts.transpileModule(fs.readFileSync(new URL('../src/lib/books.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { applyReadingOrder, mergeReadingItems, partitionReadingItems } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

test('a saved order spans both book sources without being changed by progress edits', () => {
  const wx = {id:'wx', title:'微信书', tags:[], lastReadAt:'2026-11-01T10:00:00+08:00'};
  const manual = {id:'manual', title:'纸书', tags:[], updatedAt:'2026-11-01T12:00:00+08:00'};
  const merged = mergeReadingItems([wx], [manual]);
  assert.deepEqual(merged.map(x=>x.key), ['manual', 'wx']);
  assert.deepEqual(applyReadingOrder(merged, ['wx', 'manual']).map(x=>x.key), ['wx', 'manual']);
  assert.deepEqual(merged.map(x=>x.key), ['manual', 'wx']);
});
test('new books remain visible and deleted ids do not duplicate or hide rows', () => {
  const items = ['newer', 'old', 'new'].map(key=>({key}));
  assert.deepEqual(applyReadingOrder(items, ['deleted', 'old']).map(x=>x.key), ['old', 'newer', 'new']);
  assert.deepEqual(applyReadingOrder(items, []).map(x=>x.key), ['newer', 'old', 'new']);
});

test('completed manual books leave reading even if an old finished flag is stale', () => {
  const items=mergeReadingItems([], [{id:'done',title:'读完',tags:[],totalPages:320,currentPage:320,progress:100,finished:false}]);
  const groups=partitionReadingItems(items);
  assert.equal(groups.reading.length,0);assert.equal(groups.finished.length,1);
  assert.equal(groups.finished[0].progress,100);
});
test('rounding to 100 never archives an unfinished paper book', () => {
  const items=mergeReadingItems([], [{id:'almost',title:'差一页',tags:[],totalPages:320,currentPage:319,progress:100,finished:true}]);
  const groups=partitionReadingItems(items);
  assert.equal(groups.reading.length,1);assert.equal(groups.finished.length,0);
  assert.equal(groups.reading[0].progress,99);
});
test('completed books from both sources are separated without losing saved order', () => {
  const items=applyReadingOrder(mergeReadingItems([{id:'wx',title:'完成的电子书',tags:[],finished:true}],
    [{id:'a',title:'在读甲',tags:[],totalPages:100,currentPage:20},{id:'b',title:'在读乙',tags:[],totalPages:100,currentPage:30}]), ['b','wx','a']);
  const groups=partitionReadingItems(items);
  assert.deepEqual(groups.reading.map(x=>x.key),['b','a']);
  assert.deepEqual(groups.finished.map(x=>x.key),['wx']);
});
