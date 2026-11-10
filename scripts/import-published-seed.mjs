import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCrossrefCandidates } from '../server/sources/crossref.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = process.argv[2];
if (!input) throw new Error('Pass a JSON array of public Crossref work records. Add --write to update the bundled seed.');
const raw = JSON.parse(fs.readFileSync(input, 'utf8').replace(/^\uFEFF/, ''));
const candidates = parseCrossrefCandidates(raw, { now: new Date() });
const identifiers = new Set();
const items = candidates.filter((item) => {
  if (identifiers.has(item.publicationDoi)) return false;
  identifiers.add(item.publicationDoi);
  return true;
}).slice(0, 36).map((item) => ({
  title: item.title, venue: item.venue, year: item.publicationYear, url: item.url,
  summary: item.summary, tags: item.tags, language: item.language,
  publicationYear: item.publicationYear, publicationDoi: item.publicationDoi,
  publicationUrl: item.publicationUrl, venueSource: 'crossref', venueStatus: 'published',
  evidenceUrl: `https://api.crossref.org/works/${encodeURIComponent(item.publicationDoi)}`,
}));
if (items.length < 10) throw new Error('Fewer than ten relevant published records; keeping the existing seed.');
if (process.argv.includes('--write')) fs.writeFileSync(path.join(root, 'data', 'seed', 'curated_papers.json'), JSON.stringify(items, null, 2) + '\n');
console.log(JSON.stringify({ verified: items.length, venues: [...new Set(items.map((item) => item.venue))], written: process.argv.includes('--write') }, null, 2));
