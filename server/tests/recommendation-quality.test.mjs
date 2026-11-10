import test from 'node:test';
import assert from 'node:assert/strict';
import { buildArxivQueries, scoreArxivRelevance } from '../sources/arxiv.mjs';
import { cleanWechatSummary } from '../sources/wechat.mjs';

test('公众号摘要清洗：去掉视频播放地址/学习平台/短视频前缀', () => {
  const messy =
    '电脑端视频播放地址(雷达学报b站学习平台):论文短视频 |基于多传感器融合的协同感知方法背景介绍自动驾驶是当前机器智能领域...';
  const cleaned = cleanWechatSummary(messy);
  assert.ok(cleaned.startsWith('基于多传感器融合的协同感知方法'));
  assert.equal(cleaned.includes('电脑端'), false);
  assert.equal(cleaned.includes('学习平台'), false);
  assert.ok(Array.from(cleaned).length <= 60);
});

test('arXiv 组合检索式：RIS 与毫米波分别生成画像查询', () => {
  const queries = buildArxivQueries(['RIS', '毫米波雷达', '人体感知', 'ISAC', '多传感器融合']);
  assert.ok(queries.length >= 3);
  assert.ok(queries.some((query) => query.includes('reconfigurable intelligent surface')));
  assert.ok(queries.some((query) => query.includes('mmWave')));
  assert.ok(queries.every((query) => query.includes('AND')));
});

test('arXiv 相关性打分：RIS/ISAC 论文高于泛 3D 渲染论文', () => {
  const relevant = scoreArxivRelevance({
    title: 'RIS-Assisted ISAC for Human Activity Sensing',
    summary: 'A reconfigurable intelligent surface improves integrated sensing and communication for human sensing.',
    venue: 'IEEE Transactions on Wireless Communications',
  });
  const irrelevant = scoreArxivRelevance({
    title: 'Honeycomb-Surfels: Compact Hexagonal Primitives for Efficient Scene Rendering',
    summary: 'Novel view synthesis and scene rendering with radiance fields.',
    venue: 'arXiv 预印本',
  });
  assert.ok(relevant >= 9);
  assert.ok(irrelevant < 4);
  assert.ok(relevant > irrelevant);
});
