import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ title, description, actionLabel, onAction, icon, compact }: EmptyStateProps) {
  return (
    <div className={`empty-state${compact ? ' is-compact' : ''}`}>
      {icon ? <span className="empty-state__icon">{icon}</span> : null}
      <p className="empty-state__title">{title}</p>
      {description ? <p className="empty-state__desc">{description}</p> : null}
      {actionLabel && onAction ? (
        <button type="button" className="btn btn-secondary btn-sm empty-state__action" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
