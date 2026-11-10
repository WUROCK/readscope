// Ten production API refreshes against public metadata, using isolated local data.
const { app, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'artifacts', 'recommendation-smoke');
for (const name of ['', 'profile', 'session']) fs.mkdirSync(path.join(output, name), { recursive: true });
require('../electron/logging.cjs').installFileLogging(path.join(output, 'run.log'));
const profile = fs.mkdtempSync(path.join(output, 'profile-'));
fs.mkdirSync(path.join(profile, 'session'));
app.setPath('userData', profile);
app.setPath('sessionData', path.join(profile, 'session'));
let server;
const results = [];
async function run() {
  await app.whenReady();
  const dataDir = fs.mkdtempSync(path.join(output, 'data-'));
  fs.cpSync(path.join(root, 'data', 'seed'), path.join(dataDir, 'seed'), { recursive: true });
  const { startServer } = await import(pathToFileURL(path.join(root, 'server', 'index.mjs')).href);
  server = await startServer({ port: 0, dataDir, fetchImpl: (url, options) => net.fetch(url, options) });
  const base = `http://127.0.0.1:${server.port}/api`;
  for (let index = 0; index < 10; index++) {
    const response = await net.fetch(`${base}/recommendations/refresh`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'paper' }),
      signal: AbortSignal.timeout(35000),
    });
    const data = await response.json();
    const item = data.item;
    if (!response.ok || !item || item.venueStatus !== 'published' || !item.publicationDoi || !item.venue) {
      throw new Error('Refresh did not return a verified publication: ' + JSON.stringify(data));
    }
    if (results.some((row) => row.doi === item.publicationDoi)) throw new Error('Duplicate publication');
    const record = { index: index + 1, title: item.title, venue: item.venue, year: item.publicationYear,
      doi: item.publicationDoi, source: item.source, evidence: item.publicationUrl };
    results.push(record);
    console.log('[recommendation-smoke]', JSON.stringify(record));
  }
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({ generatedAt: new Date().toISOString(), passed: results.length, failed: 0, results }, null, 2));
  await server.close();
  app.exit(0);
}
run().catch(async (error) => {
  console.error(error.stack);
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({ passed: results.length, failed: 1, error: error.stack, results }, null, 2));
  try { await server?.close(); } catch {}
  app.exit(1);
});
setTimeout(() => app.exit(2), 180000).unref();
