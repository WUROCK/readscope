/**
 * Express 应用装配：所有 /api 路由、参数校验、统一错误结构。
 * 生产模式下同时托管 web/dist（Electron 直接加载 API 端口即可），开发时由 Vite 负责页面。
 */

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  APP_VERSION,
  RECOMMENDATION_SOURCES,
  REPO_ROOT,
  createStore,
} from './store.mjs';
import { AppError, isoShanghai } from './util.mjs';
import { createWereadClient, shortWereadError } from './weread.mjs';
import { createCheckinsService } from './checkins.mjs';
import { createBooksService } from './books.mjs';
import { createPapersService } from './papers.mjs';
import { createOverviewService } from './overview.mjs';
import { createRecommendationService } from './recommendations.mjs';

const JSON_LIMIT = '1mb';

function parseRefresh(value) {
  return value === '1' || value === 'true' || value === true;
}

function sendError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

/**
 * @param {{
 *   dataDir?: string,
 *   fetchImpl?: Function,
 *   now?: () => Date,
 *   version?: string,
 *   recommendationSourceImpls?: { arxiv?: Function, wechat?: Function },
 *   liveTimeoutMs?: number,
 *   serveStatic?: boolean,
 *   staticDir?: string,
 * }} [options]
 */
export function createApp({
  dataDir,
  fetchImpl = null,
  now = () => new Date(),
  version = APP_VERSION,
  recommendationSourceImpls = {},
  liveTimeoutMs,
  serveStatic = true,
  staticDir = path.join(REPO_ROOT, 'web', 'dist'),
} = {}) {
  const store = createStore({ dataDir, now });
  const weread = createWereadClient({ store, fetchImpl, now });
  const checkins = createCheckinsService({ store, now });
  const books = createBooksService({ store, now });
  const papers = createPapersService({ store, now });
  const overview = createOverviewService({ store, weread, checkins, now });
  const recommendations = createRecommendationService({
    store,
    now,
    fetchImpl,
    sourceImpls: recommendationSourceImpls,
    ...(liveTimeoutMs ? { liveTimeoutMs } : {}),
  });

  const app = express();
  app.disable('x-powered-by');

  // 只允许本机访问；Electron file:// 渲染层需要跨域头
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  });

  app.use(express.json({ limit: JSON_LIMIT }));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, version, dataDir: store.dataDir, time: isoShanghai(now()) });
  });

  /* ------------------------------- settings ------------------------------- */

  app.get('/api/settings', (req, res) => {
    res.json(store.getPublicSettings());
  });

  app.put('/api/settings', (req, res) => {
    store.updateSettings(req.body);
    res.json(store.getPublicSettings());
  });

  /* ------------------------------- weread --------------------------------- */

  app.post('/api/weread/test', async (req, res) => {
    const key = store.getSettings().wereadApiKey;
    if (!key) {
      return res.json({ ok: false, message: '请先在设置中填写微信读书 API Key' });
    }
    try {
      const { bookCount } = await weread.testConnection(key);
      return res.json({ ok: true, message: `已连接微信读书，书架 ${bookCount} 本`, bookCount });
    } catch (error) {
      const message =
        error?.code === 'AUTH' ? 'API Key 无效或已过期' : shortWereadError(error);
      return res.json({ ok: false, message });
    }
  });

  app.get('/api/weread/overview', async (req, res) => {
    const result = await overview.getOverview({ refresh: parseRefresh(req.query.refresh) });
    res.json(result);
  });

  /* ------------------------------- checkin -------------------------------- */

  app.get('/api/checkin/history', (req, res) => {
    const rawDays = req.query.days;
    const days = rawDays === undefined || rawDays === '' ? 30 : Number(rawDays);
    if (!Number.isInteger(days) || days < 1 || days > 366) {
      return sendError(res, 400, 'BAD_REQUEST', '天数必须是 1–366 之间的整数');
    }
    return res.json({ days: overview.getCheckinHistory({ days }) });
  });

  app.post('/api/checkin', async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const settings = store.getSettings();
    let minutes = settings.checkinMinutes;
    if (body.minutes !== undefined && body.minutes !== null) {
      if (typeof body.minutes !== 'number' || !Number.isFinite(body.minutes) || body.minutes < 0 || body.minutes > 600) {
        return sendError(res, 400, 'BAD_REQUEST', '补记分钟数必须是 0–600 之间的数字');
      }
      minutes = Math.round(body.minutes);
    }
    const result = await overview.manualCheckin({ minutes });
    return res.json(result);
  });

  // Electron 主进程在窗口隐藏时每 10 分钟调用一次：只拉本周时长，达标即自动打卡。
  app.post('/api/checkin/auto', async (req, res) => {
    res.json(await overview.autoCheckinOnly({ refresh: parseRefresh(req.query.refresh) }));
  });

  /* -------------------------------- books --------------------------------- */

  app.get('/api/books', (req, res) => {
    res.json(books.list());
  });

  app.post('/api/books', (req, res) => {
    const result = books.create(req.body);
    res.status(201).json(result);
  });

  app.patch('/api/books/:id', (req, res) => {
    res.json(books.patch(req.params.id, req.body));
  });

  app.delete('/api/books/:id', (req, res) => {
    res.json(books.remove(req.params.id));
  });

  /* -------------------------------- papers -------------------------------- */

  app.get('/api/papers', (req, res) => {
    res.json(papers.list());
  });

  app.post('/api/papers', (req, res) => {
    const result = papers.create(req.body);
    res.status(201).json(result);
  });

  app.patch('/api/papers/:id', (req, res) => {
    res.json(papers.patch(req.params.id, req.body));
  });

  app.delete('/api/papers/:id', (req, res) => {
    res.json(papers.remove(req.params.id));
  });

  /* ---------------------------- recommendations --------------------------- */

  app.get('/api/recommendations/today', async (req, res) => {
    res.json(await recommendations.getToday());
  });

  app.post('/api/recommendations/refresh', async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    let source = null;
    if (body.source !== undefined && body.source !== null && body.source !== '') {
      if (!RECOMMENDATION_SOURCES.includes(body.source)) {
        return sendError(res, 400, 'BAD_REQUEST', '推荐来源必须是 auto、paper、wechat 或 curated');
      }
      source = body.source;
    }
    const result = await recommendations.refresh({ source });
    return res.json(result);
  });

  app.get('/api/recommendations/history', (req, res) => {
    const rawLimit = req.query.limit;
    const limit = rawLimit === undefined || rawLimit === '' ? 100 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1) {
      return sendError(res, 400, 'BAD_REQUEST', 'limit 必须是正整数');
    }
    return res.json(recommendations.getHistory({ limit }));
  });

  app.get('/api/recommendations/export', (req, res) => {
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="recommendations.csv"');
    res.send(recommendations.exportCsv());
  });

  /* --------------------------- 静态前端（可选） --------------------------- */
  // Electron 生产模式加载 http://127.0.0.1:<port>/，若 web/dist 已构建则直接由 API 服务托管。
  const resolvedStaticDir = staticDir ? path.resolve(staticDir) : null;
  const hasStatic =
    Boolean(serveStatic && resolvedStaticDir) &&
    fs.existsSync(resolvedStaticDir) &&
    fs.statSync(resolvedStaticDir).isDirectory();
  if (hasStatic) {
    app.use(express.static(resolvedStaticDir));
    // SPA fallback：GET 非 /api 路径回 index.html
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (req.path === '/api' || req.path.startsWith('/api/')) return next();
      const indexFile = path.join(resolvedStaticDir, 'index.html');
      if (!fs.existsSync(indexFile)) return next();
      return res.sendFile(indexFile, (error) => {
        if (error) next(error);
      });
    });
  }

  /* ------------------------------- 404 / error ---------------------------- */

  app.use((req, res) => {
    sendError(res, 404, 'NOT_FOUND', '接口不存在');
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error?.type === 'entity.too.large') {
      return sendError(res, 400, 'BAD_REQUEST', '请求体过大（上限 1MB）');
    }
    if (error instanceof SyntaxError && error.status === 400) {
      return sendError(res, 400, 'BAD_REQUEST', '请求体不是合法的 JSON');
    }
    if (error instanceof AppError) {
      return sendError(res, error.status, error.code, error.message);
    }
    const status = Number(error?.status || error?.statusCode) || 500;
    if (status >= 500) {
      console.error('[阅界 API] 未处理错误:', error?.stack || error);
      return sendError(res, 500, 'INTERNAL_ERROR', '服务器内部错误');
    }
    return sendError(res, status, error?.code || 'BAD_REQUEST', error?.message || '请求无效');
  });

  return {
    app,
    store,
    services: { weread, checkins, books, papers, overview, recommendations },
    version,
    static: { enabled: hasStatic, dir: hasStatic ? resolvedStaticDir : null },
  };
}
