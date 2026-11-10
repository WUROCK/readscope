/**
 * 科研文献：data/papers.json，状态流转（待读/在读/已读）与按页进度。
 */

import { randomUUID } from 'node:crypto';
import { badRequest, notFound, clamp, isoShanghai, normalizeTagList } from './util.mjs';

export const PAPER_STATUSES = Object.freeze(['todo', 'reading', 'done']);
const STATUS_ORDER = { reading: 0, todo: 1, done: 2 };
const MAX_TAGS = 12;

function assertTitle(value) {
  if (typeof value !== 'string' || !value.trim()) throw badRequest('文献标题不能为空');
  const title = value.trim();
  if (title.length > 300) throw badRequest('文献标题不能超过 300 个字符');
  return title;
}

function assertText(value, { field, max = 5000, fallback = '' } = {}) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') throw badRequest(`${field}必须是字符串`);
  const text = value.trim();
  if (text.length > max) throw badRequest(`${field}不能超过 ${max} 个字符`);
  return text;
}

function assertYear(value) {
  if (value === undefined || value === null || value === '') return null;
  if (!Number.isInteger(value) || value < 1000 || value > 3000) {
    throw badRequest('年份必须是 1000–3000 之间的整数或留空');
  }
  return value;
}

function assertStatus(value) {
  if (value === undefined || value === null) return 'todo';
  if (!PAPER_STATUSES.includes(value)) throw badRequest('状态必须是待读、在读或已读');
  return value;
}

function assertTotalPages(value) {
  if (value === undefined || value === null) return 0;
  if (!Number.isInteger(value) || value < 0) throw badRequest('总页数必须是不小于 0 的整数');
  if (value > 100000) throw badRequest('总页数不能超过 100000');
  return value;
}

function assertCurrentPage(value, totalPages) {
  if (value === undefined || value === null) return 0;
  if (!Number.isInteger(value) || value < 0) throw badRequest('当前页必须是不小于 0 的整数');
  if (totalPages > 0 && value > totalPages) throw badRequest('当前页不能大于总页数');
  if (totalPages === 0 && value > 0) throw badRequest('总页数为 0 时当前页必须为 0');
  return value;
}

function assertTags(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw badRequest('标签必须是字符串数组');
  return normalizeTagList(value, { max: MAX_TAGS });
}

function progressOf(status, currentPage, totalPages) {
  if (status === 'done') return 100;
  if (totalPages <= 0) return 0;
  return clamp(Math.round((currentPage / totalPages) * 100), 0, 100);
}

function decorate(paper) {
  const totalPages = Number.isInteger(paper.totalPages) && paper.totalPages >= 0 ? paper.totalPages : 0;
  const status = PAPER_STATUSES.includes(paper.status) ? paper.status : 'todo';
  const currentPage =
    status === 'done' && totalPages > 0
      ? totalPages
      : clamp(Number.isInteger(paper.currentPage) ? paper.currentPage : 0, 0, Math.max(totalPages, 0));
  return {
    id: paper.id,
    title: String(paper.title || '').trim(),
    venue: String(paper.venue || '').trim(),
    year: Number.isInteger(paper.year) ? paper.year : null,
    url: String(paper.url || '').trim(),
    doi: String(paper.doi || '').trim(),
    summary: String(paper.summary || '').trim(),
    status,
    tags: normalizeTagList(paper.tags, { max: MAX_TAGS }),
    totalPages,
    currentPage,
    progress: progressOf(status, currentPage, totalPages),
    addedAt: paper.addedAt || '',
    updatedAt: paper.updatedAt || '',
    finishedAt: status === 'done' ? paper.finishedAt || null : null,
  };
}

function sortItems(items) {
  return [...items].sort((a, b) => {
    const orderDiff = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
    if (orderDiff !== 0) return orderDiff;
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  });
}

/**
 * @param {{ store: ReturnType<import('./store.mjs').createStore>, now?: () => Date }} deps
 */
export function createPapersService({ store, now = () => new Date() }) {
  function readAll() {
    return store.readPapers().items.map(decorate);
  }

  function list() {
    const items = sortItems(readAll());
    const counts = { todo: 0, reading: 0, done: 0 };
    const tagCounter = new Map();
    for (const item of items) {
      counts[item.status] += 1;
      for (const tag of item.tags) tagCounter.set(tag, (tagCounter.get(tag) || 0) + 1);
    }
    return {
      items,
      stats: {
        todo: counts.todo,
        reading: counts.reading,
        done: counts.done,
        total: items.length,
      },
      tagCounts: [...tagCounter.entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-CN')),
    };
  }

  function create(body) {
    const input = body && typeof body === 'object' ? body : {};
    const title = assertTitle(input.title);
    const status = assertStatus(input.status);
    const totalPages = assertTotalPages(input.totalPages);
    let currentPage = assertCurrentPage(input.currentPage, totalPages);
    if (status === 'done') currentPage = totalPages > 0 ? totalPages : 0;
    const timestamp = isoShanghai(now());
    const paper = decorate({
      id: `pp_${randomUUID()}`,
      title,
      venue: assertText(input.venue, { field: '期刊/会议', max: 200 }),
      year: assertYear(input.year),
      url: assertText(input.url, { field: '链接', max: 2000 }),
      doi: assertText(input.doi, { field: 'DOI', max: 200 }),
      summary: assertText(input.summary, { field: '摘要', max: 5000 }),
      status,
      tags: assertTags(input.tags),
      totalPages,
      currentPage,
      addedAt: timestamp,
      updatedAt: timestamp,
      finishedAt: status === 'done' ? timestamp : null,
    });
    const items = store.readPapers().items;
    items.push(paper);
    store.writePapers(items);
    return { item: paper };
  }

  function patch(id, body) {
    const input = body && typeof body === 'object' ? body : {};
    const data = store.readPapers();
    const index = data.items.findIndex((item) => item.id === id);
    if (index < 0) throw notFound('文献不存在');
    const existing = decorate(data.items[index]);

    const status = input.status === undefined ? existing.status : assertStatus(input.status);
    const totalPages =
      input.totalPages === undefined ? existing.totalPages : assertTotalPages(input.totalPages);
    let currentPage;
    if (status === 'done') {
      currentPage = totalPages > 0 ? totalPages : 0;
    } else if (input.currentPage === undefined) {
      currentPage = clamp(existing.currentPage, 0, Math.max(totalPages, 0));
    } else {
      currentPage = assertCurrentPage(input.currentPage, totalPages);
    }

    let finishedAt = existing.finishedAt || null;
    if (status === 'done') {
      if (!finishedAt) finishedAt = isoShanghai(now());
    } else {
      finishedAt = null;
    }

    const next = decorate({
      ...existing,
      title: input.title === undefined ? existing.title : assertTitle(input.title),
      venue: input.venue === undefined ? existing.venue : assertText(input.venue, { field: '期刊/会议', max: 200 }),
      year: input.year === undefined ? existing.year : assertYear(input.year),
      url: input.url === undefined ? existing.url : assertText(input.url, { field: '链接', max: 2000 }),
      doi: input.doi === undefined ? existing.doi : assertText(input.doi, { field: 'DOI', max: 200 }),
      summary: input.summary === undefined ? existing.summary : assertText(input.summary, { field: '摘要', max: 5000 }),
      status,
      tags: input.tags === undefined ? existing.tags : assertTags(input.tags),
      totalPages,
      currentPage,
      updatedAt: isoShanghai(now()),
      finishedAt,
    });

    data.items[index] = next;
    store.writePapers(data.items);
    return { item: next };
  }

  function remove(id) {
    const data = store.readPapers();
    const nextItems = data.items.filter((item) => item.id !== id);
    if (nextItems.length === data.items.length) throw notFound('文献不存在');
    store.writePapers(nextItems);
    return { ok: true };
  }

  return { list, create, patch, remove };
}

export { decorate as decoratePaper };
