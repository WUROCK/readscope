import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createStore } from '../store.mjs';
import {
  buildUsedSets,
  createRecommendationService,
  parseRecommendationRow,
  planRecommendationSources,
  serializeRecommendationRow,
} from '../recommendations.mjs';
import { parseArxivAtom, buildArxivSearchQuery, buildArxivUrl } from '../sources/arxiv.mjs';
import { buildWechatQueries, mapWechatArticles, tryResolveWechatUrl } from '../sources/wechat.mjs';
import { readCsvSync } from '../util.mjs';
import { RECOMMENDATION_COLUMNS } from '../store.mjs';

const FIXED_NOW = () => new Date('2026-10-29T10:00:00+08:00');

function tempStore(t, seedItems = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readscope-rec-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (seedItems) {
    fs.mkdirSync(path.join(dir, 'seed'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'seed', 'curated_papers.json'), JSON.stringify(seedItems), 'utf8');
  }
  const store = createStore({ dataDir: dir, now: FIXED_NOW });
  return { dir, store };
}

function makeSeed(count = 2) {
  return Array.from({ length: count }, (_, i) => ({
    title: `精选论文 ${i + 1}`,
    venue: i === 0 ? 'IEEE TWC' : 'arXiv 预印本',
    year: 2025 + i,
    url: `https://example.com/paper-${i + 1}`,
    summary: `这是第 ${i + 1} 篇精选论文的中文摘要，覆盖 RIS、毫米波雷达与通感一体化方向，用于每日推荐演示。`,
    tags: ['RIS', 'ISAC'],
    language: 'zh',
  }));
}

test('arXiv Atom 解析：journal_ref、年份、版本号、排序与摘要截断', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2610.11111v2</id>
    <updated>2026-10-20T00:00:00Z</updated>
    <published>2026-10-20T00:00:00Z</published>
    <title>  Older   Paper About RIS  </title>
    <summary>Abstract: This is an older paper. It studies reconfigurable intelligent surfaces.</summary>
    <link rel="alternate" href="http://arxiv.org/abs/2610.11111v2" type="text/html"/>
    <category term="eess.SP"/>
    <category term="cs.IT"/>
    <arxiv:journal_ref>IEEE Transactions on Wireless Communications</arxiv:journal_ref>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2610.22222v1</id>
    <published>2026-10-25T00:00:00Z</published>
    <title>Newer Paper About mmWave Radar</title>
    <summary>${'A very long abstract '.repeat(30)}</summary>
    <link rel="alternate" href="https://arxiv.org/abs/2610.22222v1" type="text/html"/>
    <category term="eess.SP"/>
  </entry>
</feed>`;
  const items = parseArxivAtom(xml);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Newer Paper About mmWave Radar');
  assert.equal(items[0].venue, 'arXiv 预印本');
  assert.equal(items[0].year, 2026);
  assert.equal(items[0].url, 'https://arxiv.org/abs/2610.22222');
  assert.equal(items[0].source, 'arxiv');
  assert.equal(items[0].sourceLabel, 'arXiv 实时检索');
  assert.equal(items[0].language, 'en');
  assert.ok(Array.from(items[0].summary).length <= 141);
  assert.equal(items[1].title, 'Older Paper About RIS');
  assert.equal(items[1].venue, 'IEEE Transactions on Wireless Communications');
  assert.deepEqual(items[1].tags, ['eess.SP', 'cs.IT']);
  assert.equal(items[1].url.includes('v2'), false);
  assert.equal(buildArxivSearchQuery(['RIS', '毫米波雷达', 'ISAC', 'unknown-tag']).includes('reconfigurable intelligent surface'), true);
  assert.equal(buildArxivUrl(['毫米波雷达']).includes('export.arxiv.org'), true);
});

test('微信搜索：查询轮换、结果映射与真实链接回退', async () => {
  const queries = buildWechatQueries(['RIS', '毫米波雷达', 'ISAC', '通感一体化', '智能超表面']);
  assert.deepEqual(queries.map((item) => item.query), [
    '可重构智能表面 RIS',
    '毫米波雷达 人体感知',
    'ISAC 通感一体化',
  ]);
  assert.equal(buildWechatQueries([]).length, 3);
  assert.equal(buildWechatQueries(['自定义关键词'])[0].query, '自定义关键词');

  const mapped = mapWechatArticles(
    [
      { title: '  一篇公众号文章  ', url: 'https://weixin.sogou.com/x', summary: '摘要'.repeat(80), datetime: '2026-10-20 08:00:00', source: '机器之心' },
      { title: '', url: 'https://bad', source: 'x' },
    ],
    'RIS',
  );
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].title, '一篇公众号文章');
  assert.equal(mapped[0].type, 'article');
  assert.equal(mapped[0].venue, '机器之心');
  assert.equal(mapped[0].year, 2026);
  assert.equal(mapped[0].language, 'zh');
  assert.equal(mapped[0].sourceLabel, '公众号：机器之心');
  assert.ok(Array.from(mapped[0].summary).length <= 61);

  const resolved = await tryResolveWechatUrl('https://weixin.sogou.com/link?url=x', {
    fetchImpl: async () => ({ url: 'https://mp.weixin.qq.com/s/real', text: async () => '' }),
  });
  assert.equal(resolved, 'https://mp.weixin.qq.com/s/real');
  const fallback = await tryResolveWechatUrl('https://weixin.sogou.com/link?url=x', {
    fetchImpl: async () => new Promise(() => {}),
    timeoutMs: 10,
  });
  assert.equal(fallback, 'https://weixin.sogou.com/link?url=x');
  assert.equal(await tryResolveWechatUrl('https://mp.weixin.qq.com/s/ok'), 'https://mp.weixin.qq.com/s/ok');
});

test('精选库推荐：生成、去重、CSV 落盘与换一篇', async (t) => {
  const seed = makeSeed(2);
  const { dir, store } = tempStore(t, seed);
  store.updateSettings({ recommendationSource: 'curated' });
  const service = createRecommendationService({ store, now: FIXED_NOW });

  const first = await service.getToday();
  assert.equal(first.date, '2026-10-29');
  assert.ok(first.item);
  assert.equal(first.item.source, 'curated');
  assert.equal(first.item.sourceLabel, '精选文献库');
  assert.equal(first.item.type, 'paper');
  assert.equal(first.stats.total, 1);
  assert.equal(first.history.length, 1);
  assert.equal(first.sources.arxiv, 'idle');
  assert.equal(first.warning, null);

  const csvPath = path.join(dir, 'recommendations.csv');
  const raw = fs.readFileSync(csvPath, 'utf8');
  assert.equal(raw.charCodeAt(0), 0xfeff);
  const rawRows = readCsvSync(csvPath, RECOMMENDATION_COLUMNS);
  assert.equal(rawRows.length, 1);
  assert.equal(rawRows[0].source, 'curated');
  assert.equal(rawRows[0].language, 'zh');
  assert.ok(Array.from(rawRows[0].summary).length <= 61);

  const second = await service.refresh({});
  assert.equal(second.replaced, true);
  assert.ok(second.item);
  assert.notEqual(second.item.title, first.item.title);
  assert.equal(second.stats.total, 2);

  const third = await service.refresh({});
  assert.equal(third.item, null);
  assert.equal(typeof third.warning, 'string');
  assert.match(third.warning, /都已推荐过|没有找到/);
  assert.equal(third.stats.total, 2);

  const history = service.getHistory({ limit: 1 });
  assert.equal(history.items.length, 1);
  assert.equal(history.items[0].title, second.item.title);
  assert.equal(history.total, 2);

  const exported = service.exportCsv();
  assert.equal(exported.charCodeAt(0), 0xfeff);
  assert.equal(exported.startsWith('\uFEFFdate,type,title'), true);
});

test('CSV 去重：归一化 URL / 标题、tags 序列化与带逗号换行字段', async (t) => {
  const seed = [
    {
      title: '标题, 含逗号',
      venue: '测试期刊',
      year: 2026,
      url: 'https://Example.com/paper?utm_source=a&id=1',
      summary: '第一行摘要，第二行摘要，包含逗号',
      tags: ['RIS', '毫米波雷达', 'ISAC', '第四个标签'],
      language: 'zh',
    },
    {
      title: '另一个标题',
      venue: '测试期刊',
      year: 2026,
      url: 'https://example.com/paper?id=1&scene=2',
      summary: '重复 URL 的论文',
      tags: ['RIS'],
      language: 'zh',
    },
  ];
  const { dir, store } = tempStore(t, seed);
  store.updateSettings({ recommendationSource: 'curated' });
  const service = createRecommendationService({ store, now: FIXED_NOW });

  const first = await service.getToday();
  assert.equal(first.item.title, '标题, 含逗号'); // dayOfYear + 0 => index 0
  assert.equal(first.item.tags.length, 3);
  assert.equal(first.item.summary.includes('，'), true);

  // 换一篇：第二条 URL 归一化后与第一条重复，应当被过滤
  const second = await service.refresh({});
  assert.equal(second.item, null);

  const csvPath = path.join(dir, 'recommendations.csv');
  const rows = readCsvSync(csvPath, RECOMMENDATION_COLUMNS);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, '标题, 含逗号');
  assert.equal(rows[0].summary, '第一行摘要，第二行摘要，包含逗号');
  assert.equal(rows[0].tags, 'RIS;毫米波雷达;ISAC');

  const parsed = parseRecommendationRow(rows[0]);
  assert.equal(parsed.title, '标题, 含逗号');
  assert.deepEqual(parsed.tags, ['RIS', '毫米波雷达', 'ISAC']);
  const roundTrip = parseRecommendationRow(serializeRecommendationRow(parsed));
  assert.equal(roundTrip.id, parsed.id);
  const used = buildUsedSets([parsed]);
  assert.equal(used.urls.has('https://example.com/paper?id=1'), true);
  assert.equal(used.titles.has('标题 含逗号'), true);
});

test('实时源失败/超时回退精选库，source 状态准确', async (t) => {
  const seed = makeSeed(1);
  const { store } = tempStore(t, seed);
  store.updateSettings({ recommendationSource: 'auto' });
  const service = createRecommendationService({
    store,
    now: FIXED_NOW,
    liveTimeoutMs: 30,
    sourceImpls: {
      crossref: async () => { throw new Error('crossref down'); },
      arxiv: async () => {
        throw new Error('arxiv down');
      },
      wechat: () => new Promise(() => {}),
    },
  });
  const today = await service.getToday();
  assert.equal(today.item.source, 'curated');
  assert.deepEqual(today.sources, { crossref: 'error', arxiv: 'error', wechat: 'timeout' });
  assert.equal(today.warning, null);
  assert.equal(today.stats.total, 1);

  const again = await service.refresh({});
  assert.equal(again.item, null);
  assert.equal(typeof again.warning, 'string');
  assert.deepEqual(again.sources, { crossref: 'error', arxiv: 'error', wechat: 'timeout' });
});

test('来源计划：auto 按年积日奇偶轮换，paper/wechat/curated 明确回退', () => {
  assert.deepEqual(planRecommendationSources('paper', 302), ['crossref', 'curated', 'arxiv']);
  assert.deepEqual(planRecommendationSources('wechat', 302), ['wechat', 'curated']);
  assert.deepEqual(planRecommendationSources('curated', 302), ['curated']);
  assert.deepEqual(planRecommendationSources('auto', 302), ['crossref', 'arxiv', 'wechat', 'curated']);
  assert.deepEqual(planRecommendationSources('auto', 303), ['wechat', 'crossref', 'arxiv', 'curated']);
});
