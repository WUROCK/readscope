import { coverGradient, rowTagList, type ReadingItem } from '../lib/books';
import { formatMinutes } from '../lib/format';
import type { ManualBook } from '../lib/types';
import { IconChevronRight } from './Icons';

export interface ReadingRowProps {
  item: ReadingItem;
  onOpen: (item: ReadingItem) => void;
  onEdit: (book: ManualBook) => void;
}

/** 合并列表行：封面、标题、来源、作者/标签、进度、时长或页数。 */
export function ReadingRow({ item, onOpen, onEdit }: ReadingRowProps) {
  const tags = rowTagList(item, 2);
  const meta =
    item.source === 'manual'
      ? `${item.currentPage ?? 0} / ${item.totalPages ?? 0} 页`
      : `累计 ${formatMinutes(item.minutes ?? 0)}`;

  function activate() {
    if (item.source === 'manual' && item.manual) onEdit(item.manual);
    else onOpen(item);
  }

  return (
    <div className={`reading-row-wrap${item.source === 'manual' ? ' has-action' : ''}`}>
      <button
        type="button"
        className="reading-row"
        title={item.title}
        onClick={activate}
        aria-label={
          item.source === 'weread' ? `打开《${item.title}》` : `编辑《${item.title}》`
        }
      >
        <span
          className="book-cover"
          style={{ background: coverGradient(item.domain) }}
          aria-hidden="true"
        >
          <span className="book-cover__char">{item.title.slice(0, 1)}</span>
          {item.cover ? (
            <img
              className="book-cover__img"
              src={item.cover}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={(event) => {
                event.currentTarget.style.display = 'none';
              }}
            />
          ) : null}
        </span>

        <span className="reading-row__body">
          <span className="reading-row__top">
            <span className="reading-row__title">{item.title}</span>
            {item.source === 'manual' ? (
              <span className="source-badge source-badge--manual">手动</span>
            ) : null}
          </span>

          <span className="reading-row__sub">
            <span className="reading-row__author">{item.author}</span>
            {tags.length > 0 ? (
              <span className="reading-row__tags">
                {tags.map((tag) => (
                  <span className="book-tag" key={tag}>
                    {tag}
                  </span>
                ))}
              </span>
            ) : null}
          </span>

          <span className="reading-row__bottom">
            <span className="progress-track">
              <span
                className={`progress-fill${item.finished ? ' is-finished' : ''}`}
                style={{ width: `${item.progress}%` }}
              />
            </span>
            <span className="reading-row__percent">{item.finished ? '已读完' : `${item.progress}%`}</span>
            <span className="reading-row__meta">{meta}</span>
          </span>
        </span>

        <span className="reading-row__chevron" aria-hidden="true">
          <IconChevronRight size={13} />
        </span>
      </button>

      {item.source === 'manual' && item.manual ? (
        <button
          type="button"
          className="reading-row__update"
          onClick={() => {
            if (item.manual) onEdit(item.manual);
          }}
          aria-label={`更新《${item.title}》阅读进度`}
        >
          更新
        </button>
      ) : null}
    </div>
  );
}
