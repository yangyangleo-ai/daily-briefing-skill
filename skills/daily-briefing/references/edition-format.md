# edition JSON 格式 v1

完整可运行示例见 [`../assets/example.edition.json`](../assets/example.edition.json)。以下为导出器接受的固定字段；未知字段会被拒绝，避免输入错误悄悄丢失。

## 顶层字段

| 字段 | 类型 | 含义 |
|---|---|---|
| schemaVersion | 数字，固定 1 | 文件格式版本 |
| cadence | daily 或 weekly | 日档或补读周档标签，不创建日程 |
| editionDate | YYYY-MM-DD | 本期档案日期，也是安全文件名 |
| title | 非空字符串 | 本期标题 |
| periodStart / periodEnd | YYYY-MM-DD | 覆盖的事件时段，start ≤ end ≤ editionDate |
| verifiedThrough | 带秒和时区的 RFC3339 时间 | 整期实际核验截止，例如 2026-11-06T00:30:00+08:00 |
| timeZone | 非空字符串 | 有效时区，例如 Asia/Taipei 或 UTC |
| isDemo | 布尔值 | 虚构示例必须为 true；脚本会显著标注 |
| items | 1—200 项条目数组 | 下表所列格式；无新条目时对话说明，不凑内容导出 |

## 每条 items

| 字段 | 类型 | 含义 |
|---|---|---|
| id | 同期唯一的 1—80 字符标识 | 首字符为小写字母或数字，其余仅小写字母、数字、下划线、连字符 |
| topic / title | 非空字符串 | 主题与条目标题 |
| eventDate | YYYY-MM-DD 或 null | 事件日期；未知则 null，不从核验日期推断 |
| sourcePublishedAt | RFC3339 或 null | 来源发布时间；未知填 null |
| verifiedAt | RFC3339 或 null | 本次逐条核验时间；verified / partial 时必填 |
| summary | 非空字符串 | 来源支持的事实短摘要 |
| whyItMatters | 非空字符串 | 与配置主题的关系，避免把推断写成事实 |
| editorialNote | 非空字符串 | 编辑判断、缺口或限制；没有额外判断可明确写“本项仅记录公告，未作使用效果验证” |
| verificationStatus | verified / partial / unverified | 来源核验状态，不是产品运行或用户体验认证 |
| sources | 非空来源数组 | 每项仅含非空 title 和绝对 http/https url |

已知来源发布时间不得晚于逐条核验时间；核验时间不得晚于 verifiedThrough。时间必须有时区，日期必须是真实日历日期。HTTP 链接仍可能受访问或网络条件影响；格式校验不证明来源内容真实。

写作时保留原始事实、可核推断和未知项的区别。导出器只校验字段与生成阅读页，不替代 AI 或人的来源核对。

## 输出与冲突

导出生成 `YYYY-MM-DD.json`、`.md`、`.html`，以及 `latest.md`、`latest.html`、`index.html`。同日期相同内容可以重跑；不同内容会报冲突，先保留现有原件并决定另立日期/版本，不能靠删除历史掩盖改动。

latest 按档案日期选取，导出较旧档案不使其回退。脚本有单目录并发锁和单文件原子替换；不提供所有文件组成的原子事务。进程异常后，核对文件与遗留锁，再按实际状态恢复，不自动清除可能仍由其他进程持有的锁。
