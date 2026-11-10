import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createApp } from '../app.mjs';
import { dateKeyToTimestampSec } from '../util.mjs';

const FIXED_NOW = () => new Date('2026-10-29T10:00:00+08:00');
const KEY = 'wrk-auto-checkin-test';
const TODAY = '2026-10-29';

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

function tempApp(t, fetchImpl) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readscope-auto-checkin-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const app = createApp({ dataDir: dir, fetchImpl, now: FIXED_NOW, serveStatic: false });
  return { dir, app };
}

test('后台自动打卡：29 分钟不打卡，30 分钟打卡且重复调用不重复写', async (t) => {
  let seconds = 29 * 60 + 59;
  const calls = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body.api_name + ':' + (body.mode || ''));
    assert.equal(body.api_name, '/readdata/detail');
    assert.equal(body.mode, 'weekly');
    return jsonResponse({
      readTimes: { [dateKeyToTimestampSec(TODAY)]: seconds },
    });
  };
  const { app } = tempApp(t, fetchImpl);
  app.store.updateSettings({ wereadApiKey: KEY });

  const below = await app.services.overview.autoCheckinOnly({ refresh: true });
  assert.equal(below.configured, true);
  assert.equal(below.minutes, 29);
  assert.equal(below.checkedIn, false);
  assert.equal(below.changed, false);
  assert.equal(app.services.checkins.loadRows().length, 0);

  seconds = 30 * 60;
  const reach = await app.services.overview.autoCheckinOnly({ refresh: true });
  assert.equal(reach.minutes, 30);
  assert.equal(reach.checkedIn, true);
  assert.equal(reach.changed, true);
  assert.equal(reach.source, 'auto');
  const rows = app.services.checkins.loadRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, TODAY);
  assert.equal(rows[0].minutes, 30);
  assert.equal(rows[0].source, 'auto');

  const again = await app.services.overview.autoCheckinOnly({ refresh: true });
  assert.equal(again.checkedIn, true);
  assert.equal(again.changed, false);
  assert.equal(app.services.checkins.loadRows().length, 1);
  assert.ok(calls.every((call) => call === '/readdata/detail:weekly'));
});

test('后台自动打卡：未配置 Key 时不发请求、不写记录', async (t) => {
  let called = false;
  const { app } = tempApp(t, async () => {
    called = true;
    return jsonResponse({});
  });
  const result = await app.services.overview.autoCheckinOnly({ refresh: true });
  assert.equal(result.configured, false);
  assert.equal(result.checkedIn, false);
  assert.equal(result.changed, false);
  assert.equal(called, false);
  assert.equal(app.services.checkins.loadRows().length, 0);
});

test('后台自动打卡：接口失败返回 error 且不影响已有数据', async (t) => {
  const { app } = tempApp(t, async () => {
    throw new TypeError('network down');
  });
  app.store.updateSettings({ wereadApiKey: KEY });
  const result = await app.services.overview.autoCheckinOnly({ refresh: true });
  assert.equal(result.configured, true);
  assert.equal(result.checkedIn, false);
  assert.equal(result.changed, false);
  assert.match(result.error, /无法连接微信读书服务/);
  assert.equal(app.services.checkins.loadRows().length, 0);
});
