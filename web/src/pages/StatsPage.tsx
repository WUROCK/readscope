import { formatHoursNumber, formatMinutes, parseDayKey, yearOf } from '../lib/format';
import type { AnnualMonth, WereadOverview } from '../lib/types';

export interface StatsPageProps {
  loading: boolean;
  overview: WereadOverview;
}

function fallbackAnnualMonths(currentMonth: number, monthMinutes: number): AnnualMonth[] {
  return Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    minutes: index + 1 === currentMonth ? monthMinutes : 0,
  }));
}

function StatsSkeleton() {
  return (
    <div className="page">
      <div className="page-stack stats-stack">
        <div className="stats-hero skeleton-line">
          <span className="sk sk-line sk-w30" />
          <span className="sk sk-number" />
          <span className="sk sk-line sk-w60" />
        </div>
        <div className="month-row">
          {[0, 1, 2].map((item) => (
            <div className="month-stat" key={item}>
              <span className="sk sk-line sk-w60" />
              <span className="sk sk-line sk-w40" />
            </div>
          ))}
        </div>
        <div className="chart-section">
          <span className="sk sk-line sk-w30" />
          <span className="sk sk-chart" />
        </div>
      </div>
    </div>
  );
}

/** 第二页：统计。扁平大数字 + 本月三列 + 无边框 12 月柱图。 */
export function StatsPage({ loading, overview }: StatsPageProps) {
  const todayDate = parseDayKey(overview.today.date);
  const currentMonth = todayDate ? todayDate.getMonth() + 1 : new Date().getMonth() + 1;
  const currentYear = yearOf(overview.today.date);
  const stats = overview.stats;

  const monthMinutes = stats.monthMinutes ?? stats.totalMinutes ?? 0;
  const monthStartedBooks = stats.monthStartedBooks ?? stats.finishedBooks ?? 0;
  const monthFinishedBooks = stats.monthFinishedBooks ?? stats.finishedBooks ?? 0;
  const monthReadDays = stats.monthReadDays ?? stats.readDays ?? 0;
  const annual =
    Array.isArray(stats.annualMonths) && stats.annualMonths.length === 12
      ? stats.annualMonths
      : fallbackAnnualMonths(currentMonth, monthMinutes);
  const annualSum = annual.reduce((sum, item) => sum + (Number(item.minutes) || 0), 0);
  const yearMinutes = stats.yearMinutes ?? annualSum;
  const yearFinishedBooks = stats.yearFinishedBooks ?? stats.finishedBooks ?? 0;
  const yearStartedBooks = stats.yearStartedBooks ?? yearFinishedBooks;
  const yearReadDays = stats.yearReadDays ?? monthReadDays;
  const maxMinutes = Math.max(...annual.map((item) => Number(item.minutes) || 0), 1);
  const currentMonthMinutes = annual[currentMonth - 1]?.minutes ?? monthMinutes;
  const peak = annual.reduce(
    (best, item) => (Number(item.minutes) > Number(best.minutes) ? item : best),
    annual[0] ?? { month: currentMonth, minutes: currentMonthMinutes },
  );

  if (loading) return <StatsSkeleton />;

  return (
    <div className="page">
      <div className="page-stack stats-stack">
        <section className="stats-hero" aria-label="年度阅读概览">
          <div className="stats-hero__top">
            <span className="eyebrow">今年累计阅读</span>
            <span className="stats-hero__year">{currentYear} 年</span>
          </div>
          <div className="stats-hero__number">
            {formatHoursNumber(yearMinutes)}
            <span>小时</span>
          </div>
          <div className="stats-hero__meta">
            <span>
              今年读过 <b>{yearStartedBooks}</b> 本
            </span>
            <span className="meta-dot" aria-hidden="true" />
            <span>已读完 {yearFinishedBooks} 本</span>
            <span className="meta-dot" aria-hidden="true" />
            <span>读了 {yearReadDays} 天</span>
          </div>
        </section>

        <div className="month-row" aria-label="本月阅读数据">
          <div className="month-stat">
            <span className="month-stat__label">本月阅读</span>
            <strong className="month-stat__value">{formatMinutes(monthMinutes)}</strong>
          </div>
          <div className="month-stat">
            <span className="month-stat__label">本月读过</span>
            <strong className="month-stat__value">
              {monthStartedBooks}
              <em>本</em>
            </strong>
          </div>
          <div className="month-stat">
            <span className="month-stat__label">本月阅读天数</span>
            <strong className="month-stat__value">
              {monthReadDays}
              <em>天</em>
            </strong>
          </div>
        </div>

        <section className="chart-section" aria-label="月度阅读趋势">
          <header className="section-head chart-head">
            <div className="section-head__title">
              <h2>月度阅读</h2>
              <span className="section-count">{currentYear} 年</span>
            </div>
            <span className="chart-current">本月 {formatMinutes(currentMonthMinutes)}</span>
          </header>

          <div
            className="month-chart"
            role="img"
            aria-label={`${currentYear} 年每月阅读时长，最高为 ${peak.month} 月的 ${formatMinutes(
              peak.minutes,
            )}`}
          >
            <div className="chart-grid" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="chart-bars" aria-hidden="true">
              {annual.map((item) => {
                const minutes = Math.max(0, Number(item.minutes) || 0);
                const height = minutes > 0 ? Math.max(3, (minutes / maxMinutes) * 100) : 1.5;
                const isCurrent = item.month === currentMonth;
                return (
                  <div
                    className={`chart-col${isCurrent ? ' is-current' : ''}`}
                    key={item.month}
                    title={`${item.month} 月 · ${formatMinutes(minutes)}`}
                  >
                    <span className="chart-bar" style={{ height: `${height}%` }} />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="chart-labels" aria-hidden="true">
            {annual.map((item) => (
              <span
                className={`chart-label${item.month === currentMonth ? ' is-current' : ''}`}
                key={`label-${item.month}`}
              >
                {item.month}月
              </span>
            ))}
          </div>

          <div className="chart-foot">
            <span>
              本周 {overview.week.activeDays} 天 · 日均 {overview.week.averageMinutes} 分钟
            </span>
            <span>本月读完 {monthFinishedBooks} 本</span>
          </div>
        </section>
      </div>
    </div>
  );
}
