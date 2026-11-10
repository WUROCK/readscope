import type { DomainId } from './types';

export interface DomainMeta {
  id: DomainId;
  name: string;
  color: string;
}

/** 固定 8 领域，顺序与 docs/api-contract.md 一致。 */
export const DOMAINS: DomainMeta[] = [
  { id: 'literature', name: '文学', color: '#b5532f' },
  { id: 'humanities', name: '人文社科', color: '#8b6f47' },
  { id: 'business', name: '商业财经', color: '#c99a4b' },
  { id: 'tech', name: '科技', color: '#3f6b5c' },
  { id: 'psychology', name: '心理成长', color: '#7c6a9e' },
  { id: 'arts', name: '艺术生活', color: '#c46a6a' },
  { id: 'education', name: '教育学习', color: '#5e7fa3' },
  { id: 'other', name: '其他', color: '#9a9384' },
];

export const DOMAIN_BY_ID: Record<DomainId, DomainMeta> = DOMAINS.reduce(
  (acc, domain) => {
    acc[domain.id] = domain;
    return acc;
  },
  {} as Record<DomainId, DomainMeta>,
);

export function domainMeta(id: DomainId | string | null | undefined): DomainMeta {
  if (id && id in DOMAIN_BY_ID) return DOMAIN_BY_ID[id as DomainId];
  return DOMAIN_BY_ID.other;
}

/** 给研究兴趣 chips 循环使用的“领域色”。 */
export const TAG_COLORS = DOMAINS.map((domain) => domain.color);

export function tagColor(index: number): string {
  return TAG_COLORS[Math.abs(index) % TAG_COLORS.length];
}

/** #rrggbb -> rgba(...)，用于生成克制的浅色底。 */
export function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  const full =
    normalized.length === 3
      ? normalized
          .split('')
          .map((char) => char + char)
          .join('')
      : normalized;
  const value = Number.parseInt(full, 16);
  if (Number.isNaN(value) || full.length !== 6) return `rgba(154, 147, 132, ${alpha})`;
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
