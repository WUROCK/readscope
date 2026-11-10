import { useEffect, useRef, useState, type FormEvent } from 'react';
import { DOMAINS } from '../lib/domains';
import { errorMessage } from '../lib/api';
import type { DomainId, ManualBook, ManualBookInput } from '../lib/types';
import { IconCheck, IconTrash } from './Icons';
import { ConfirmDialog, Modal } from './Modal';

export interface BookSaveResult { ok: boolean; error?: string; }
export interface BookModalProps {
  book: ManualBook | null;
  onClose: () => void;
  onSubmit: (input: ManualBookInput, id?: string) => Promise<BookSaveResult>;
  onDelete: (id: string) => Promise<boolean>;
}

/** Adding needs only a title and page count; editing starts with progress. */
export function BookModal({ book, onClose, onSubmit, onDelete }: BookModalProps) {
  const editing = Boolean(book);
  const pageInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editing) return;
    const frame = requestAnimationFrame(() => {
      pageInput.current?.focus();
      pageInput.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [editing]);
  const [title, setTitle] = useState(book?.title ?? '');
  const [author, setAuthor] = useState(book?.author ?? '');
  const [totalPages, setTotalPages] = useState(book ? String(book.totalPages) : '');
  const [currentPage, setCurrentPage] = useState(book ? String(book.currentPage) : '');
  const [domain, setDomain] = useState<DomainId>(book?.domain ?? 'other');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const totalNumber = totalPages.trim() ? Number(totalPages) : NaN;
  const currentNumber = currentPage.trim() ? Number(currentPage) : 0;
  const validTotal = Number.isInteger(totalNumber) && totalNumber >= 1 && totalNumber <= 100000;
  const validCurrent = Number.isInteger(currentNumber) && currentNumber >= 0 && currentNumber <= totalNumber;
  const completed = validTotal && validCurrent && currentNumber === totalNumber;
  const progress = validTotal && validCurrent
    ? completed ? 100 : Math.min(99, Math.round(currentNumber / totalNumber * 100)) : null;

  async function save(page = currentNumber) {
    if (savingRef.current || deleting) return;
    const nextErrors: Record<string, string> = {};
    if (!title.trim()) nextErrors.title = '请输入书名';
    if (!validTotal) nextErrors.totalPages = '总页数需为 1–100000 的整数';
    if (!Number.isInteger(page) || page < 0 || (validTotal && page > totalNumber)) {
      nextErrors.currentPage = '当前页需在 0 到总页数之间';
    }
    setErrors(nextErrors); setFormError(null);
    if (Object.keys(nextErrors).length) {
      if (editing && (nextErrors.title || nextErrors.totalPages)) setDetailsOpen(true);
      return;
    }
    savingRef.current = true; setSaving(true);
    try {
      const result = await onSubmit({ title: title.trim(), author: author.trim(),
        totalPages: totalNumber, currentPage: page, domain, tags: book?.tags ?? [] }, book?.id);
      if (result.ok) onClose();
      else setFormError(result.error || '保存失败，请稍后重试');
    } catch (error) {
      setFormError(errorMessage(error));
    } finally { savingRef.current = false; setSaving(false); }
  }

  function handleSubmit(event: FormEvent) { event.preventDefault(); void save(); }
  async function handleDelete() {
    if (!book || deleting) return;
    setDeleting(true);
    try { if (await onDelete(book.id)) { setConfirmDelete(false); onClose(); } }
    finally { setDeleting(false); }
  }

  const titleField = <div className="field">
    <label htmlFor="book-title">书名<span className="required" aria-hidden="true">*</span></label>
    <input id="book-title" type="text" value={title} maxLength={200} data-autofocus={!editing || undefined}
      placeholder="例如：远东冰原上的猫头鹰" aria-invalid={Boolean(errors.title)}
      onChange={event => setTitle(event.target.value)} />
    {errors.title ? <p className="field-error">{errors.title}</p> : null}
  </div>;
  const totalField = <div className="field">
    <label htmlFor="book-total">总页数<span className="required" aria-hidden="true">*</span></label>
    <input id="book-total" type="number" inputMode="numeric" min={1} max={100000} step={1}
      value={totalPages} placeholder="如 320" aria-invalid={Boolean(errors.totalPages)}
      onChange={event => setTotalPages(event.target.value)} />
    {errors.totalPages ? <p className="field-error">{errors.totalPages}</p> : null}
  </div>;
  const currentField = <div className="field">
    <label htmlFor="book-current">{editing ? '已读到第几页' : '已读到（选填）'}</label>
    <input ref={pageInput} id="book-current" type="text" inputMode="numeric" value={currentPage}
      data-autofocus={editing || undefined} onFocus={event => {
        const input = event.currentTarget;
        queueMicrotask(() => { if (document.activeElement === input) input.select(); });
      }}
      placeholder="不填则从第 0 页开始" aria-invalid={Boolean(errors.currentPage)}
      aria-describedby="book-progress-hint" onChange={event => setCurrentPage(event.target.value)} />
    {errors.currentPage ? <p className="field-error">{errors.currentPage}</p> : null}
  </div>;

  return <>
    <Modal title={editing ? '更新阅读进度' : '添加书籍'} size="form"
      subtitle={editing ? '输入当前页，按 Enter 保存' : '填写书名和总页数即可，封面自动生成'}
      onClose={() => { if (!savingRef.current && !deleting) onClose(); }}
      footer={<div className="modal-foot__row">
        {editing ? <button type="button" className="btn btn-danger-ghost" disabled={saving || deleting}
          onClick={() => setConfirmDelete(true)}><IconTrash size={13} />删除</button> : <span />}
        <div className="modal-foot__right">
          <button type="button" className="btn btn-secondary" disabled={saving || deleting} onClick={onClose}>取消</button>
          <button type="submit" form="book-form" className="btn btn-primary" disabled={saving || deleting}>
            {saving ? <span className="spinner" aria-hidden="true" /> : null}{editing ? '保存进度' : '加入书单'}
          </button>
        </div>
      </div>}>
      <form id="book-form" className="form-stack" onSubmit={handleSubmit} noValidate
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.target instanceof HTMLInputElement) {
            event.preventDefault();
            if (!editing && event.target.id === 'book-title' && title.trim() && !validTotal) {
              document.getElementById('book-total')?.focus();
            } else {
              void save();
            }
          }
        }}>
        {editing ? <div className="progress-book">
          <span className="progress-book__cover" aria-hidden="true">{title.slice(0, 1)}</span>
          <div><strong>{title}</strong><span>{author || '手动书籍'} · 共 {totalPages} 页</span></div>
        </div> : titleField}
        {editing ? currentField : <div className="field-row">{totalField}{currentField}</div>}
        <p id="book-progress-hint" className="form-hint" aria-live="polite">
          {progress === null ? '页数填写后会自动计算进度' : <><IconCheck size={11} />
            {completed ? '已读到最后一页 · 保存后归入已读完' : `当前进度 ${progress}% · 还剩 ${totalNumber - currentNumber} 页`}
          </>}
        </p>
        {editing ? <>
          <div className="progress-shortcuts" role="group" aria-label="快捷记进度">
            {[10, 20].map(pages => <button type="button" className="btn btn-secondary btn-sm" key={pages}
              aria-label={`增加 ${pages} 页并保存`} disabled={saving || deleting || !validTotal || !validCurrent || completed}
              onClick={() => { void save(Math.min(totalNumber, currentNumber + pages)); }}>+{pages} 页</button>)}
            <button type="button" className="btn btn-secondary btn-sm" disabled={saving || deleting || !validTotal || Boolean(book?.finished && completed && totalNumber === book.totalPages)}
              onClick={() => { void save(totalNumber); }}>标记读完</button>
          </div>
          <p className="form-tip">快捷按钮会直接保存；也可填写当前页后按 Enter。{book?.finished ? '改小页数可移回在读。' : ''}</p>
        </> : null}
        <button type="button" className="book-details-toggle text-btn" aria-expanded={detailsOpen}
          aria-controls="book-details" onClick={() => setDetailsOpen(!detailsOpen)}>
          {detailsOpen ? '收起书籍信息' : editing ? '编辑书籍信息' : '补充作者、领域（选填）'}
        </button>
        {detailsOpen ? <div id="book-details" className="form-stack">
          {editing ? <>{titleField}{totalField}</> : null}
          <div className="field"><label htmlFor="book-author">作者</label>
            <input id="book-author" type="text" value={author} maxLength={100} placeholder="选填"
              onChange={event => setAuthor(event.target.value)} />
          </div>
          <div className="field"><label id="book-domain-label">领域</label>
            <div className="domain-picker" role="group" aria-labelledby="book-domain-label">
              {DOMAINS.map(item => <button type="button" key={item.id}
                className={`domain-option${domain === item.id ? ' is-active' : ''}`} aria-pressed={domain === item.id}
                onClick={() => setDomain(item.id)}>{item.name}</button>)}
            </div>
          </div>
        </div> : null}
        {formError ? <p className="form-alert" role="alert">{formError}</p> : null}
      </form>
    </Modal>
    {confirmDelete && book ? <ConfirmDialog title="删除这本书？" description={`《${book.title}》的阅读进度会被一并删除，且不可恢复。`}
      confirmLabel="删除" busy={deleting} onCancel={() => setConfirmDelete(false)} onConfirm={() => { void handleDelete(); }} /> : null}
  </>;
}
