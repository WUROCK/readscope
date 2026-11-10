import type { ReactNode } from 'react';

export interface IconProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

function BaseIcon({
  size = 18,
  className,
  strokeWidth = 1.7,
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function IconBookOpen(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M12 6.6C10.4 5.2 8.2 4.5 5 4.6v13c3.2-.1 5.4.6 7 2 1.6-1.4 3.8-2.1 7-2v-13c-3.2-.1-5.4.6-7 2Z" />
      <path d="M12 6.6v13" />
    </BaseIcon>
  );
}

export function IconGear(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 8.96 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z" />
    </BaseIcon>
  );
}

export function IconPin({ filled = false, ...props }: IconProps & { filled?: boolean }) {
  return (
    <BaseIcon {...props}>
      <path
        d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1Z"
        fill={filled ? 'currentColor' : 'none'}
        opacity={filled ? 0.92 : 1}
      />
      <path d="M12 17v5" />
    </BaseIcon>
  );
}

export function IconMinus(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M5 12h14" />
    </BaseIcon>
  );
}

export function IconExpand(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5" />
    </BaseIcon>
  );
}

export function IconCollapse(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M3 8h5V3M21 8h-5V3M16 21v-5h5M8 21v-5H3" />
    </BaseIcon>
  );
}

export function IconClose(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </BaseIcon>
  );
}

export function IconChevronLeft(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="m14.5 5-7 7 7 7" />
    </BaseIcon>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="m9.5 5 7 7-7 7" />
    </BaseIcon>
  );
}

export function IconRefresh(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M20 11a8 8 0 0 0-14.2-4.6L3.2 9" />
      <path d="M3.2 4.4V9h4.6" />
      <path d="M4 13a8 8 0 0 0 14.2 4.6l2.6-2.6" />
      <path d="M20.8 19.6V15h-4.6" />
    </BaseIcon>
  );
}

export function IconFlame(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M12 3c.5 2.7 2.1 3.9 3.4 5.5A7 7 0 0 1 17 13a5 5 0 0 1-10 0c0-1.9.9-3.3 2.1-4.5.4 1.4 1 2.2 1.9 2.8C11.4 9.3 11.7 6 12 3Z" />
    </BaseIcon>
  );
}

export function IconStamp(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="12" cy="12" r="8.6" strokeDasharray="2.1 2.3" />
      <path d="m8.7 12.2 2.1 2.1 4.6-4.7" />
    </BaseIcon>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="m4.8 12.6 4.7 4.7L19.3 7" />
    </BaseIcon>
  );
}

export function IconArrowUpRight(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </BaseIcon>
  );
}

export function IconDoc(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </BaseIcon>
  );
}

export function IconMessage(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M21 11.5a8.2 8.2 0 0 1-8.2 8.2H7l-4 3v-6.4A8.2 8.2 0 0 1 11.2 3.3h1.6A8.2 8.2 0 0 1 21 11.5Z" />
      <path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" strokeWidth={2.2} />
    </BaseIcon>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M12 5v14M5 12h14" />
    </BaseIcon>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="m6 7 1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
      <path d="M10 11v6M14 11v6" />
    </BaseIcon>
  );
}

export function IconPencil(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </BaseIcon>
  );
}

export function IconFolder(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M3 7.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </BaseIcon>
  );
}

export function IconLink(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M10 13.6a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 1 0-5.7-5.7L11.4 6.5" />
      <path d="M14 10.4a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 1 0 5.7 5.7l1.2-1.2" />
    </BaseIcon>
  );
}

export function IconClock(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 7.6V12l3 1.8" />
    </BaseIcon>
  );
}

export function IconAlertTriangle(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M10.3 4.2 2.9 17a1.8 1.8 0 0 0 1.6 2.7h15a1.8 1.8 0 0 0 1.6-2.7L13.7 4.2a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4.5M12 17h.01" strokeWidth={2.1} />
    </BaseIcon>
  );
}

export function IconInfo(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="12" cy="12" r="8.8" />
      <path d="M12 11v5M12 8h.01" strokeWidth={2.1} />
    </BaseIcon>
  );
}

export function IconCheckCircle(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="12" cy="12" r="8.8" />
      <path d="m8.4 12.2 2.3 2.3 4.9-5" />
    </BaseIcon>
  );
}

export function IconXCircle(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="12" cy="12" r="8.8" />
      <path d="m9.3 9.3 5.4 5.4M14.7 9.3l-5.4 5.4" />
    </BaseIcon>
  );
}

export function IconBook(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M5 4.5h11a2 2 0 0 1 2 2V20H7a2 2 0 0 1-2-2Z" />
      <path d="M5 17.5a2.5 2.5 0 0 1 2.5-2.5H18" />
    </BaseIcon>
  );
}

export function IconChart(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M4 20h16" />
      <path d="M7 16.5V11M12 16.5V5.5M17 16.5v-3" />
    </BaseIcon>
  );
}

export function IconCalendar(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.2" />
      <path d="M8 3.2v3.6M16 3.2v3.6M3.5 9.5h17" />
    </BaseIcon>
  );
}
