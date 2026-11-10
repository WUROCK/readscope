# 阅界 API 契约 v1

Base URL: `http://127.0.0.1:<port>/api`
Content-Type: `application/json; charset=utf-8`
All timestamps: ISO 8601 with timezone, e.g. `2026-10-29T10:30:00+08:00`.
All dates (day keys): `YYYY-MM-DD` in **Asia/Shanghai**.
All durations exposed to Web: **minutes (number, rounded)** unless a field name says `Seconds`.

Error shape (HTTP 4xx/5xx):

```json
{ "error": { "code": "BAD_REQUEST", "message": "总页数必须大于 0" } }
```

## Types (shared with `web/src/lib/types.ts`)

```ts
export type DomainId =
  | 'literature' | 'humanities' | 'business' | 'tech'
  | 'psychology' | 'arts' | 'education' | 'other';

export interface DomainStat {
  id: DomainId;
  name: string;          // 文学 / 人文社科 / 商业财经 / 科技 / 心理成长 / 艺术生活 / 教育学习 / 其他
  color: string;         // hex
  minutes: number;       // 本月阅读分钟
  books: number;         // 触达书籍数
  percent: number;       // 0-100, 占全部阅读时长比例
  covered: boolean;      // 本月是否触达
}

export interface Today {
  date: string;
  minutes: number;
  seconds: number;
  goalMinutes: number;       // default 45
  checkinMinutes: number;    // default 30
  goalPercent: number;       // 0-100 (cap 100 for ring, but can exceed? cap at 100)
  checkinPercent: number;    // 0-100 cap
  checkedIn: boolean;
  checkedInAt: string | null;
  checkedInSource: 'auto' | 'manual' | null;
  streak: number;            // 连续打卡天数（含今天，如果今天已打卡）
  remainingToGoal: number;   // max(0, goal - minutes)
  remainingToCheckin: number;// max(0, checkin - minutes)
}

export interface WeekDay {
  date: string;
  weekday: string;   // 一 二 三 四 五 六 日
  minutes: number;
  isToday: boolean;
  isFuture: boolean;
}

export interface CheckinDay {
  date: string;
  minutes: number;
  checkedIn: boolean;
  source: 'auto' | 'manual' | null;
}

export interface WereadBook {
  id: string;             // stable, 'wr:' + bookId
  bookId: string;
  title: string;
  author: string;
  cover: string | null;
  category: string;
  domain: DomainId;
  domainName: string;
  progress: number;       // 0-100 integer
  readingMinutes: number;
  lastReadAt: string | null;
  finished: boolean;
  readerLink: string | null;
  tags: string[];         // auto-derived Chinese tags, max 6 (category + domain)
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
    activeDays: number;     // days with minutes > 0
    averageMinutes: number; // over elapsed days of week
  };
  domains: {
    items: DomainStat[];    // always 8, fixed order
    covered: number;
    total: number;          // 8
    score: number;          // 0-100 = covered/total*100
    label: string;          // 深耕一域 / 稳步拓展 / 视野开阔 / 博览群书
    monthLabel: string;     // e.g. 2026年10月
  };
  books: WereadBook[];      // recent reading, max 8
  checkinHistory: CheckinDay[]; // last 30 days, oldest -> newest
  stats: {
    readDays: number;           // 本月阅读天数（兼容旧字段）
    totalMinutes: number;       // 本月阅读分钟（兼容旧字段）
    finishedBooks: number;      // 本月读完（兼容旧字段）
    monthMinutes: number;
    monthStartedBooks: number;
    monthFinishedBooks: number;
    monthReadDays: number;
    yearMinutes: number;
    yearStartedBooks: number;
    yearFinishedBooks: number;
    yearReadDays: number;
    annualMonths: { month: number; minutes: number }[]; // always 12, Jan->Dec
  };
  notice: string | null;
}

export interface ManualBook {
  id: string;
  title: string;
  author: string;
  totalPages: number;
  currentPage: number;
  progress: number;          // 0-100
  finished: boolean;
  domain: DomainId;
  domainName: string;
  tags: string[];
  estimatedMinutesRemaining: number;
  addedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface Paper {
  id: string;
  title: string;
  venue: string;
  year: number | null;
  url: string;
  doi: string;
  summary: string;
  status: 'todo' | 'reading' | 'done';
  tags: string[];
  totalPages: number;
  currentPage: number;
  progress: number;
  addedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface Recommendation {
  id: string;                 // short hash
  date: string;               // recommendation day
  type: 'paper' | 'article';
  title: string;
  venue: string;              // journal / conference / 公众号
  year: number | null;
  summary: string;            // ~50 Chinese chars for zh sources, <=140 chars for en
  url: string;
  source: 'arxiv' | 'curated' | 'wechat';
  sourceLabel: string;        // arXiv 实时检索 / 精选文献库 / 公众号：XXX
  tags: string[];
  language: 'zh' | 'en';
  fetchedAt: string;
}

export interface Settings {
  wereadConfigured: boolean;
  wereadKeyMasked: string | null;   // e.g. wrk-8f2d••••••••
  goalMinutes: number;
  checkinMinutes: number;
  researchTags: string[];
  recommendationSource: 'auto' | 'paper' | 'wechat' | 'curated'; // default paper
  readingOrder: string[]; // saved priority across WeRead + manual books; default []
  dataDir: string;
  recommendationsCsv: string;
  appVersion: string;
}
```

## Endpoints

### `GET /api/health`

```json
{ "ok": true, "version": "0.1.0", "dataDir": "...", "time": "..." }
```

### `GET /api/settings`
Returns `Settings`.

### `PUT /api/settings`
Body: any subset of
```json
{
  "wereadApiKey": "wrk-...",   // "" clears the key
  "goalMinutes": 45,
  "checkinMinutes": 30,
  "researchTags": ["RIS", "毫米波雷达"],
  "recommendationSource": "paper"
}
```
Validation: goal 15–240, checkin 5–240, tags 1–12 items (trim, dedupe). `readingOrder` is an optional array of at most 2000 nonempty book IDs (each at most 256 characters, deduplicated). Empty array restores recent-reading order. Returns `Settings`.

### `POST /api/weread/test`
Calls WeRead `/shelf/sync` with the stored key.
```json
{ "ok": true, "message": "已连接微信读书，书架 42 本", "bookCount": 42 }
```
On failure `200` with `{ "ok": false, "message": "API Key 无效或已过期" }` (do not 500 for bad keys).

### `GET /api/weread/overview?refresh=1`
Returns `WereadOverview`.
- No key → `source: "demo"`, `connected: false`, `notice: "当前为演示数据，连接微信读书后自动同步真实进度"`, `error: null`.
- Key present and API works → `source: "weread"`, `connected: true`.
- Key present but API fails → cached live data if available, else demo; `error` carries a short reason and `notice` warns; `source` stays `"demo"` if demo fallback. Never expose the key.
- `refresh=1` bypasses 90s cache.
- Overview also loads WeRead `/readdata/detail?mode=annually&baseTime=0` (1h cache) for `stats.yearMinutes`, `yearFinishedBooks`, `yearReadDays`, `annualMonths`; annual failure degrades those fields to 0 without breaking the page.
- `WereadBook.tags` are derived from category + domain; `ManualBook.tags` = auto tags from title/author/domain merged with user tags, max 6.
- Server auto-writes today's auto check-in row when `today.seconds >= checkinMinutes*60`.

### `GET /api/checkin/history?days=30`
```json
{ "days": [ { "date": "2026-10-01", "minutes": 52, "checkedIn": true, "source": "auto" } ] }
```
Ascending, newest last.

### `POST /api/checkin`
Manual check-in fallback (used when WeRead is unavailable).
Body `{ "minutes": 30, "note": "手动补记" }` (minutes optional, 0–600).
Returns `{ "day": CheckinDay, "today": Today }`.

### `POST /api/checkin/auto`
Lightweight background check used by the Electron main process when the window is hidden/minimized. It only calls WeRead `/readdata/detail` (weekly), using the 90s cache; it does **not** fetch the shelf or book progress.
Response:
```json
{ "configured": true, "date": "2026-10-29", "minutes": 30, "seconds": 1800,
  "checkedIn": true, "source": "auto", "changed": true, "updatedAt": "..." }
```
- No key: `{ "configured": false, "checkedIn": false, "changed": false }`
- WeRead error: same shape plus `"error": "无法连接微信读书服务"`; no throw, no write.
- Threshold uses `floor(seconds / 60)` so 29m59s does not check in.
- `?refresh=1` bypasses the weekly cache.

### `GET /api/books`
```json
{ "items": [ManualBook], "stats": { "reading": 2, "finished": 5, "totalPagesRead": 420 } }
```
Sorted by `updatedAt` desc. Demo mode with zero real books returns two `demo: true`-style sample items? **No** — `/api/books` is always the user's real local data (may be empty). Demo visual data for manual books lives only in the frontend fixtures, not in this API.

### `POST /api/books`
```json
{ "title": "毫米波雷达感知", "author": "张三", "totalPages": 320, "currentPage": 48,
  "domain": "tech", "tags": ["雷达", "感知"] }
```
`title` required; `totalPages` >= 1; `currentPage` 0..totalPages. Returns `{ "item": ManualBook }` (201).

### `PATCH /api/books/:id`
Body: `title?, author?, totalPages?, currentPage?, domain?, tags?`.
If `currentPage >= totalPages` mark finished. Returns `{ "item": ManualBook }`.

### `DELETE /api/books/:id`
`{ "ok": true }`

### `GET /api/papers`
```json
{
  "items": [Paper],
  "stats": { "todo": 3, "reading": 1, "done": 4, "total": 8 },
  "tagCounts": [ { "tag": "RIS", "count": 5 } ]
}
```
Sorted: reading → todo → done, each by `updatedAt` desc.

### `POST /api/papers`
```json
{ "title": "...", "venue": "IEEE TWC", "year": 2025, "url": "https://...",
  "doi": "", "summary": "一句话摘要", "status": "todo",
  "tags": ["RIS", "ISAC"], "totalPages": 14, "currentPage": 0 }
```
Only `title` required. Returns `{ "item": Paper }` (201).

### `PATCH /api/papers/:id`
Any editable field. `status: "done"` sets `currentPage = totalPages` (if totalPages > 0) and `finishedAt`; `status` back to reading/todo clears `finishedAt`. Returns `{ "item": Paper }`.

### `DELETE /api/papers/:id` → `{ "ok": true }`

### `GET /api/recommendations/today`
Returns:
```json
{
  "date": "2026-10-29",
  "item": Recommendation | null,
  "history": [Recommendation],          // last 8, newest first
  "stats": { "total": 23, "csvPath": "<dataDir>/recommendations.csv" },
  "sources": { "arxiv": "ok", "wechat": "idle" },
  "warning": null
}
```
If no row exists for today, generate one (may call live sources, max ~15s). Always returns 200; `item: null` + `warning` when all sources fail.

### `POST /api/recommendations/refresh`
Body `{ "source": "auto"|"paper"|"wechat"|"curated" }` (optional, overrides setting for this call).
Generates a **new** recommendation, appends a new CSV row with today's date (multiple rows/day allowed), returns same shape as `/today` plus `"replaced": true`.
De-dupes against every row in CSV by normalized URL and normalized title.

### `GET /api/recommendations/history?limit=100`
```json
{ "items": [Recommendation], "total": 23, "csvPath": "..." }
```
Newest first.

### `GET /api/recommendations/export`
`text/csv; charset=utf-8` download of `recommendations.csv` (BOM included).

### `POST /api/jobs/recommendations/warm`
Optional background warm-up (202). Not required by UI; may be omitted.

## Persistence

Root data dir: `<repo>/data` (override with `READSCOPE_DATA_DIR`).
- `settings.json` — key and preferences (never returned raw)
- `books.json` — `{ items: ManualBook[] }`
- `papers.json` — `{ items: Paper[] }`
- `checkins.csv` — `date,minutes,checked_in,source,updated_at` (UTF-8 BOM)
- `recommendations.csv` — `date,type,title,venue,year,summary,url,source,source_label,tags,language,fetched_at` (UTF-8 BOM)
- `cache/weread-*.json` — TTL caches
- `seed/curated_papers.json` — read-only curated pool (repo file)

All writes must be atomic-ish (write temp + rename) and serialized per file. Corrupt JSON → back up to `*.corrupt-<ts>` and start default.

## Domain mapping (server/src/domains)

WeRead category strings → DomainId (first match, case-insensitive, substring):
- 文学: 文学 / 小说 / 诗歌 / 散文 / 戏剧
- 人文社科: 历史 / 哲学 / 社会 / 文化 / 政治 / 军事 / 法律 / 宗教 / 人类学
- 商业财经: 经济 / 理财 / 商业 / 管理 / 投资 / 金融 / 创业
- 科技: 科技 / 科学 / 科普 / 计算机 / 互联网 / 工程 / 数学 / 物理 / 化学 / 生物 / 医学? (医学→科技)
- 心理成长: 心理 / 成长 / 励志 / 自我提升 / 幸福
- 艺术生活: 艺术 / 生活 / 健康 / 美食 / 旅行 / 摄影 / 音乐 / 设计
- 教育学习: 教育 / 学习 / 考试 / 语言 / 外语
- other: 其他 / 未分类 / 空

### Manual-book completion and progress

Manual-book `finished` is derived from the page counts. `progress` is 100 only at the final page; unfinished books cap at 99 even when rounding would produce 100. `GET /api/books` still returns all books and separate reading/finished counts. The reading UI separates completed books into a retained shelf instead of deleting records. PATCH with a lower current page reopens a book and clears `finishedAt`.
