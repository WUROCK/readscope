/**
 * 书籍标签推导：中文标签，最多 6 个。
 *
 * - 微信读书：分类 + 领域。例：
 *   分类「文学-纪实文学」+ 领域「文学」 -> ["文学", "纪实"]
 *   分类「计算机」+ 领域「科技」       -> ["科技", "计算机"]
 *   分类为空 + 领域「其他」            -> ["其他"]
 * - 手动书：领域名 + 标题/作者关键词，与用户标签合并（去重，最多 6 个）。
 */

import { normalizeTagList } from './util.mjs';
import { domainName, isDomainId } from './domains.mjs';

export const MAX_BOOK_TAGS = 6;

const CATEGORY_SPLIT_RE = /[-–—/\\|·•・,，、;；:：>》【】[\]()（）\s]+/u;

/** 领域 ID 或中文领域名 -> 中文领域名 */
export function resolveDomainLabel(domain) {
  if (!domain) return '其他';
  return isDomainId(domain) ? domainName(domain) : String(domain).trim() || '其他';
}

function pushTag(tags, seen, raw) {
  const text = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return;
  const clipped = Array.from(text).slice(0, 20).join('');
  const key = clipped.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  tags.push(clipped);
}

/** 微信读书分类 -> 中文标签（领域名 + 分类层级），最多 6 个 */
export function deriveWereadTags(category, domain = 'other') {
  const label = resolveDomainLabel(domain);
  const tags = [];
  const seen = new Set();
  pushTag(tags, seen, label);

  const tokens = String(category ?? '')
    .split(CATEGORY_SPLIT_RE)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return tags;

  const top = tokens[0];
  pushTag(tags, seen, top);
  for (const token of tokens.slice(1)) {
    let sub = token;
    // 「文学-纪实文学」压缩为更具体的「纪实」；「文学-外国文学」保留完整子类，
    // 避免出现「外国」这种信息量过低的标签。
    if (top === '文学' && sub === '纪实文学') sub = '纪实';
    pushTag(tags, seen, sub);
  }
  return tags.slice(0, MAX_BOOK_TAGS);
}

/**
 * 手动书关键词 -> 标签。顺序：越具体的规则越靠前，避免「深度学习」先命中泛词。
 * @type {{ keywords: string[], tag: string }[]}
 */
export const MANUAL_TAG_RULES = Object.freeze([
  { keywords: ['毫米波', '雷达'], tag: '雷达' },
  { keywords: ['智能超表面', '可重构智能表面', 'ris'], tag: 'RIS' },
  { keywords: ['通感一体化', 'isac'], tag: 'ISAC' },
  { keywords: ['人体感知', '感知'], tag: '感知' },
  { keywords: ['深度学习', '机器学习', '人工智能', '神经网络', '大模型', 'ai'], tag: 'AI' },
  { keywords: ['三维重建', '重建'], tag: '三维重建' },
  { keywords: ['多传感器融合', '传感器融合', '融合'], tag: '多传感器融合' },
  { keywords: ['编程', '代码', '软件开发'], tag: '编程' },
  { keywords: ['计算机', '软件'], tag: '计算机' },
  { keywords: ['芯片'], tag: '芯片' },
  { keywords: ['机器人'], tag: '机器人' },
  { keywords: ['自动驾驶'], tag: '自动驾驶' },
  { keywords: ['通信'], tag: '通信' },
  { keywords: ['信号'], tag: '信号' },
  { keywords: ['数据'], tag: '数据' },
  { keywords: ['医学', '医疗', '生物'], tag: '医学' },
  { keywords: ['数学'], tag: '数学' },
  { keywords: ['物理'], tag: '物理' },
  { keywords: ['化学'], tag: '化学' },
  { keywords: ['小说', '故事集'], tag: '小说' },
  { keywords: ['纪实'], tag: '纪实' },
  { keywords: ['散文'], tag: '散文' },
  { keywords: ['诗歌', '诗集'], tag: '诗歌' },
  { keywords: ['戏剧'], tag: '戏剧' },
  { keywords: ['历史', '史书'], tag: '历史' },
  { keywords: ['哲学'], tag: '哲学' },
  { keywords: ['社会'], tag: '社会' },
  { keywords: ['文化'], tag: '文化' },
  { keywords: ['法律', '法学'], tag: '法律' },
  { keywords: ['政治'], tag: '政治' },
  { keywords: ['经济', '经济学'], tag: '经济' },
  { keywords: ['投资'], tag: '投资' },
  { keywords: ['金融'], tag: '金融' },
  { keywords: ['理财'], tag: '理财' },
  { keywords: ['商业'], tag: '商业' },
  { keywords: ['管理'], tag: '管理' },
  { keywords: ['创业'], tag: '创业' },
  { keywords: ['营销'], tag: '营销' },
  { keywords: ['心理'], tag: '心理' },
  { keywords: ['成长'], tag: '成长' },
  { keywords: ['情绪'], tag: '情绪' },
  { keywords: ['幸福'], tag: '幸福' },
  { keywords: ['艺术'], tag: '艺术' },
  { keywords: ['摄影'], tag: '摄影' },
  { keywords: ['音乐'], tag: '音乐' },
  { keywords: ['设计'], tag: '设计' },
  { keywords: ['美食', '烹饪'], tag: '美食' },
  { keywords: ['旅行', '游记'], tag: '旅行' },
  { keywords: ['健康', '养生'], tag: '健康' },
  { keywords: ['教育', '教学'], tag: '教育' },
  { keywords: ['学习'], tag: '学习' },
  { keywords: ['英语', '外语'], tag: '语言' },
  { keywords: ['考试'], tag: '考试' },
  { keywords: ['育儿'], tag: '育儿' },
]);

/**
 * 手动书自动标签：领域名 + 标题/作者关键词。
 * @param {{ title?: string, author?: string, domain?: string, domainName?: string }} book
 */
export function deriveManualTags({ title = '', author = '', domain = 'other', domainName: explicitLabel } = {}) {
  const label = explicitLabel || resolveDomainLabel(domain);
  const tags = [];
  const seen = new Set();
  pushTag(tags, seen, label);
  const text = `${title} ${author}`.toLowerCase();
  if (text.trim()) {
    for (const rule of MANUAL_TAG_RULES) {
      if (tags.length >= MAX_BOOK_TAGS) break;
      if (rule.keywords.some((keyword) => text.includes(keyword.toLowerCase()))) {
        pushTag(tags, seen, rule.tag);
      }
    }
  }
  return tags.slice(0, MAX_BOOK_TAGS);
}

/** 合并自动标签与用户标签（去重、最多 6 个；自动标签在前） */
export function mergeBookTags(autoTags = [], userTags = []) {
  const tags = [];
  const seen = new Set();
  for (const tag of [...normalizeTagList(autoTags, { max: MAX_BOOK_TAGS }), ...normalizeTagList(userTags, { max: MAX_BOOK_TAGS })]) {
    if (tags.length >= MAX_BOOK_TAGS) break;
    pushTag(tags, seen, tag);
  }
  return tags;
}
