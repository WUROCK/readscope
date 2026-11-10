/**
 * 服务入口。
 *
 * 作为模块被 Electron / 测试导入时不会监听端口：
 *   const { startServer } = await import('./server/index.mjs');
 *   const { port, close } = await startServer({ port: 7411 });
 *
 * 直接执行时监听 PORT（默认 7411）：
 *   node server/index.mjs
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.mjs';

const DEFAULT_PORT = 7411;

/**
 * 启动 API 服务。
 * @param {{
 *   port?: number,
 *   dataDir?: string,
 *   fetchImpl?: Function,
 *   now?: () => Date,
 *   host?: string,
 *   serveStatic?: boolean,
 *   staticDir?: string,
 * }} [options]
 * @returns {Promise<{ port: number, app: any, close: () => Promise<void> }>}
 */
export async function startServer({
  port = DEFAULT_PORT,
  dataDir,
  fetchImpl = null,
  now,
  host = '127.0.0.1',
  serveStatic = true,
  staticDir,
} = {}) {
  const { app } = createApp({
    dataDir,
    fetchImpl,
    ...(now ? { now } : {}),
    serveStatic,
    ...(staticDir ? { staticDir } : {}),
  });

  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(port, host, () => resolve(instance));
    instance.once('error', reject);
  });

  const address = server.address();
  const actualPort = address && typeof address === 'object' ? address.port : port;

  let closingPromise = null;
  async function close() {
    if (closingPromise) return closingPromise;
    closingPromise = new Promise((resolve, reject) => {
      server.close((error) => {
        if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
        else resolve();
      });
      // 断开 keep-alive 连接，避免测试/退出时挂起
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    });
    return closingPromise;
  }

  return { port: actualPort, app, close };
}

function isDirectExecution() {
  const entry = process.argv[1];
  if (!entry) return false;
  const current = fileURLToPath(import.meta.url);
  return path.resolve(entry).toLowerCase() === path.resolve(current).toLowerCase();
}

if (isDirectExecution()) {
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  startServer({ port })
    .then(({ port: actualPort }) => {
      console.log(`阅界 API 服务已启动：http://127.0.0.1:${actualPort}/api/health`);
      console.log('读取本地数据目录：' + (process.env.READSCOPE_DATA_DIR || path.resolve('data')));
    })
    .catch((error) => {
      if (error?.code === 'EADDRINUSE') {
        console.error(`启动失败：端口 ${port} 已被占用，请关闭占用进程或设置 PORT 环境变量。`);
      } else {
        console.error('阅界 API 服务启动失败：', error?.message || error);
      }
      process.exitCode = 1;
    });
}
