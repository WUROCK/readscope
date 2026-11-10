/* ------------------------------------------------------------------ *
 * 阅界 · API 类型定义
 * 与 docs/api-contract.md v1 保持一致。前端只消费这些结构。
 * ------------------------------------------------------------------ */

export type DomainId =
  | 'literature'
  | 'humanities'
  | 'business'
  | 'tech'
  | 'psychology'
  | 'arts'
  | 'education'
  | 'other';

export type AppMode = 'loading' | 'live' | 'preview';

export type CheckinSource = 'auto' | 'manual' | null;

export interface DomainStat {
  id: DomainId;
  name: string;
  color: string;
  minutes: number;
  books: number;
  percent: number;
  covered: boolean;
}

export interface Today {
  date: string;
  minutes: number;
  seconds: number;
  goalMinutes: number;
  checkinMinutes: number;
  goalPercent: number;
  checkinPercent: number;
  checkedIn: boolean;
  checkedInAt: string | null;
  checkedInSource: CheckinSource;
  streak: number;
  remainingToGoal: number;
  remainingToCheckin: number;
}

export interface WeekDay {
  date: string;
  weekday: string;
  minutes: number;
  isToday: boolean;
  isFuture: boolean;
}

export interface CheckinDay {
  date: string;
  minutes: number;
  checkedIn: boolean;
  source: CheckinSource;
}

export interface WereadBook {
  id: string;
  bookId: string;
  title: string;
  author: string;
  cover: string | null;
  category: string;
  domain: DomainId;
  domainName: string;
  progress: number;
  readingMinutes: number;
  lastReadAt: string | null;
  finished: boolean;
  readerLink: string | null;
  /** 微信读书自动标签（≤6，中文） */
  tags: string[];
}

export interface AnnualMonth {
  month: number;
  minutes: number;
}

export interface WereadOverview {
  source: 'weread' | 'demo' | 'error';
  connected: boolean;
  error: string | null;
  updatedAt: string;
  today: Today;
  week: {
    days: WeekDay[];
    totalMinutes: number;
    activeDays: number;
    averageMinutes: number;
  };
  domains: {
    items: DomainStat[];
    covered: number;
    total: number;
    score: number;
    label: string;
    monthLabel: string;
  };
  books: WereadBook[];
  checkinHistory: CheckinDay[];
  stats: {
    readDays: number;
    totalMinutes: number;
    finishedBooks: number;
    monthMinutes: number;
    monthStartedBooks: number;
    monthFinishedBooks: number;
    monthReadDays: number;
    yearMinutes: number;
    yearStartedBooks: number;
    yearFinishedBooks: number;
    yearReadDays: number;
    annualMonths: AnnualMonth[];
  };
  notice: string | null;
}

export interface ManualBook {
  id: string;
  title: string;
  author: string;
  totalPages: number;
  currentPage: number;
  progress: number;
  finished: boolean;
  domain: DomainId;
  domainName: string;
  tags: string[];
  estimatedMinutesRemaining: number;
  addedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export type PaperStatus = 'todo' | 'reading' | 'done';

export interface Paper {
  id: string;
  title: string;
  venue: string;
  year: number | null;
  url: string;
  doi: string;
  summary: string;
  status: PaperStatus;
  tags: string[];
  totalPages: number;
  currentPage: number;
  progress: number;
  addedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export type RecommendationType = 'paper' | 'article';
export type RecommendationSourceKind = 'arxiv' | 'curated' | 'wechat' | 'crossref';

export interface Recommendation {
  id: string;
  date: string;
  type: RecommendationType;
  title: string;
  venue: string;
  year: number | null;
  summary: string;
  url: string;
  source: RecommendationSourceKind;
  sourceLabel: string;
  tags: string[];
  language: 'zh' | 'en';
  fetchedAt: string;
  publicationYear?: number | null;
  publicationDoi?: string | null;
  publicationUrl?: string | null;
  venueSource?: string | null;
  venueStatus?: string | null;
}

export type RecommendationSource = 'auto' | 'paper' | 'wechat' | 'curated';

export interface Settings {
  wereadConfigured: boolean;
  wereadKeyMasked: string | null;
  goalMinutes: number;
  checkinMinutes: number;
  researchTags: string[];
  recommendationSource: RecommendationSource;
  readingOrder: string[];
  dataDir: string;
  recommendationsCsv: string;
  appVersion: string;
}

/* ----------------------------- 请求体 ----------------------------- */

export interface ManualBookInput {
  title: string;
  author: string;
  totalPages: number;
  currentPage: number;
  domain: DomainId;
  tags: string[];
}

export interface PaperInput {
  title: string;
  venue: string;
  year: number | null;
  url: string;
  doi: string;
  summary: string;
  status: PaperStatus;
  tags: string[];
  totalPages: number;
  currentPage: number;
}

export interface SettingsUpdate {
  wereadApiKey?: string;
  goalMinutes?: number;
  checkinMinutes?: number;
  researchTags?: string[];
  recommendationSource?: RecommendationSource;
  readingOrder?: string[];
}

/* ----------------------------- 响应体 ----------------------------- */

export interface HealthResponse {
  ok: boolean;
  version?: string;
  dataDir?: string;
  time?: string;
}

export interface WereadTestResult {
  ok: boolean;
  message: string;
  bookCount?: number;
}

export interface BooksResponse {
  items: ManualBook[];
  stats: {
    reading: number;
    finished: number;
    totalPagesRead: number;
  };
}

export interface PapersResponse {
  items: Paper[];
  stats: {
    todo: number;
    reading: number;
    done: number;
    total: number;
  };
  tagCounts: { tag: string; count: number }[];
}

export interface RecommendationResponse {
  date: string;
  item: Recommendation | null;
  history: Recommendation[];
  stats: {
    total: number;
    csvPath: string;
  };
  sources?: Record<string, string>;
  warning: string | null;
  replaced?: boolean;
}

/* --------------------------- Electron 桥 --------------------------- */

export interface DesktopState {
  pinned?: boolean;
  compact?: boolean;
  transitioning?: boolean;
  opacity?: number;
  isDesktop?: boolean;
  dataDir?: string;
  version?: string;
  platform?: string;
}

/**
 * Electron preload 可选桥接。所有方法都是可选的：
 * 纯浏览器预览时 window.desktop 不存在，调用处需要优雅降级（no-op / 新窗口打开）。
 * 与 electron/preload.cjs 暴露的 desktop API 对齐。
 */
export interface DesktopBridge {
  isDesktop?: boolean;
  apiBase?: string;
  getState?: () => DesktopState | Promise<DesktopState>;
  setCompact?: (compact: boolean, options?: { animate?: boolean }) => DesktopState | Promise<DesktopState>;
  setOpacity?: (opacity: number) => DesktopState | Promise<DesktopState>;
  onState?: (callback: (state: DesktopState) => void) => (() => void) | void;
  openExternal?: (url: string) => void | Promise<unknown>;
  openDataFolder?: (path?: string) => void | Promise<unknown>;
  minimize?: () => void | Promise<unknown>;
  /** 隐藏到托盘 */
  hide?: () => void | Promise<unknown>;
  close?: () => void | Promise<unknown>;
  quit?: () => void | Promise<unknown>;
  /** 切换置顶，返回最新置顶状态（也可以不返回，前端本地切换） */
  togglePin?: () => boolean | void | Promise<boolean | void>;
  getPinned?: () => boolean | void | Promise<boolean | void>;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
    __READSCOPE_API_BASE__?: string;
  }
}
