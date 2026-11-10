/* ------------------------------------------------------------------ *
 * 阅界 · 格式化工具
 * 时长、日期、百分比、问候、相对时间。全部中文文案。
 * ------------------------------------------------------------------ */

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEKDAY_SHORT = ['日', '一', '二', '三', '四', '五', '六'];

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** <60 分钟；否则小时，保留 1 位小数；>=100 小时取整。例：28 分钟 / 2.1 小时 / 102 小时 */
export function formatMinutes(minutes: number | null | undefined): string {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  if (value < 60) return `${value} 分钟`;
  const hours = value / 60;
  if (hours >= 100) return `${Math.round(hours)} 小时`;
  if (value % 60 === 0) return `${hours} 小时`;
  return `${hours.toFixed(1)} 小时`;
}

/** 长时长文案。例：1 小时 05 分 / 4 小时 12 分 / 45 分钟 */
export function formatDuration(minutes: number | null | undefined): string {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  if (hours <= 0) return `${rest} 分钟`;
  if (rest === 0) return `${hours} 小时`;
  return `${hours} 小时 ${pad2(rest)} 分`;
}

/** 统计大数字用的小时数（不含单位）。例：200.2 / 42 / 3.5 */
export function formatHoursNumber(minutes: number | null | undefined): string {
  const hours = Math.max(0, Number(minutes) || 0) / 60;
  if (hours >= 100) return String(Math.round(hours));
  if (hours <= 0) return '0';
  return String(Number(hours.toFixed(1)));
}

/** YYYY-MM-DD -> 2026 */
export function yearOf(dayKey: string | null | undefined): string {
  const date = parseDayKey(dayKey || '');
  return date ? String(date.getFullYear()) : String(new Date().getFullYear());
}

/** YYYY-MM-DD -> 10 月 */
export function monthOf(dayKey: string | null | undefined): string {
  const date = parseDayKey(dayKey || '');
  return date ? `${date.getMonth() + 1} 月` : '';
}

/** 10 月 29 日 · 周四 */
export function formatDateCN(dayKey: string): string {
  const date = parseDayKey(dayKey);
  if (!date) return dayKey || '今天';
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 · ${WEEKDAY_CN[date.getDay()]}`;
}

/** 10.29 */
export function formatMonthDayDots(dayKey: string): string {
  const date = parseDayKey(dayKey);
  if (!date) return dayKey || '';
  return `${pad2(date.getMonth() + 1)}.${pad2(date.getDate())}`;
}

/** 2026.10.29 */
export function formatFullDateDots(dayKey: string): string {
  const date = parseDayKey(dayKey);
  if (!date) return dayKey || '';
  return `${date.getFullYear()}.${pad2(date.getMonth() + 1)}.${pad2(date.getDate())}`;
}

/** 10 / 29 的拆分，用于推荐卡纵向日期 */
export function splitMonthDay(dayKey: string): { year: string; month: string; day: string } {
  const date = parseDayKey(dayKey);
  if (!date) {
    const now = new Date();
    return {
      year: String(now.getFullYear()),
      month: pad2(now.getMonth() + 1),
      day: pad2(now.getDate()),
    };
  }
  return {
    year: String(date.getFullYear()),
    month: pad2(date.getMonth() + 1),
    day: pad2(date.getDate()),
  };
}

export function weekdayShort(dayKey: string): string {
  const date = parseDayKey(dayKey);
  return date ? WEEKDAY_SHORT[date.getDay()] : '';
}

/** YYYY-MM-DD -> 本地 Date（避免被 UTC 时区偏移一天） */
export function parseDayKey(dayKey: string): Date | null {
  if (!dayKey) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dayKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

/** ISO 时间 -> 本机 HH:mm */
export function formatClock(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** 3 分钟前 / 刚刚 / 2 小时前 */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '刚刚';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '刚刚';
  const diffSeconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (diffSeconds < 60) return '刚刚';
  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

/** 0-100 取整百分比 */
export function formatPercent(value: number | null | undefined): string {
  const safe = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  return `${safe}%`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** 早上好 / 下午好 / 晚上好 */
export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return '早上好';
  if (hour >= 12 && hour < 18) return '下午好';
  return '晚上好';
}

/** 今天（本机时区）的 YYYY-MM-DD，用于没有服务端日期兜底。 */
export function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** 把绝对路径缩短成 data/xxx 形式展示 */
export function displayPath(path: string | null | undefined, fallback = 'data'): string {
  if (!path) return fallback;
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const index = normalized.lastIndexOf('/data/');
  if (index >= 0) return normalized.slice(index + 1);
  return normalized;
}

/** 推荐卡：venue 已经带年份时（如 IROS 2026），不再重复渲染 `· 2026`。 */
export function shouldShowYear(venue: string | null | undefined, year: number | null | undefined): boolean {
  if (!year) return false;
  const name = String(venue ?? '');
  return !new RegExp(`(^|\\D)${year}(\\D|$)`).test(name);
}

/** 0..1 -> 0..100 的安全百分比 */
export function percentOf(part: number, whole: number): number {
  if (!whole || whole <= 0) return 0;
  return clamp(Math.round((part / whole) * 100), 0, 100);
}

export function truncateText(text: string, maxLength: number): string {
  const value = String(text ?? '');
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}
