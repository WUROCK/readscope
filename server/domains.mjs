/**
 * 8 个固定阅读领域：名称、颜色、顺序，以及微信读书分类 -> 领域映射。
 * 只允许这 8 个领域参与统计，手动书籍的 tags 不参与领域统计。
 */

/** @typedef {'literature'|'humanities'|'business'|'tech'|'psychology'|'arts'|'education'|'other'} DomainId */

/** 固定顺序，不可调整（API / UI 都依赖该顺序） */
export const DOMAINS = Object.freeze([
  { id: 'literature', name: '文学', color: '#b5532f' },
  { id: 'humanities', name: '人文社科', color: '#8b6f47' },
  { id: 'business', name: '商业财经', color: '#c99a4b' },
  { id: 'tech', name: '科技', color: '#3f6b5c' },
  { id: 'psychology', name: '心理成长', color: '#7c6a9e' },
  { id: 'arts', name: '艺术生活', color: '#c46a6a' },
  { id: 'education', name: '教育学习', color: '#5e7fa3' },
  { id: 'other', name: '其他', color: '#9a9384' },
]);

export const DOMAIN_IDS = Object.freeze(DOMAINS.map((d) => d.id));

const DOMAIN_BY_ID = new Map(DOMAINS.map((d) => [d.id, d]));

/**
 * 关键词表按 DOMAINS 顺序做「首个包含匹配」，
 * 例如「社会科学」会先命中 humanitites 的「社会」，不会被 tech 的「科学」抢走。
 */
const DOMAIN_KEYWORDS = Object.freeze({
  literature: ['文学', '小说', '诗歌', '散文', '戏剧', '故事', '名著'],
  humanities: ['历史', '哲学', '社会', '文化', '政治', '军事', '法律', '宗教', '人类学', '传记', '考古'],
  business: ['经济', '理财', '商业', '管理', '投资', '金融', '创业', '营销', '职场'],
  tech: [
    '科技', '科学', '科普', '计算机', '互联网', '工程', '数学', '物理', '化学', '生物',
    '医学', '技术', '编程', '人工智能', '算法', '通信',
  ],
  psychology: ['心理', '成长', '励志', '自我提升', '幸福', '情绪', '疗愈'],
  arts: ['艺术', '生活', '健康', '美食', '旅行', '摄影', '音乐', '设计', '绘画', '手工'],
  education: ['教育', '学习', '考试', '语言', '外语', '英语', '教学', '育儿'],
  other: ['其他', '未分类'],
});

export function isDomainId(value) {
  return typeof value === 'string' && DOMAIN_BY_ID.has(value);
}

export function domainMeta(id) {
  return DOMAIN_BY_ID.get(id) || DOMAIN_BY_ID.get('other');
}

export function domainName(id) {
  return domainMeta(id).name;
}

export function domainColor(id) {
  return domainMeta(id).color;
}

/**
 * 微信读书分类字符串 -> DomainId（大小写不敏感、子串匹配、首个命中）。
 * 空值 / 未识别 -> 'other'。
 * @param {string} [category]
 * @returns {DomainId}
 */
export function mapCategoryToDomain(category) {
  const text = String(category ?? '').trim().toLowerCase();
  if (!text) return 'other';
  for (const domain of DOMAINS) {
    const keywords = DOMAIN_KEYWORDS[domain.id] || [];
    for (const keyword of keywords) {
      if (text.includes(keyword.toLowerCase())) return domain.id;
    }
  }
  return 'other';
}

/** 广度文案（按已触达领域数） */
export function breadthLabel(covered) {
  const n = Number(covered) || 0;
  if (n >= 7) return '博览群书';
  if (n >= 5) return '视野开阔';
  if (n >= 3) return '稳步拓展';
  return '深耕一域';
}

/**
 * 构造 8 个 DomainStat（固定顺序）。
 * @param {Record<string, {minutes?: number, books?: number}>} byDomain
 * @param {number} totalMinutes 本月总阅读分钟（用于算 percent）
 */
export function buildDomainStats(byDomain = {}, totalMinutes = 0) {
  const denominator = totalMinutes > 0 ? totalMinutes : 0;
  return DOMAINS.map((domain) => {
    const entry = byDomain[domain.id] || {};
    const minutes = Math.max(0, Math.round(entry.minutes || 0));
    const books = Math.max(0, Math.round(entry.books || 0));
    const rawPercent = denominator > 0 ? (minutes / denominator) * 100 : 0;
    return {
      id: domain.id,
      name: domain.name,
      color: domain.color,
      minutes,
      books,
      percent: Math.min(100, Math.max(0, Math.round(rawPercent))),
      covered: minutes > 0 || books > 0,
    };
  });
}
