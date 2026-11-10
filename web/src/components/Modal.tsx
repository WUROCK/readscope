import { useEffect, useId, useRef, type ReactNode } from 'react';
import { IconAlertTriangle, IconClose } from './Icons';

export type ModalSize = 'settings' | 'form' | 'confirm';

export interface ModalProps {
  title: string;
  subtitle?: string;
  size?: ModalSize;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  className?: string;
}

/** 同一时刻只让最上层弹窗响应 Esc / Tab。 */
const modalStack: symbol[] = [];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ title, subtitle, size = 'form', children, footer, onClose, className }: ModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const token = Symbol('modal');
    modalStack.push(token);
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const card = cardRef.current;

    const preferred = card?.querySelector<HTMLElement>('[data-autofocus]');
    if (preferred) preferred.focus();
    else card?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== token) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !card) return;
      const focusables = [...card.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => element.offsetParent !== null || element === document.activeElement,
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!card.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const index = modalStack.indexOf(token);
      if (index >= 0) modalStack.splice(index, 1);
      previousFocus?.focus?.();
    };
  }, []);

  return (
    <div
      className={`modal-layer modal-layer--${size}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`modal-card modal-card--${size}${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={cardRef}
        tabIndex={-1}
      >
        <header className="modal-head">
          <div className="modal-head__text">
            <h2 className="modal-title" id={titleId}>
              {title}
            </h2>
            {subtitle ? <p className="modal-subtitle">{subtitle}</p> : null}
          </div>
          <button className="icon-btn modal-close" type="button" aria-label="关闭弹窗" onClick={onClose}>
            <IconClose size={16} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-foot">{footer}</footer> : null}
      </div>
    </div>
  );
}

export interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel = '删除',
  cancelLabel = '取消',
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Modal
      title={title}
      size="confirm"
      onClose={busy ? () => undefined : onCancel}
      footer={
        <>
          <button type="button" className="btn btn-secondary confirm-cancel" onClick={onCancel} disabled={busy} data-autofocus>
            {cancelLabel}
          </button>
          <button type="button" className="btn btn-danger confirm-ok" onClick={onConfirm} disabled={busy}>
            {busy ? <span className="spinner spinner--light" aria-hidden="true" /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="confirm-body">
        <span className="confirm-icon" aria-hidden="true">
          <IconAlertTriangle size={22} />
        </span>
        <p className="confirm-desc">{description}</p>
      </div>
    </Modal>
  );
}
