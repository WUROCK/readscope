import { createContext, useContext } from 'react';
import { IconAlertTriangle, IconCheckCircle, IconInfo } from './Icons';

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

export type ShowToast = (message: string, kind?: ToastKind) => void;

export const ToastContext = createContext<ShowToast>(() => {
  /* 默认空实现：在 Provider 之外调用时静默 */
});

export function useToast(): ShowToast {
  return useContext(ToastContext);
}

function ToastIcon({ kind }: { kind: ToastKind }) {
  if (kind === 'success') return <IconCheckCircle size={14} />;
  if (kind === 'error') return <IconAlertTriangle size={14} />;
  return <IconInfo size={14} />;
}

export function ToastViewport({ toasts }: { toasts: ToastItem[] }) {
  return (
    <div className="toast-stack" role="status" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div className={`toast toast--${toast.kind}`} key={toast.id}>
          <span className="toast__icon">
            <ToastIcon kind={toast.kind} />
          </span>
          <span className="toast__text">{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
