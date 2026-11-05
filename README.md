# 每日头条 · Daily Briefing Skill

**按你关心的主题整理信息。几天没看，也能从上次接着补读。**

由 [@羊羊Leo](https://github.com/yangyangleo-ai) 从自己使用的日报与补读周报流程提炼。MIT 开源，欢迎修改与持续维护。

## 你会得到什么

- **研究 Skill**：优先原始来源，分清日期、事实、判断和待核项。
- **通用配置与输出格式**：把关注主题、来源偏好和时间范围写清楚。
- **离线导出工具**：用已整理的 JSON 生成 HTML / Markdown / JSON，按日期保留，并提供 latest 与历史目录。
- **虚构演示和测试**：不用账号或 API Key 就能先看导出效果。

研究依赖你所用 AI 宿主的检索、浏览和文件能力；使用 AI 仍可能消耗该产品用量。配套 Node.js 工具本身不联网、不调用模型，不附带已部署的定时器。它把 AI 整理好的内容变成可保存的阅读档。

## 先看效果：零依赖离线演示

需要 Node.js 18 或以上版本；本次发布在 Node.js 24 环境验证。下载本仓库 ZIP 并解压，或使用 Git 克隆，然后在仓库目录运行：

```sh
node skills/daily-briefing/scripts/briefing.mjs demo --output ./demo-output
```

用浏览器打开 `demo-output/latest.html`，历史目录是 `demo-output/index.html`。**演示内容是原创虚构数据，页面有明显标识，不是真实新闻。**

也可以下载后查看仓库附带的 [离线示例](examples/offline/latest.html)。GitHub 文件预览显示源码；下载文件后在本地浏览器打开。

## 安装 Skill

完整 Skill 在 [`skills/daily-briefing`](skills/daily-briefing)，脚本、模板和格式说明都随这个目录一起分发。已有同名 Skill 时，先比对或备份，避免重复和覆盖。

### Codex

将整个 `daily-briefing` 文件夹复制到你选择的 Skill 目录，例如个人目录 `~/.agents/skills/`。Windows 对应 `%USERPROFILE%\.agents\skills\`。也可以在你自己的项目中使用 `.agents/skills/`。

复制完成后，显式输入 `$daily-briefing` 使用。若宿主未显示新 Skill，按产品说明刷新或重启。附带的 UI 元数据默认关闭隐式调用；它不会替你修改全局偏好。

目录与使用方式依据 [Codex 官方说明](https://learn.chatgpt.com/docs/build-skills)，文件格式依据 [Agent Skills 规范](https://agentskills.io/specification)。其他宿主请按其实际支持的方法导入整个 Skill 文件夹；本项目不声称已逐一验证所有宿主。

## 用自己的主题开始

1. 初始化个人工作目录：

   ```sh
   node skills/daily-briefing/scripts/briefing.mjs init --dir ./workspace
   ```

2. 编辑 `workspace/profile.json`，换成自己的主题、来源偏好和时区。不要提交私人配置到公共仓库。
3. 向具备公开检索和文件能力的 AI 发出任务，例如：

   ```text
   使用 $daily-briefing。
   读取我的 workspace/profile.json 和上期归档。
   从上次核验截止接着整理到今天，先给最重要的三件事。
   优先官方原文，分别记录事件日期、来源发布时间和核验时间。
   事实与判断分开；原文取不到就标待核，不用旧闻凑数。
   按 Skill 的 edition 格式写入 workspace/input/本期日期.json，
   然后校验并导出到 workspace/output，保留旧期。
   ```

4. AI 整理好 JSON 后，可手动导出：

   ```sh
   node skills/daily-briefing/scripts/briefing.mjs render --input ./workspace/input/2026-11-06.json --output ./workspace/output
   ```

   将示例日期换成本期实际文件名。完整字段见 [edition 格式](skills/daily-briefing/references/edition-format.md)。

没有 shell / 文件能力的宿主仍可按方法在对话交付阅读稿；文件导出需要你或具备相应能力的宿主执行。

## 为什么这样组织

先确定关注范围和时间，再查来源、核对、整理。每条内容保留原始链接，分开写事实摘要、与自己的关系、编辑判断及未核项。漏看几天时，补读范围延续上次截止，旧事件保留原日期。

导出器对重复输入幂等；同日期不同内容默认报冲突，保留原件。构建较早一期不会让 latest 回退。临时写入与 rename 提供的是**单文件**原子替换；不承诺所有输出文件组成一个事务。一次错误退出后应检查输出状态再重跑。

## 定时运行

先按需跑通，再在你使用的宿主中配置调度。参见 [定时运行说明](docs/scheduling.md)。仅下载本仓库或安装 Skill 不会创建后台任务；电脑休眠、断网、登录过期和用量限制也不会因此自动解决。

## 维护与验证

```sh
npm test
```

当前测试覆盖示例导出、配置初始化、重复与历史处理、冲突拒绝、非法日期/URL、HTML 转义等。它们验证本地工具行为，不代表新闻真实性由程序自动保证。研究步骤仍需来源核验。

本仓库不包含原私人日报、持仓偏好、账号状态、凭据、本机路径或完整第三方文章。公共示例和新闻摘要不替用户作交易或其他对外行动。

问题和改进请见 [参与维护](CONTRIBUTING.md)，版本记录见 [CHANGELOG](CHANGELOG.md)。
