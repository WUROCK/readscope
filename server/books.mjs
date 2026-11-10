/**
 * 手动书单：按页数记录纸质书进度（data/books.json）。
 * 进度按页数四舍五入为 0-100 整数；阅读速度按 0.6 页/分钟估算剩余时间。
 */

import { randomUUID } from 'node:crypto';
import { badRequest, notFound, clamp, isoShanghai, normalizeTagList } from './util.mjs';
import { domainName, isDomainId } from './domains.mjs';
import { deriveManualTags, mergeBookTags } from './tags.mjs';

export const PAGES_PER_MINUTE = 0.6;
const MAX_TAGS = 6;

function assertTitle(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest('书名不能为空');
  }
  const title = value.trim();
  if (title.length > 200) throw badRequest('书名不能超过 200 个字符');
  return title;
}

function assertTotalPages(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw badRequest('总页数必须大于 0');
  }
  if (value > 100000) throw badRequest('总页数不能超过 100000');
  return value;
}

function assertCurrentPage(value, totalPages) {
  if (!Number.isInteger(value) || value < 0 || value > totalPages) {
    throw badRequest('当前页必须在 0 到总页数之间');
  }
  return value;
}

function assertAuthor(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw badRequest('作者必须是字符串');
  const author = value.trim();
  if (author.length > 100) throw badRequest('作者不能超过 100 个字符');
  return author;
}

function assertDomain(value) {
  if (value === undefined || value === null || value === '') return 'other';
  if (!isDomainId(value)) throw badRequest('领域必须是 8 个固定领域之一');
  return value;
}

function assertTags(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw badRequest('标签必须是字符串数组');
  const tags = normalizeTagList(value, { max: MAX_TAGS });
  return tags;
}

/** 旧数据没有 userTags 时，从 tags 中剥离自动标签，尽量还原用户标签 */
function resolveUserTags(book, label) {
  if (Array.isArray(book.userTags)) return normalizeTagList(book.userTags, { max: MAX_TAGS });
  const autoTags = deriveManualTags({
    title: book.title,
    author: book.author,
    domain: book.domain,
    domainName: label,
  });
  const autoKeys = new Set(autoTags.map((tag) => tag.toLowerCase()));
  return normalizeTagList(book.tags, { max: MAX_TAGS }).filter((tag) => !autoKeys.has(tag.toLowerCase()));
}

/**
 * 计算对外字段（保证 progress / finished / 估算时长一致）。
 * tags = 自动推导标签（领域 + 标题/作者关键词）+ 用户标签，最多 6 个。
 * 内部字段 userTags 不返回给 Web。
 */
function decorate(book) {
  const totalPages = Math.max(1, Number(book.totalPages) || 1);
  const currentPage = clamp(Number(book.currentPage) || 0, 0, totalPages);
  const finished = currentPage >= totalPages;
  const domain = isDomainId(book.domain) ? book.domain : 'other';
  const label = domainName(domain);
  const title = String(book.title || '').trim() || '未命名';
  const author = String(book.author || '').trim();
  const userTags = resolveUserTags(book, label);
  const tags = mergeBookTags(deriveManualTags({ title, author, domain, domainName: label }), userTags);
  return {
    id: book.id,
    title,
    author,
    totalPages,
    currentPage,
    progress: finished ? 100 : Math.min(99, Math.round((currentPage / totalPages) * 100)),
    finished,
    domain,
    domainName: label,
    tags,
    estimatedMinutesRemaining: finished ? 0 : Math.ceil((totalPages - currentPage) / PAGES_PER_MINUTE),
    addedAt: book.addedAt || '',
    updatedAt: book.updatedAt || '',
    finishedAt: book.finishedAt || null,
  };
}

function sortItems(items) {
  return [...items].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

/**
 * @param {{ store: ReturnType<import('./store.mjs').createStore>, now?: () => Date }} deps
 */
export function createBooksService({ store, now = () => new Date() }) {
  function list() {
    const items = store.readBooks().items.map(decorate);
    return {
      items: sortItems(items),
      stats: {
        reading: items.filter((item) => !item.finished).length,
        finished: items.filter((item) => item.finished).length,
        totalPagesRead: items.reduce((sum, item) => sum + item.currentPage, 0),
      },
    };
  }

  function create(body) {
    const input = body && typeof body === 'object' ? body : {};
    const title = assertTitle(input.title);
    const author = assertAuthor(input.author);
    const totalPages = assertTotalPages(input.totalPages);
    const currentPage = assertCurrentPage(input.currentPage === undefined ? 0 : input.currentPage, totalPages);
    const domain = assertDomain(input.domain);
    const userTags = assertTags(input.tags);
    const autoTags = deriveManualTags({ title, author, domain, domainName: domainName(domain) });
    const tags = mergeBookTags(autoTags, userTags);
    const timestamp = isoShanghai(now());
    const finished = currentPage >= totalPages;
    const book = {
      id: `bk_${randomUUID()}`,
      title,
      author,
      totalPages,
      currentPage,
      domain,
      // 自动标签 + 用户标签的合并结果直接持久化；userTags 仅内部保留，便于编辑时恢复用户输入。
      tags,
      userTags,
      addedAt: timestamp,
      updatedAt: timestamp,
      finishedAt: finished ? timestamp : null,
    };
    const items = store.readBooks().items;
    items.push(book);
    store.writeBooks(items);
    return { item: decorate(book) };
  }

  function patch(id, body) {
    const input = body && typeof body === 'object' ? body : {};
    const data = store.readBooks();
    const index = data.items.findIndex((item) => item.id === id);
    if (index < 0) throw notFound('书籍不存在');
    const existing = data.items[index];

    const totalPages =
      input.totalPages === undefined ? Math.max(1, Number(existing.totalPages) || 1) : assertTotalPages(input.totalPages);
    const currentPage =
      input.currentPage === undefined
        ? clamp(Number(existing.currentPage) || 0, 0, totalPages)
        : assertCurrentPage(input.currentPage, totalPages);
    if (input.currentPage === undefined && currentPage > totalPages) {
      throw badRequest('当前页不能大于总页数');
    }

    const wasFinished = currentPage >= totalPages;
    const previousFinished = Boolean(existing.finished) || Number(existing.currentPage) >= Number(existing.totalPages);
    let finishedAt = existing.finishedAt || null;
    if (wasFinished && !previousFinished) finishedAt = isoShanghai(now());
    if (!wasFinished) finishedAt = null;

    const title = input.title === undefined ? existing.title : assertTitle(input.title);
    const author = input.author === undefined ? existing.author || '' : assertAuthor(input.author);
    const domain = input.domain === undefined ? existing.domain : assertDomain(input.domain);
    const userTags =
      input.tags === undefined
        ? resolveUserTags(existing, domainName(isDomainId(existing.domain) ? existing.domain : 'other'))
        : assertTags(input.tags);
    const tags = mergeBookTags(
      deriveManualTags({ title, author, domain, domainName: domainName(isDomainId(domain) ? domain : 'other') }),
      userTags,
    );
    const next = {
      ...existing,
      title,
      author,
      totalPages,
      currentPage,
      domain,
      tags,
      userTags,
      updatedAt: isoShanghai(now()),
      finishedAt,
    };

    data.items[index] = next;
    store.writeBooks(data.items);
    return { item: decorate(next) };
  }

  function remove(id) {
    const data = store.readBooks();
    const nextItems = data.items.filter((item) => item.id !== id);
    if (nextItems.length === data.items.length) throw notFound('书籍不存在');
    store.writeBooks(nextItems);
    return { ok: true };
  }

  return { list, create, patch, remove };
}

export { decorate as decorateManualBook };
