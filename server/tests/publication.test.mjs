import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../store.mjs';
import { createRecommendationService, serializeRecommendationRow } from '../recommendations.mjs';
import { createPublicationResolver, hasPublicationVenue, publicationFromCrossref } from '../sources/publication.mjs';
import { fetchCrossrefRecommendation, parseCrossrefCandidates } from '../sources/crossref.mjs';

const now = () => new Date('2026-11-01T08:00:00Z');
const work = (index = 1, patch = {}) => ({
  DOI: `10.1109/test.${index}`, type: 'journal-article',
  title: [`RIS-Assisted ISAC for Human Sensing ${index}`],
  'container-title': ['IEEE Transactions on Wireless Communications'],
  published: { 'date-parts': [[2025, 4, 3]] }, ...patch,
});
const reply = (message, status = 200) => ({ ok: status === 200, status, json: async () => ({ message }) });
function storeFor(t, seed = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'readscope-publication-'));
  t.after(() => {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(directory, 'seed'));
  fs.writeFileSync(path.join(directory, 'seed', 'curated_papers.json'), JSON.stringify(seed));
  return createStore({ dataDir: directory, now });
}

test('出版信息：严格核对 DOI、完整标题、正式类型和日期', () => {
  const record = work();
  assert.equal(publicationFromCrossref(record, { title: record.title[0], doi: record.DOI, now: now() }).publicationYear, 2025);
  assert.equal(publicationFromCrossref(record, { title: 'A different paper', now: now() }), null);
  assert.equal(publicationFromCrossref(record, { doi: '10.1109/other', now: now() }), null);
  assert.equal(publicationFromCrossref(work(1, { type: 'posted-content' }), { now: now() }), null);
  assert.equal(publicationFromCrossref(work(1, { 'container-title': [] }), { now: now() }), null);
  assert.equal(publicationFromCrossref(work(1, { published: { 'date-parts': [[2027]] } }), { now: now() }), null);
  assert.equal(publicationFromCrossref(work(1, { 'published-online': { 'date-parts': [[2024]] } }), { now: now() }).publicationYear, 2024);
});

test('补查：无 journal_ref 时按 DOI 补全，并保留正式发表年', async () => {
  let calls = 0;
  const record = work();
  const resolve = createPublicationResolver({ now, fetchImpl: async (url) => {
    calls++; assert.ok(url.includes(encodeURIComponent(record.DOI))); return reply(record);
  } });
  const item = { title: record.title[0], doi: record.DOI, source: 'arxiv', year: 2026, venue: 'arXiv 预印本' };
  const first = await resolve(item);
  assert.equal(first.venue, record['container-title'][0]);
  assert.equal(first.publicationYear, 2025);
  assert.equal(first.venueStatus, 'published');
  assert.equal((await resolve(item)).publicationDoi, record.DOI);
  assert.equal(calls, 1);
});

test('补查：无 DOI 仅接受完全一致标题，拒绝相似标题与歧义记录', async () => {
  const record = work();
  const item = { title: record.title[0], venue: 'arXiv' };
  const exact = createPublicationResolver({ now, fetchImpl: async () => reply({ items: [record] }) });
  assert.equal((await exact(item)).publicationDoi, record.DOI);
  const unrelated = createPublicationResolver({ now, fetchImpl: async () => reply({ items: [work(1, { title: ['A Survey About Another Subject'] })] }) });
  assert.equal(await unrelated(item), null);
  const ambiguous = createPublicationResolver({ now, fetchImpl: async () => reply({ items: [record, work(2, { title: record.title })] }) });
  assert.equal(await ambiguous(item), null);
});

test('补查缓存：不同标题不能共享 DOI 命中，429 不被缓存成无出处', async () => {
  let calls = 0;
  const record = work();
  const resolve = createPublicationResolver({ now, fetchImpl: async () => {
    calls++; return calls === 1 ? reply(null, 429) : reply(record);
  } });
  const item = { title: record.title[0], doi: record.DOI };
  assert.equal(await resolve(item), null);
  assert.equal((await resolve(item)).publicationDoi, record.DOI);
  assert.equal(await resolve({ ...item, title: 'Wrong paper' }), null);
  assert.equal(calls, 3);
});

test('补查超时：底层忽略取消也会及时返回，不伪造期刊名', async () => {
  const start = Date.now();
  const resolve = createPublicationResolver({ now, timeoutMs: 15, fetchImpl: () => new Promise(() => {}) });
  assert.equal(await resolve({ title: 'RIS paper' }), null);
  assert.ok(Date.now() - start < 500);
  for (const placeholder of ['', 'arXiv', 'arXiv preprint', 'arXiv:2601.12345', '精选文献库']) assert.equal(hasPublicationVenue(placeholder), false);
});

test('Crossref 推荐：只接收相关正式论文，候选池缓存支持连续十次不同推荐', async (t) => {
  const store = storeFor(t);
  let calls = 0;
  const records = Array.from({ length: 12 }, (_, i) => work(i + 1));
  const irrelevant = work(99, { title: ['Unrelated Chemical Reaction'] });
  assert.equal(parseCrossrefCandidates([...records, irrelevant], { now: now() }).length, 12);
  const usedUrls = new Set(), usedTitles = new Set();
  for (let i = 0; i < 10; i++) {
    const result = await fetchCrossrefRecommendation({ store, now, variant: 0, settings: { researchTags: ['RIS'] }, usedUrls, usedTitles,
      fetchImpl: async () => { calls++; return reply({ items: records }); } });
    assert.ok(hasPublicationVenue(result.item.venue));
    assert.equal(result.item.venueStatus, 'published');
    usedUrls.add(result.item.url);
  }
  assert.equal(usedUrls.size, 10);
  assert.equal(calls, 1);
});

test('旧今日记录：自动补查、写回元数据且保留原始历史', async (t) => {
  const store = storeFor(t);
  const record = work();
  store.writeRecommendationRows([serializeRecommendationRow({ date: '2026-11-01', type: 'paper', title: record.title[0],
    url: 'https://arxiv.org/abs/2601.12345', source: 'arxiv', venue: 'arXiv 预印本', year: 2026 })]);
  const service = createRecommendationService({ store, now, fetchImpl: async () => reply({ items: [record] }) });
  const today = await service.getToday();
  assert.equal(today.item.source, 'arxiv');
  assert.equal(today.item.publicationYear, 2025);
  assert.equal(today.stats.total, 1);
  assert.equal(service.readRows()[0].publicationDoi, record.DOI);
});

test('旧预印本无出版命中：优先追加已发表推荐，不删除旧记录', async (t) => {
  const published = { title: 'Verified RIS Sensing Paper', venue: 'IEEE Sensors Journal', year: 2024,
    url: 'https://doi.org/10.1109/verified', publicationDoi: '10.1109/verified', publicationYear: 2024,
    publicationUrl: 'https://doi.org/10.1109/verified', venueStatus: 'published', venueSource: 'crossref' };
  const store = storeFor(t, [published]);
  store.writeRecommendationRows([serializeRecommendationRow({ date: '2026-11-01', type: 'paper', title: 'A New Unpublished RIS Paper',
    url: 'https://arxiv.org/abs/2611.00001', source: 'arxiv', venue: 'arXiv 预印本', year: 2026 })]);
  const service = createRecommendationService({ store, now, fetchImpl: async () => reply({ items: [] }),
    sourceImpls: { crossref: async () => ({ item: null }) } });
  const today = await service.getToday();
  assert.equal(today.item.title, published.title);
  assert.equal(today.item.venueStatus, 'published');
  assert.equal(today.stats.total, 2);
  assert.equal(today.history[1].title, 'A New Unpublished RIS Paper');
});

test('离线备用池：连续十次仍有真实出版信息且不访问 arXiv', async (t) => {
  const seed = JSON.parse(fs.readFileSync(new URL('../../data/seed/curated_papers.json', import.meta.url), 'utf8'));
  const store = storeFor(t, seed);
  const service = createRecommendationService({ store, now,
    sourceImpls: { crossref: async () => { throw new Error('offline'); }, arxiv: async () => { throw new Error('Must not need preprints'); } } });
  const identifiers = new Set();
  for (let i = 0; i < 10; i++) {
    const { item } = await service.refresh({ source: 'paper' });
    assert.ok(hasPublicationVenue(item.venue));
    assert.equal(item.venueStatus, 'published');
    assert.match(item.publicationDoi, /^10\.1109\//);
    identifiers.add(item.publicationDoi);
  }
  assert.equal(identifiers.size, 10);
});
