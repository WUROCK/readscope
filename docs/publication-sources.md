# 文献出处与补查 · 2026-11-01

## 为什么之前连续推荐都没有期刊名

旧版只从最新 arXiv 投稿中挑论文，并读取可选的 `journal_ref` 字段。作者没有填写时，程序直接显示“暂未收录期刊或会议信息”，没有进一步查询。arXiv 的首次提交日期也不能作为正式发表年份。字段含义见 [arXiv API 说明](https://info.arxiv.org/help/api/user-manual.html)。

## 当前行为

- “论文”模式优先从 Crossref 检索相关的期刊文章和会议论文；当前研究画像围绕 RIS、ISAC、毫米波雷达和人体感知，检索 IEEE 出版记录。
- 网络不可用时，优先从随应用附带的 36 篇核验论文中选择；最后才尝试 arXiv。只有预印本可用时，界面会说明发表信息尚未核实。
- 已有今日记录缺少出处时，先按 DOI 查询；没有 DOI 时仅接受规范化后完整一致的标题。相似标题、歧义记录、预印本记录和未来发表日期不会被误配为正式发表信息。
- 补查命中会保存期刊/会议名、正式年份、DOI 和出版链接；未命中时尝试追加有出版出处的新推荐，原历史保留。
- 点击卡片“核对出版记录”可以查看 DOI 对应的出版页面。
- 有效补查缓存 7 天，明确无结果缓存 6 小时；网络故障和限流不缓存为“没有出处”。候选论文池缓存 24 小时，连续换篇时复用结果。

Crossref 元数据由出版社及可信来源提供，接口和筛选说明见 [REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/) 与 [筛选字段](https://www.crossref.org/documentation/retrieve-metadata/rest-api/rest-api-filters/)。程序只展示可核实信息，不保证每篇预印本都有正式发表记录。

## 兼容性与验证

原有 CSV 列顺序不变，在末尾增加 `publication_year`、`publication_doi`、`publication_url`、`venue_source`、`venue_status`。读取旧文件时缺失字段按空值处理，补查不删除历史条目。

- 服务端共 63 项回归通过，含严格匹配、错误 DOI、歧义、超时、缓存、旧今日记录升级和离线连续十篇场景。
- `npm run test:recommendations:live` 已通过十次真实接口刷新，十篇均有期刊/会议和 DOI，互不重复；报告为 `artifacts/recommendation-smoke/summary.json`。
- 隐藏窗口的 71 项界面检查及 15 项窗口/日志检查通过。

公开备用池可用 `scripts/import-published-seed.mjs <Crossref-records.json> --write` 从原始公开 Crossref 记录重建。每条资源保留 DOI 核验链接；没有摘要时明确显示未提供摘要，不生成虚构结论。
