/* ------------------------------------------------------------------ *
 * 阅界 · 本地预览数据（仅在没有本地服务时使用）
 * 不会写回后端；预览模式下的修改只存在于内存。
 * ------------------------------------------------------------------ */

import { domainMeta } from './domains';
import { percentOf, todayKey } from './format';
import type {
  AnnualMonth,
  BooksResponse,
  CheckinDay,
  ManualBook,
  Recommendation,
  RecommendationResponse,
  Settings,
  WeekDay,
  WereadBook,
  WereadOverview,
} from './types';

const DATA_DIR = '<data-dir>';
const NOW = new Date();
const TODAY = todayKey();
const THIS_YEAR = NOW.getFullYear();
const THIS_MONTH = NOW.getMonth() + 1;
const MONTH_LABEL = `${THIS_YEAR}年${THIS_MONTH}月`;

const pad2 = (value: number): string => String(value).padStart(2, '0');

function offsetDayKey(offset: number): string {
  const date = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + offset);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function isoAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function isoTodayAt(hour: number, minute: number): string {
  return new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), hour, minute, 0, 0).toISOString();
}

/* ------------------------------- 本周 ------------------------------- */

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const dayOfWeek = NOW.getDay();
const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
const weekPattern = [52, 38, 64, 32, 45, 50, 0];

const weekDays: WeekDay[] = WEEKDAYS.map((weekday, index) => {
  const date = offsetDayKey(mondayOffset + index);
  const isToday = date === TODAY;
  const isFuture = date > TODAY;
  const minutes = isToday ? 42 : isFuture ? 0 : weekPattern[index];
  return { date, weekday, minutes, isToday, isFuture };
});

const weekTotalMinutes = weekDays.reduce((sum, day) => sum + day.minutes, 0);
const weekActiveDays = weekDays.filter((day) => day.minutes > 0).length;
const weekElapsedDays = weekDays.filter((day) => !day.isFuture).length;

/* ------------------------------ 年度统计 ----------------------------- */

const MONTHLY_PATTERN = [980, 860, 1240, 1100, 1320, 1510, 1180, 940, 1460, 1420, 760, 0];

const annualMonths: AnnualMonth[] = Array.from({ length: 12 }, (_, index) => {
  const month = index + 1;
  const minutes = month > THIS_MONTH ? 0 : month === THIS_MONTH ? 1420 : MONTHLY_PATTERN[index];
  return { month, minutes };
});
const annualMinutes = annualMonths.reduce((sum, month) => sum + month.minutes, 0);

const checkinHistory: CheckinDay[] = Array.from({ length: 30 }, (_, index) => {
  const daysAgo = 29 - index;
  const checkedIn = daysAgo <= 5 || [8, 9, 12, 15, 18, 21, 23, 26].includes(daysAgo);
  const minutes = checkedIn ? (daysAgo === 0 ? 42 : 26 + ((daysAgo * 13) % 57)) : 0;
  return {
    date: offsetDayKey(-daysAgo),
    minutes,
    checkedIn,
    source: checkedIn ? 'auto' : null,
  };
});

/* ------------------------------ 微信读书 ----------------------------- */

const wereadBooks: WereadBook[] = [
  {
    id: 'wr:human-history',
    bookId: 'human-history',
    title: '人类简史：从动物到上帝',
    author: '尤瓦尔·赫拉利',
    cover: null,
    category: '历史',
    domain: 'humanities',
    domainName: '人文社科',
    progress: 64,
    readingMinutes: 126,
    lastReadAt: isoAgo(52),
    finished: false,
    readerLink: 'https://weread.qq.com/web/bookDetail/human-history',
    tags: ['历史', '人文社科'],
  },
  {
    id: 'wr:math-beauty',
    bookId: 'math-beauty',
    title: '数学之美',
    author: '吴军',
    cover: null,
    category: '计算机',
    domain: 'tech',
    domainName: '科技',
    progress: 48,
    readingMinutes: 95,
    lastReadAt: isoAgo(180),
    finished: false,
    readerLink: 'https://weread.qq.com/web/bookDetail/math-beauty',
    tags: ['科技', '计算机'],
  },
  {
    id: 'wr:courage',
    bookId: 'courage',
    title: '被讨厌的勇气',
    author: '岸见一郎 / 古贺史健',
    cover: null,
    category: '心理',
    domain: 'psychology',
    domainName: '心理成长',
    progress: 32,
    readingMinutes: 60,
    lastReadAt: isoAgo(1_460),
    finished: false,
    readerLink: 'https://weread.qq.com/web/bookDetail/courage',
    tags: ['心理', '成长'],
  },
  {
    id: 'wr:moon-sixpence',
    bookId: 'moon-sixpence',
    title: '月亮与六便士',
    author: '毛姆',
    cover: null,
    category: '小说',
    domain: 'literature',
    domainName: '文学',
    progress: 88,
    readingMinutes: 210,
    lastReadAt: isoAgo(2_930),
    finished: false,
    readerLink: 'https://weread.qq.com/web/bookDetail/moon-sixpence',
    tags: ['文学', '小说'],
  },
  {
    id: 'wr:beauty-progress',
    bookId: 'beauty-progress',
    title: '美的历程',
    author: '李泽厚',
    cover: null,
    category: '艺术',
    domain: 'arts',
    domainName: '艺术生活',
    progress: 22,
    readingMinutes: 42,
    lastReadAt: isoAgo(5_800),
    finished: false,
    readerLink: 'https://weread.qq.com/web/bookDetail/beauty-progress',
    tags: ['艺术', '美学'],
  },
  {
    id: 'wr:alive',
    bookId: 'alive',
    title: '活着',
    author: '余华',
    cover: null,
    category: '文学',
    domain: 'literature',
    domainName: '文学',
    progress: 100,
    readingMinutes: 312,
    lastReadAt: isoAgo(8_600),
    finished: true,
    readerLink: 'https://weread.qq.com/web/bookDetail/alive',
    tags: ['文学', '小说'],
  },
];

const overview: WereadOverview = {
  source: 'demo',
  connected: false,
  error: null,
  updatedAt: isoAgo(3),
  today: {
    date: TODAY,
    minutes: 42,
    seconds: 42 * 60,
    goalMinutes: 45,
    checkinMinutes: 30,
    goalPercent: percentOf(42, 45),
    checkinPercent: percentOf(42, 30),
    checkedIn: true,
    checkedInAt: isoTodayAt(9, 41),
    checkedInSource: 'auto',
    streak: 6,
    remainingToGoal: 3,
    remainingToCheckin: 0,
  },
  week: {
    days: weekDays,
    totalMinutes: weekTotalMinutes,
    activeDays: weekActiveDays,
    averageMinutes: weekElapsedDays > 0 ? Math.round(weekTotalMinutes / weekElapsedDays) : 0,
  },
  domains: {
    items: [],
    covered: 6,
    total: 8,
    score: 75,
    label: '视野开阔',
    monthLabel: MONTH_LABEL,
  },
  books: wereadBooks,
  checkinHistory,
  stats: {
    readDays: 18,
    totalMinutes: 1420,
    finishedBooks: 3,
    monthMinutes: 1420,
    monthStartedBooks: 5,
    monthFinishedBooks: 3,
    monthReadDays: 18,
    yearMinutes: annualMinutes,
    yearStartedBooks: 31,
    yearFinishedBooks: 23,
    yearReadDays: 178,
    annualMonths,
  },
  notice: '当前为演示数据，连接微信读书后自动同步真实进度',
};

/* ------------------------------ 手动书单 ----------------------------- */

function manualBook(partial: {
  id: string;
  title: string;
  author: string;
  totalPages: number;
  currentPage: number;
  domain: ManualBook['domain'];
  tags: string[];
  addedDaysAgo: number;
}): ManualBook {
  const meta = domainMeta(partial.domain);
  const progress = percentOf(partial.currentPage, partial.totalPages);
  const finished = partial.currentPage >= partial.totalPages;
  const addedAt = isoAgo(partial.addedDaysAgo * 24 * 60);
  return {
    id: partial.id,
    title: partial.title,
    author: partial.author,
    totalPages: partial.totalPages,
    currentPage: partial.currentPage,
    progress,
    finished,
    domain: partial.domain,
    domainName: meta.name,
    tags: partial.tags,
    estimatedMinutesRemaining: Math.max(0, Math.round((partial.totalPages - partial.currentPage) * 1.4)),
    addedAt,
    updatedAt: isoAgo(partial.addedDaysAgo * 24 * 60 - 120),
    finishedAt: finished ? isoAgo(partial.addedDaysAgo * 24 * 60 - 120) : null,
  };
}

const manualBooks: ManualBook[] = [
  manualBook({
    id: 'bk_mmwave',
    title: '毫米波雷达感知技术',
    author: '张伟',
    totalPages: 320,
    currentPage: 48,
    domain: 'tech',
    tags: ['科技', '雷达'],
    addedDaysAgo: 12,
  }),
  manualBook({
    id: 'bk_cognition',
    title: '认知觉醒',
    author: '周岭',
    totalPages: 280,
    currentPage: 160,
    domain: 'psychology',
    tags: ['心理', '成长'],
    addedDaysAgo: 20,
  }),
  manualBook({
    id: 'bk_guns',
    title: '枪炮、病菌与钢铁',
    author: '贾雷德·戴蒙德',
    totalPages: 320,
    currentPage: 320,
    domain: 'humanities',
    tags: ['历史', '人文社科'],
    addedDaysAgo: 44,
  }),
];

const books: BooksResponse = {
  items: manualBooks,
  stats: {
    reading: manualBooks.filter((book) => !book.finished).length,
    finished: manualBooks.filter((book) => book.finished).length,
    totalPagesRead: manualBooks.reduce((sum, book) => sum + book.currentPage, 0),
  },
};

/* ------------------------------- 推荐 ------------------------------- */

function rec(partial: Omit<Recommendation, 'fetchedAt'> & { fetchedAt?: string }): Recommendation {
  return {
    ...partial,
    fetchedAt: partial.fetchedAt ?? isoAgo(90),
  };
}

const mainRecommendation = rec({
  id: 'rec_ris_6g_survey',
  date: TODAY,
  type: 'paper',
  title: 'Reconfigurable Intelligent Surfaces for 6G: A Contemporary Survey',
  venue: 'IEEE TWC',
  year: 2026,
  summary:
    '从信道建模、波束设计到原型验证，系统梳理智能超表面在 6G 通感一体化中的关键进展与开放问题。',
  url: 'https://doi.org/10.1109/TWC.2026.3300123',
  source: 'curated',
  sourceLabel: '精选文献库',
  tags: ['RIS', '6G', '通感一体化'],
  language: 'en',
});

const historyItems: Recommendation[] = [
  mainRecommendation,
  rec({
    id: 'rec_llm_world_model',
    date: offsetDayKey(-1),
    type: 'article',
    title: '大模型之后，世界模型会成为下一个拐点吗？',
    venue: '机器之心',
    year: 2026,
    summary: '从视频生成到具身智能，梳理世界模型的技术路线、代表工作与仍待回答的关键问题。',
    url: 'https://www.jiqizhixin.com/articles/world-model-2026',
    source: 'wechat',
    sourceLabel: '公众号：机器之心',
    tags: ['世界模型', '具身智能'],
    language: 'zh',
  }),
  rec({
    id: 'rec_thz_sensing',
    date: offsetDayKey(-2),
    type: 'paper',
    title: 'Terahertz Sensing for Human-Centric ISAC',
    venue: 'IEEE JSAC',
    year: 2025,
    summary: '探索太赫兹频段下的人体微动感知能力，并讨论通感一体化系统的硬件与波形设计。',
    url: 'https://doi.org/10.1109/JSAC.2025.3388771',
    source: 'curated',
    sourceLabel: '精选文献库',
    tags: ['太赫兹', '人体感知', 'ISAC'],
    language: 'en',
  }),
  rec({
    id: 'rec_arxiv_3d',
    date: offsetDayKey(-3),
    type: 'paper',
    title: 'Gaussian Splatting Meets mmWave Radar for 3D Scene Reconstruction',
    venue: 'arXiv preprint',
    year: 2026,
    summary: '用高斯溅射融合毫米波雷达点云，在低光照条件下实现稠密的三维场景重建。',
    url: 'https://arxiv.org/abs/2603.11234',
    source: 'arxiv',
    sourceLabel: 'arXiv 实时检索',
    tags: ['三维重建', '毫米波雷达'],
    language: 'en',
  }),
  rec({
    id: 'rec_article_reading',
    date: offsetDayKey(-4),
    type: 'article',
    title: '读不完一本书，可能不是你的问题',
    venue: '看理想',
    year: 2026,
    summary: '从注意力经济与阅读习惯出发，聊聊为什么深度阅读变难，以及可以怎样重新开始。',
    url: 'https://www.kanlixiang.com/article/reading-habit',
    source: 'wechat',
    sourceLabel: '公众号：看理想',
    tags: ['阅读', '生活方式'],
    language: 'zh',
  }),
];

const recommendation: RecommendationResponse = {
  date: TODAY,
  item: mainRecommendation,
  history: historyItems,
  stats: {
    total: 23,
    csvPath: `${DATA_DIR}\\recommendations.csv`,
  },
  sources: { arxiv: 'ok', wechat: 'idle' },
  warning: null,
};

/** 预览模式“换一篇”的候选池。 */
const PREVIEW_REC_POOL: Recommendation[] = [
  rec({
    id: 'rec_arxiv_isac_edge',
    date: TODAY,
    type: 'paper',
    title: 'ISAC at the Edge: Joint Communication and Sensing for Mobile Robots',
    venue: 'arXiv preprint',
    year: 2026,
    summary: '将通感一体化引入移动机器人边缘网络，联合优化通信时延、感知精度与能耗。',
    url: 'https://arxiv.org/abs/2602.08891',
    source: 'arxiv',
    sourceLabel: 'arXiv 实时检索',
    tags: ['ISAC', '边缘计算'],
    language: 'en',
  }),
  rec({
    id: 'rec_article_focus',
    date: TODAY,
    type: 'article',
    title: '专注力是可以被训练的：一位研究者的阅读实验',
    venue: '看理想',
    year: 2026,
    summary: '作者用 30 天记录自己的阅读专注时长，尝试找出进入深度阅读状态的可复制路径。',
    url: 'https://www.kanlixiang.com/article/focus-reading',
    source: 'wechat',
    sourceLabel: '公众号：看理想',
    tags: ['阅读', '专注力'],
    language: 'zh',
  }),
  rec({
    id: 'rec_curated_mmwave',
    date: TODAY,
    type: 'paper',
    title: 'mmWave Radar for Contactless Vital Sign Monitoring: A Review',
    venue: 'IEEE Sensors Journal',
    year: 2025,
    summary: '综述毫米波雷达在呼吸、心率与睡眠监测中的信号处理链路与工程落地挑战。',
    url: 'https://doi.org/10.1109/JSEN.2025.3321100',
    source: 'curated',
    sourceLabel: '精选文献库',
    tags: ['毫米波雷达', '人体感知'],
    language: 'en',
  }),
];

/* ------------------------------- 设置 ------------------------------- */

const settings: Settings = {
  wereadConfigured: false,
  wereadKeyMasked: null,
  goalMinutes: 45,
  checkinMinutes: 30,
  researchTags: [
    'RIS',
    '毫米波雷达',
    '人体感知',
    '三维重建',
    '多传感器融合',
    'ISAC',
    '通感一体化',
    '智能超表面',
  ],
  recommendationSource: 'paper',
  readingOrder: [],
  dataDir: DATA_DIR,
  recommendationsCsv: `${DATA_DIR}\\recommendations.csv`,
  appVersion: '0.1.0',
};

export interface Fixtures {
  overview: WereadOverview;
  settings: Settings;
  books: BooksResponse;
  recommendation: RecommendationResponse;
}

export const FIXTURES: Fixtures = {
  overview,
  settings,
  books,
  recommendation,
};

/* --------------------------- 预览模式派生 --------------------------- */

/** 预览模式修改目标 / 打卡阈值时本地重算 Today。 */
export function applyPreviewGoals(
  source: WereadOverview,
  goalMinutes: number,
  checkinMinutes: number,
): WereadOverview {
  const today = source.today;
  const checkedIn = today.minutes >= checkinMinutes;
  return {
    ...source,
    updatedAt: new Date().toISOString(),
    today: {
      ...today,
      goalMinutes,
      checkinMinutes,
      goalPercent: percentOf(today.minutes, goalMinutes),
      checkinPercent: percentOf(today.minutes, checkinMinutes),
      checkedIn,
      checkedInAt: checkedIn ? (today.checkedInAt ?? new Date().toISOString()) : null,
      checkedInSource: checkedIn ? (today.checkedInSource ?? 'auto') : null,
      remainingToGoal: Math.max(0, goalMinutes - today.minutes),
      remainingToCheckin: Math.max(0, checkinMinutes - today.minutes),
    },
  };
}

/** 预览模式“换一篇”：本地轮换候选池，模拟 CSV 去重与记录增长。 */
export function nextPreviewRecommendation(source: RecommendationResponse): RecommendationResponse {
  const used = new Set<string>();
  if (source.item) used.add(source.item.id);
  for (const item of source.history) used.add(item.id);
  const fresh =
    PREVIEW_REC_POOL.find((item) => !used.has(item.id)) ??
    PREVIEW_REC_POOL[(source.stats.total + 1) % PREVIEW_REC_POOL.length];
  const next: Recommendation = { ...fresh, date: TODAY, fetchedAt: new Date().toISOString() };
  const keepPrevious = source.item && source.item.id !== next.id ? source.item : null;
  const history = [
    next,
    ...(keepPrevious ? [keepPrevious] : []),
    ...source.history.filter((item) => item.id !== next.id),
  ].slice(0, 8);
  return {
    ...source,
    date: TODAY,
    item: next,
    history,
    stats: { ...source.stats, total: source.stats.total + 1 },
    warning: null,
    replaced: true,
  };
}
