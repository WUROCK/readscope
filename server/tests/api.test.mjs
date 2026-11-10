import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { startServer } from '../index.mjs';

const FIXED_NOW = () => new Date('2026-10-29T10:00:00+08:00');

function makeTempDir(t, { seed = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readscope-api-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (seed) {
    const seedDir = path.join(dir, 'seed');
    fs.mkdirSync(seedDir, { recursive: true });
    fs.writeFileSync(
      path.join(seedDir, 'curated_papers.json'),
      JSON.stringify([
        {
          title: '接口测试精选论文',
          venue: 'IEEE TWC',
          year: 2026,
          url: 'https://example.com/api-paper-1',
          summary: '接口测试用中文摘要，包含 RIS 与通感一体化关键词。',
          tags: ['RIS', 'ISAC'],
          language: 'zh',
        },
        {
          title: '接口测试精选论文二',
          venue: 'IEEE TCCN',
          year: 2025,
          url: 'https://example.com/api-paper-2',
          summary: '第二篇接口测试摘要。',
          tags: ['ISAC'],
          language: 'zh',
        },
      ]),
      'utf8',
    );
  }
  return dir;
}

async function call(base, urlPath, { method = 'GET', body, rawBody } = {}) {
  const headers = {};
  let payload;
  if (rawBody !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = rawBody;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const response = await fetch(`${base}${urlPath}`, { method, headers, body: payload });
  const buffer = Buffer.from(await response.arrayBuffer());
  const text = buffer.toString('utf8');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: response.status, data, text, buffer, headers: response.headers };
}

test('HTTP API：health/settings/books/papers/checkin/404/错误结构', async (t) => {
  const dir = makeTempDir(t);
  const server = await startServer({ port: 0, dataDir: dir, now: FIXED_NOW, serveStatic: false });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.port}`;

  const health = await call(base, '/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.ok, true);
  assert.equal(health.data.version, '0.1.0');
  assert.equal(health.data.dataDir, dir);
  assert.match(health.data.time, /\+08:00$/);
  assert.match(health.headers.get('content-type'), /application\/json/);

  const settings = await call(base, '/api/settings');
  assert.equal(settings.status, 200);
  assert.equal(settings.data.wereadConfigured, false);
  assert.equal(settings.data.goalMinutes, 45);
  assert.equal(settings.data.wereadKeyMasked, null);

  // WeRead 未配置时测试连接不应抛 500
  const testNoKey = await call(base, '/api/weread/test', { method: 'POST', body: {} });
  assert.equal(testNoKey.status, 200);
  assert.equal(testNoKey.data.ok, false);
  assert.match(testNoKey.data.message, /API Key/);

  const badSettings = await call(base, '/api/settings', { method: 'PUT', body: { goalMinutes: 10 } });
  assert.equal(badSettings.status, 400);
  assert.equal(badSettings.data.error.code, 'BAD_REQUEST');
  assert.equal(typeof badSettings.data.error.message, 'string');

  const saved = await call(base, '/api/settings', {
    method: 'PUT',
    body: {
      wereadApiKey: 'wrk-api-test-9999',
      goalMinutes: 60,
      checkinMinutes: 20,
      researchTags: [' RIS ', 'ris', '毫米波雷达', 'ISAC'],
      recommendationSource: 'curated',
    },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.wereadConfigured, true);
  assert.equal(saved.data.wereadKeyMasked, 'wrk-api-••••••••');
  assert.deepEqual(saved.data.researchTags, ['RIS', '毫米波雷达', 'ISAC']);
  const onDisk = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');
  assert.equal(onDisk.includes('wrk-api-test-9999'), true);
  assert.equal(JSON.stringify(saved.data).includes('wrk-api-test-9999'), false);

  // 测试后续接口走 demo 路径，避免真实网络请求
  const cleared = await call(base, '/api/settings', { method: 'PUT', body: { wereadApiKey: '' } });
  assert.equal(cleared.data.wereadConfigured, false);

  // 手动书 CRUD
  const createdBook = await call(base, '/api/books', {
    method: 'POST',
    body: { title: '接口测试书', author: '作者', totalPages: 320, currentPage: 48, domain: 'tech', tags: ['雷达'] },
  });
  assert.equal(createdBook.status, 201);
  assert.equal(createdBook.data.item.progress, 15);
  assert.equal(createdBook.data.item.estimatedMinutesRemaining, 454);
  const bookId = createdBook.data.item.id;
  const patchedBook = await call(base, `/api/books/${bookId}`, { method: 'PATCH', body: { currentPage: 160 } });
  assert.equal(patchedBook.status, 200);
  assert.equal(patchedBook.data.item.progress, 50);
  const books = await call(base, '/api/books');
  assert.equal(books.status, 200);
  assert.equal(books.data.items.length, 1);
  assert.equal(books.data.stats.totalPagesRead, 160);
  const badBook = await call(base, '/api/books', { method: 'POST', body: { title: '坏书', totalPages: 0 } });
  assert.equal(badBook.status, 400);
  assert.equal(badBook.data.error.message, '总页数必须大于 0');

  // 文献 CRUD + 状态流转
  const createdPaper = await call(base, '/api/papers', {
    method: 'POST',
    body: {
      title: '接口测试文献',
      venue: 'IEEE TWC',
      year: 2026,
      url: 'https://example.com/api-paper',
      tags: ['RIS'],
      totalPages: 14,
      currentPage: 2,
    },
  });
  assert.equal(createdPaper.status, 201);
  assert.equal(createdPaper.data.item.status, 'todo');
  const paperId = createdPaper.data.item.id;
  const donePaper = await call(base, `/api/papers/${paperId}`, { method: 'PATCH', body: { status: 'done' } });
  assert.equal(donePaper.status, 200);
  assert.equal(donePaper.data.item.currentPage, 14);
  assert.equal(donePaper.data.item.finishedAt !== null, true);
  const papers = await call(base, '/api/papers');
  assert.equal(papers.data.stats.done, 1);
  assert.equal(papers.data.tagCounts[0].tag, 'RIS');

  // 手动打卡
  const checkin = await call(base, '/api/checkin', { method: 'POST', body: { minutes: 30, note: '手动补记' } });
  assert.equal(checkin.status, 200);
  assert.equal(checkin.data.day.source, 'manual');
  assert.equal(checkin.data.day.checkedIn, true);
  assert.equal(checkin.data.today.date, '2026-10-29');
  const history = await call(base, '/api/checkin/history?days=5');
  assert.equal(history.status, 200);
  assert.equal(history.data.days.length, 5);
  assert.equal(history.data.days[4].date, '2026-10-29');
  assert.equal(history.data.days[4].source, 'manual');
  const badCheckin = await call(base, '/api/checkin', { method: 'POST', body: { minutes: 601 } });
  assert.equal(badCheckin.status, 400);

  // 404 与非法 JSON
  const notFound = await call(base, '/api/does-not-exist');
  assert.equal(notFound.status, 404);
  assert.equal(notFound.data.error.code, 'NOT_FOUND');
  const invalidJson = await call(base, '/api/settings', { method: 'PUT', rawBody: '{bad json' });
  assert.equal(invalidJson.status, 400);
  assert.equal(invalidJson.data.error.code, 'BAD_REQUEST');
});

test('HTTP API：demo overview 与 curated 推荐全链路（不触网）', async (t) => {
  const dir = makeTempDir(t);
  const server = await startServer({ port: 0, dataDir: dir, now: FIXED_NOW, serveStatic: false });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.port}`;

  const overview = await call(base, '/api/weread/overview');
  assert.equal(overview.status, 200);
  assert.equal(overview.data.source, 'demo');
  assert.equal(overview.data.connected, false);
  assert.equal(overview.data.today.minutes, 42);
  assert.equal(overview.data.today.goalMinutes, 45);
  assert.equal(overview.data.today.streak, 6);
  assert.equal(overview.data.week.days.length, 7);
  assert.equal(overview.data.domains.items.length, 8);
  assert.equal(overview.data.domains.covered, 6);
  assert.equal(overview.data.books.length, 6);
  assert.ok(Array.isArray(overview.data.books[0].tags) && overview.data.books[0].tags.length > 0);
  assert.equal(overview.data.checkinHistory.length, 30);
  assert.equal(overview.data.notice, '当前为演示数据，连接微信读书后自动同步真实进度');
  assert.equal(overview.data.stats.monthMinutes, 1048);
  assert.equal(overview.data.stats.monthStartedBooks, 5);
  assert.equal(overview.data.stats.monthFinishedBooks, 2);
  assert.equal(overview.data.stats.monthReadDays, 22);
  assert.ok(overview.data.stats.yearMinutes > 0);
  assert.equal(overview.data.stats.yearStartedBooks, 31);
  assert.ok(overview.data.stats.yearReadDays > 0);
  assert.equal(overview.data.stats.annualMonths.length, 12);
  assert.deepEqual(overview.data.stats.annualMonths[0].month, 1);
  assert.deepEqual(overview.data.stats.annualMonths[11].month, 12);
  // 兼容旧字段
  assert.equal(overview.data.stats.totalMinutes, 1048);
  assert.equal(overview.data.stats.finishedBooks, 2);
  assert.equal(overview.data.stats.readDays, 22);

  // 切换到 curated，避免实时网络
  await call(base, '/api/settings', { method: 'PUT', body: { recommendationSource: 'curated' } });

  const today = await call(base, '/api/recommendations/today');
  assert.equal(today.status, 200);
  assert.equal(today.data.date, '2026-10-29');
  assert.ok(today.data.item);
  assert.equal(today.data.item.source, 'curated');
  assert.equal(today.data.sources.arxiv, 'idle');
  assert.equal(today.data.stats.total, 1);
  assert.equal(typeof today.data.stats.csvPath, 'string');
  const firstTitle = today.data.item.title;

  const refresh = await call(base, '/api/recommendations/refresh', { method: 'POST', body: {} });
  assert.equal(refresh.status, 200);
  assert.equal(refresh.data.replaced, true);
  assert.ok(refresh.data.item);
  assert.notEqual(refresh.data.item.title, firstTitle);
  assert.equal(refresh.data.stats.total, 2);
  const badRefresh = await call(base, '/api/recommendations/refresh', {
    method: 'POST',
    body: { source: 'twitter' },
  });
  assert.equal(badRefresh.status, 400);

  const history = await call(base, '/api/recommendations/history?limit=1');
  assert.equal(history.status, 200);
  assert.equal(history.data.items.length, 1);
  assert.equal(history.data.total, 2);
  const badHistory = await call(base, '/api/recommendations/history?limit=0');
  assert.equal(badHistory.status, 400);

  const exported = await call(base, '/api/recommendations/export');
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-type'), /text\/csv/);
  assert.equal(exported.buffer[0], 0xef);
  assert.equal(exported.buffer[1], 0xbb);
  assert.equal(exported.buffer[2], 0xbf);
  assert.match(exported.text, /date,type,title,venue,year,summary,url,source,source_label,tags,language,fetched_at/);
  assert.equal(exported.text.split('\r\n').filter(Boolean).length, 3); // 表头 + 2 行
});

test('静态前端：web/dist 存在时托管、SPA fallback，/api 保持 JSON 404', async (t) => {
  const dataDir = makeTempDir(t, { seed: false });
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'readscope-dist-'));
  t.after(() => fs.rmSync(distDir, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(distDir, 'index.html'),
    '<!doctype html><html><body><div id="root">阅界测试页面</div><script src="/assets/app.js"></script></body></html>',
    'utf8',
  );
  fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(distDir, 'assets', 'app.js'), 'console.log("readscope");', 'utf8');

  const server = await startServer({
    port: 0,
    dataDir,
    now: FIXED_NOW,
    serveStatic: true,
    staticDir: distDir,
  });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.port}`;

  const root = await call(base, '/');
  assert.equal(root.status, 200);
  assert.match(root.text, /阅界测试页面/);

  const asset = await call(base, '/assets/app.js');
  assert.equal(asset.status, 200);
  assert.equal(asset.text, 'console.log("readscope");');

  const spa = await call(base, '/reading?day=today');
  assert.equal(spa.status, 200);
  assert.match(spa.text, /<div id="root">/);

  const health = await call(base, '/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.ok, true);

  const api404 = await call(base, '/api/not-a-route');
  assert.equal(api404.status, 404);
  assert.equal(api404.data.error.code, 'NOT_FOUND');
});

test('静态前端：serveStatic=false 或 dist 缺失时不托管且不报错', async (t) => {
  const dataDir = makeTempDir(t, { seed: false });
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'readscope-dist2-'));
  t.after(() => fs.rmSync(distDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(distDir, 'index.html'), '<div>root</div>', 'utf8');

  const disabled = await startServer({
    port: 0,
    dataDir,
    now: FIXED_NOW,
    serveStatic: false,
    staticDir: distDir,
  });
  t.after(() => disabled.close());
  const disabledRoot = await call(`http://127.0.0.1:${disabled.port}`, '/');
  assert.equal(disabledRoot.status, 404);
  assert.equal(disabledRoot.data.error.code, 'NOT_FOUND');

  const missing = await startServer({
    port: 0,
    dataDir,
    now: FIXED_NOW,
    serveStatic: true,
    staticDir: path.join(distDir, 'does-not-exist'),
  });
  t.after(() => missing.close());
  const missingRoot = await call(`http://127.0.0.1:${missing.port}`, '/');
  assert.equal(missingRoot.status, 404);
  assert.equal(missingRoot.data.error.code, 'NOT_FOUND');
  assert.equal((await call(`http://127.0.0.1:${missing.port}`, '/api/health')).status, 200);
});

test('startServer 可在同一进程重复启动/关闭（端口 0）', async (t) => {
  const dirA = makeTempDir(t, { seed: false });
  const dirB = makeTempDir(t, { seed: false });
  const first = await startServer({ port: 0, dataDir: dirA, now: FIXED_NOW, serveStatic: false });
  const second = await startServer({ port: 0, dataDir: dirB, now: FIXED_NOW, serveStatic: false });
  assert.notEqual(first.port, second.port);
  const healthA = await call(`http://127.0.0.1:${first.port}`, '/api/health');
  const healthB = await call(`http://127.0.0.1:${second.port}`, '/api/health');
  assert.equal(healthA.data.dataDir, dirA);
  assert.equal(healthB.data.dataDir, dirB);
  await first.close();
  await second.close();
  // 关闭是幂等的
  await first.close();
});
