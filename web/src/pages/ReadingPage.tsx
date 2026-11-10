import { useEffect, useMemo, useRef, useState } from 'react';
import { aggregateTags, applyReadingOrder, itemHasTag, partitionReadingItems, mergeReadingItems } from '../lib/books';
import { formatDateCN, greetingFor } from '../lib/format';
import type { ManualBook, WereadBook, WereadOverview } from '../lib/types';
import { EmptyState } from '../components/EmptyState';
import { IconBookOpen, IconPlus, IconRefresh } from '../components/Icons';
import { ReadingRow } from '../components/ReadingRow';

export interface ReadingPageProps {
  loading: boolean;
  booksLoading: boolean;
  overview: WereadOverview;
  manualBooks: ManualBook[];
  readingOrder: string[];
  onReadingOrderChange: (order: string[]) => Promise<boolean>;
  refreshing: boolean;
  onRefresh: () => void;
  onAddBook: () => void;
  onEditBook: (book: ManualBook) => void;
  onOpenBook: (book: WereadBook) => void;
}

function ReadingSkeleton() {
  return (
    <div className="page">
      <div className="page-stack">
        <div className="today-line skeleton-line">
          <span className="sk sk-line sk-w40" />
          <span className="sk sk-bar" />
        </div>
        <span className="sk sk-input" />
        <div className="reading-section skeleton-panel">
          <span className="sk sk-line sk-w30" />
          <span className="sk sk-row" />
          <span className="sk sk-row" />
          <span className="sk sk-row" />
        </div>
      </div>
    </div>
  );
}

/** 第一页：在读。细腻目标行 + 快速添加条 + 扁平合并书单。 */
export function ReadingPage({
  loading,
  booksLoading,
  overview,
  manualBooks,
  readingOrder,
  onReadingOrderChange,
  refreshing,
  onRefresh,
  onAddBook,
  onEditBook,
  onOpenBook,
}: ReadingPageProps) {
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [finishedOpen, setFinishedOpen] = useState(false);
  const finishedList = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (finishedOpen) finishedList.current?.scrollIntoView({ block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [finishedOpen]);
  const [sorting, setSorting] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const today = overview.today;
  const isError = overview.source === 'error' || Boolean(overview.error);
  const { reading: allItems, finished: finishedItems } = useMemo(
    () => partitionReadingItems(applyReadingOrder(mergeReadingItems(overview.books, manualBooks), readingOrder)),
    [overview.books, manualBooks, readingOrder],
  );
  const tagCounts = useMemo(() => aggregateTags(allItems), [allItems]);
  const visibleItems = useMemo(
    () => allItems.filter((item) => itemHasTag(item, tagFilter)),
    [allItems, tagFilter],
  );
  const displayedItems = sorting ? allItems : tagFilter || expanded ? visibleItems : visibleItems.slice(0, 4);

  async function moveBook(key: string, target: number) {
    if (savingOrder || target < 0 || target >= allItems.length) return;
    const order = allItems.map(item => item.key);
    const from = order.indexOf(key);
    if (from < 0 || from === target) return;
    order.splice(from, 1);
    order.splice(target, 0, key);
    setSavingOrder(true);
    try {
      const active = new Set(order);
      await onReadingOrderChange([...order, ...readingOrder.filter(key => !active.has(key))]);
    } finally { setSavingOrder(false); setDraggedKey(null); }
  }

  useEffect(() => {
    if (tagFilter && !tagCounts.some((item) => item.tag === tagFilter)) setTagFilter(null);
  }, [tagFilter, tagCounts]);

  const greeting = greetingFor(new Date().getHours());
  const goalPercent = Math.max(0, Math.min(100, today.goalPercent));
  const checkinMarker =
    today.goalMinutes > 0
      ? Math.max(0, Math.min(100, (today.checkinMinutes / today.goalMinutes) * 100))
      : 0;
  const checkinGap = Math.max(0, today.remainingToCheckin);

  if (loading) return <ReadingSkeleton />;

  return (
    <div className="page">
      <div className="page-stack">
        <section className="today-line" aria-label="今日阅读状态">
          <div className="today-line__greeting">
            <span className="today-line__hello">{greeting}</span>
            <span className="today-line__dot" aria-hidden="true" />
            <span className="today-line__date">{formatDateCN(today.date)}</span>
          </div>
          <span className="goal-track" aria-hidden="true">
            <span className="goal-fill" style={{ width: `${goalPercent}%` }} />
            <span className="goal-marker" style={{ left: `${checkinMarker}%` }} />
          </span>
          <span className="goal-numbers">
            {today.minutes} / {today.goalMinutes} 分钟
          </span>
          <span className={`checkin-pill${today.checkedIn ? ' is-checked' : ''}`}>
            <span className="checkin-pill__dot" aria-hidden="true" />
            {today.checkedIn ? '已打卡' : `距打卡 ${checkinGap} 分钟`}
          </span>
        </section>

        <section className="reading-section" aria-label="在读书籍">
          <header className="section-head">
            <div className="section-head__title">
              <h2>在读</h2>
              <span className="section-count">{visibleItems.length} 本</span>
              {tagFilter ? (
                <button
                  type="button"
                  className="filter-chip"
                  onClick={() => setTagFilter(null)}
                  aria-label={`清除标签筛选 ${tagFilter}`}
                >
                  {tagFilter}
                  <span aria-hidden="true">×</span>
                </button>
              ) : null}
            </div>
            <div className="reading-actions">
              {allItems.length > 1 ? (
                <button type="button" className="text-btn" aria-pressed={sorting}
                  disabled={savingOrder} onClick={() => { setSorting(!sorting); setTagFilter(null); }}>
                  {sorting ? '完成排序' : '排序'}
                </button>
              ) : null}
              <button type="button" className="quick-add" onClick={onAddBook} aria-label="添加书籍">
                <IconPlus size={14} />
                添加书籍
              </button>
            </div>
          </header>
          {sorting ? <div className="sort-help" role="status" aria-live="polite">
            <span>{savingOrder ? '正在保存顺序…' : '拖动书籍或点击上下按钮，顺序自动保存'}</span>
            {readingOrder.length ? <button className="text-btn" disabled={savingOrder} onClick={async () => {
              setSavingOrder(true);
              try { await onReadingOrderChange([]); } finally { setSavingOrder(false); }
            }}>恢复最近阅读</button> : null}
          </div> : null}

          {allItems.length === 0 ? (
            <EmptyState
              icon={<IconBookOpen size={24} />}
              title={finishedItems.length ? '当前没有在读的书' : '还没有在读的书'}
              description={finishedItems.length ? '已读完的书保留在下方，可随时查看或修正进度。' : '把微信读书或纸质书加进来，进度会汇总在这里。'}
              actionLabel="添加书籍"
              onAction={onAddBook}
            />
          ) : booksLoading ? (
            <div className="reading-list" aria-busy="true">
              <span className="sk sk-row" />
              <span className="sk sk-row" />
              <span className="sk sk-row" />
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="list-empty">
              <p>没有带「{tagFilter}」标签的书。</p>
              <button type="button" className="text-btn" onClick={() => setTagFilter(null)}>
                清除筛选
              </button>
            </div>
          ) : (
            <div className="reading-list" aria-busy={savingOrder}>
              {displayedItems.map((item, index) => (
                <div key={item.key} className={`sortable-book${sorting ? ' is-sorting' : ''}${draggedKey === item.key ? ' is-dragging' : ''}`}
                  data-book-key={item.key} data-no-swipe={sorting ? '' : undefined}
                  draggable={sorting && !savingOrder}
                  onDragStart={event => {
                    event.dataTransfer.setData('text/plain', item.key);
                    event.dataTransfer.effectAllowed = 'move';
                    setDraggedKey(item.key);
                  }}
                  onDragOver={event => { if (sorting && draggedKey && !savingOrder) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }}
                  onDrop={event => { event.preventDefault(); if (sorting && draggedKey) void moveBook(draggedKey, index); }}
                  onDragEnd={() => setDraggedKey(null)}>
                {sorting ? <div className="sort-controls" role="group" aria-label={`调整《${item.title}》顺序`}>
                  <button type="button" aria-label={`上移《${item.title}》`} title="上移" disabled={savingOrder || index === 0}
                    onClick={() => { void moveBook(item.key, index - 1); }}>↑</button>
                  <button type="button" aria-label={`下移《${item.title}》`} title="下移" disabled={savingOrder || index === allItems.length - 1}
                    onClick={() => { void moveBook(item.key, index + 1); }}>↓</button>
                </div> : null}
                <div className="sortable-book__content" inert={sorting} onClickCapture={sorting ? event => { event.preventDefault(); event.stopPropagation(); } : undefined}>
                <ReadingRow
                  item={item}
                  onOpen={() => {
                    if (item.weread) onOpenBook(item.weread);
                  }}
                  onEdit={onEditBook}
                />
                </div>
                </div>
              ))}
              {!sorting && !tagFilter && visibleItems.length > 4 ? (
                <div className="list-toggle">
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => setExpanded((current) => !current)}
                  >
                    {expanded ? '收起列表' : `查看全部 ${visibleItems.length} 本`}
                  </button>
                </div>
              ) : null}
            </div>
          )}

          {!sorting && tagCounts.length > 0 ? (
            <div className="tag-cloud">
              <div className="tag-cloud__head">
                <span className="eyebrow">按标签筛选</span>
                {tagFilter ? (
                  <button type="button" className="text-btn" onClick={() => setTagFilter(null)}>
                    清除
                  </button>
                ) : null}
              </div>
              <div className="tag-cloud__chips" role="group" aria-label="按标签筛选书籍">
                {tagCounts.map(({ tag, count }) => {
                  const active = tagFilter === tag;
                  return (
                    <button
                      type="button"
                      key={tag}
                      className={`tag-chip${active ? ' is-active' : ''}`}
                      aria-pressed={active}
                      aria-label={`${tag}，${count} 本`}
                      onClick={() => setTagFilter(active ? null : tag)}
                    >
                      {tag}
                      <span className="tag-chip__count">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </section>

        {!booksLoading && finishedItems.length > 0 ? <section className="finished-section" aria-label="已读完书籍">
          <button type="button" className="finished-toggle" aria-expanded={finishedOpen} aria-controls="finished-books"
            onClick={() => setFinishedOpen(!finishedOpen)}>
            <span>已读完 <span className="section-count">{finishedItems.length} 本</span></span>
            <span>{finishedOpen ? '收起' : '查看'}</span>
          </button>
          {finishedOpen ? <div id="finished-books" className="reading-list" ref={finishedList}>
            {finishedItems.map(item => <ReadingRow key={item.key} item={item}
              onOpen={() => { if(item.weread) onOpenBook(item.weread); }} onEdit={onEditBook} />)}
          </div> : null}
        </section> : null}

        {isError ? (
          <p className="inline-error">
            同步失败{overview.error ? ` · ${overview.error}` : ''}
            <button
              type="button"
              className="text-btn"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label="重试同步"
            >
              <IconRefresh size={11} className={refreshing ? 'spin' : undefined} />
              重试
            </button>
          </p>
        ) : null}
      </div>
    </div>
  );
}
