import type { DomainId, ManualBook, WereadBook } from './types';

export type ReadingSource = 'weread' | 'manual';

export interface ReadingItem {
  key: string;
  source: ReadingSource;
  title: string;
  author: string;
  cover: string | null;
  domain: DomainId;
  domainName: string;
  progress: number;
  finished: boolean;
  tags: string[];
  minutes: number | null;
  currentPage: number | null;
  totalPages: number | null;
  lastActiveAt: string | null;
  readerLink: string | null;
  weread: WereadBook | null;
  manual: ManualBook | null;
}

export interface TagCount {
  tag: string;
  count: number;
}

/** 石墨底 + 极轻琥珀高光的封面渐变，按领域稳定取色。 */
const COVER_GRADIENTS: Record<DomainId, string> = {
  literature: 'linear-gradient(145deg, #3a3427, #121419)',
  humanities: 'linear-gradient(145deg, #35352c, #11151b)',
  business: 'linear-gradient(145deg, #403924, #141519)',
  tech: 'linear-gradient(145deg, #2b3233, #0d1014)',
  psychology: 'linear-gradient(145deg, #383229, #121419)',
  arts: 'linear-gradient(145deg, #3d3528, #121418)',
  education: 'linear-gradient(145deg, #2f3531, #101419)',
  other: 'linear-gradient(145deg, #34363a, #111318)',
};

export function coverGradient(domain: DomainId): string {
  return COVER_GRADIENTS[domain] ?? COVER_GRADIENTS.other;
}

function cleanTags(tags: unknown, fallback: string[]): string[] {
  const source = Array.isArray(tags) ? tags : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of [...source, ...fallback]) {
    const tag = String(value ?? '').trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
    if (result.length >= 6) break;
  }
  return result;
}

export function wereadBookTags(book: WereadBook): string[] {
  const tags = cleanTags(book.tags, []);
  return tags.length > 0 ? tags : cleanTags([], [book.domainName, book.category]);
}

export function manualBookTags(book: ManualBook): string[] {
  const tags = cleanTags(book.tags, []);
  return tags.length > 0 ? tags : cleanTags([], [book.domainName]);
}

function toWereadItem(book: WereadBook): ReadingItem {
  return {
    key: book.id,
    source: 'weread',
    title: book.title || '未命名书籍',
    author: book.author || '未知作者',
    cover: book.cover,
    domain: book.domain,
    domainName: book.domainName,
    progress: Math.max(0, Math.min(100, Math.round(book.progress || 0))),
    finished: Boolean(book.finished),
    tags: wereadBookTags(book),
    minutes: Number(book.readingMinutes) || 0,
    currentPage: null,
    totalPages: null,
    lastActiveAt: book.lastReadAt,
    readerLink: book.readerLink,
    weread: book,
    manual: null,
  };
}

function toManualItem(book: ManualBook): ReadingItem {
  const finished = book.totalPages > 0 && book.currentPage >= book.totalPages;
  return {
    key: book.id,
    source: 'manual',
    title: book.title || '未命名书籍',
    author: book.author || '手动书单',
    cover: null,
    domain: book.domain,
    domainName: book.domainName,
    progress: finished ? 100 : Math.min(99, Math.max(0, Math.round(book.currentPage / Math.max(1, book.totalPages) * 100))),
    finished,
    tags: manualBookTags(book),
    minutes: null,
    currentPage: book.currentPage,
    totalPages: book.totalPages,
    lastActiveAt: book.updatedAt || book.addedAt,
    readerLink: null,
    weread: null,
    manual: book,
  };
}

/** 微信读书 + 手动书单合并，按最近活动时间倒序。 */
export function mergeReadingItems(wereadBooks: WereadBook[], manualBooks: ManualBook[]): ReadingItem[] {
  const items = [
    ...(Array.isArray(wereadBooks) ? wereadBooks.map(toWereadItem) : []),
    ...(Array.isArray(manualBooks) ? manualBooks.map(toManualItem) : []),
  ];
  const activityTime = (item: ReadingItem) => {
    const value = Date.parse(item.lastActiveAt ?? '');
    return Number.isFinite(value) ? value : 0;
  };
  return items.sort((a, b) => activityTime(b) - activityTime(a));
}

/** 已保存的优先顺序在前；新增书籍仍按最近阅读顺序加入尾部。 */
export function applyReadingOrder(items: ReadingItem[], order: string[]): ReadingItem[] {
  const ranks = new Map(order.map((key, index) => [key, index]));
  return [...items].sort((a, b) => (ranks.get(a.key) ?? order.length) - (ranks.get(b.key) ?? order.length));
}

/** A completed book is kept in history, outside the active reading list. */
export function partitionReadingItems(items: ReadingItem[]) {
  return { reading: items.filter(item => !item.finished), finished: items.filter(item => item.finished) };
}

/** 列表下方聚合标签：count 为包含该标签的书籍数。 */
export function aggregateTags(items: ReadingItem[]): TagCount[] {
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const item of items) {
    for (const tag of item.tags) {
      if (!counts.has(tag)) order.push(tag);
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return order
    .map((tag) => ({ tag, count: counts.get(tag) ?? 0 }))
    .sort((a, b) => b.count - a.count || order.indexOf(a.tag) - order.indexOf(b.tag))
    .slice(0, 12);
}

export function itemHasTag(item: ReadingItem, tag: string | null): boolean {
  return !tag || item.tags.includes(tag);
}

/** 行内只展示 3 个标签，保留领域作为最后兜底。 */
export function rowTagList(item: ReadingItem, max = 3): string[] {
  return item.tags.slice(0, max);
}
