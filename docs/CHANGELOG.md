# 变更记录

## [0.1.7] - 2026-10-26

弹窗里的英文要点不再被砍得只剩主语。

- 摘要与单条要点的额度改按**显示宽度**计：东亚宽字符（CJK 统一表意文字、全角标点、
  假名、谚文等）记 2 列，其余记 1 列；要点 180 列、摘要 400 列。导出的常量随之改名
  `MAX_RELEASE_HIGHLIGHT_COLUMNS` / `MAX_RELEASE_SUMMARY_COLUMNS`，并导出
  `displayWidth(value)`。
- 这修的是真机英文弹窗：第一条要点原句 410 个字符，按字符个数算只显示到
  「The "Restart now" button on the plugin market's "restart required" banner…」，
  看不出任何实质内容；同一份正文的中文那条 95 个字完整显示。根因是一个汉字的显示
  宽度与信息量都约等于两个英文字符，于是同一个「90 个字符」的额度，中文够一整句、
  英文只够一个主语。现在英文那条看得到问题本身，第二条 170 个字符整句显示。
- 中文输出不退：180 列正好是原来的 90 个汉字，v0.7.5 的中文结果与 0.1.6 逐字相同；
  v0.7.4 里混了版本号与标识符（`code`、`INTERNAL_UNKNOWN`、版本号）的几条按列算
  本来就占得少，从原来的截断处继续往下显示，不会换个地方截。
- 新增常驻用例 `NOTES-09` 与夹具 `test/fixtures/release-notes-0.1.6-output.json`
  （0.1.6 对两份真实正文的输出，用来逐条比对中文那半边）。变异验证两条：宽字符权重
  改回 1 让 v0.7.5 的中文逐字断言变红（那条要点会溢出成 232 列），要点额度改回 90
  让英文的实质内容断言变红。
- 句子／子句边界的判定、取正文的来源与容错逻辑、弹窗文案与按钮都没有动。

## [0.1.6] - 2026-10-26

弹窗里的要点不再被截在句子中间。

- 摘要与要点超过字数上限时改为**按句子缩短**：先只留放得下的整句，放不下的整句一句
  都不留半截，也不在整句之后再补省略号；首句本身就超长时退到落在后 40% 以内的最后
  一个子句标点（`，、；：,;:`）并补 `…`；连可用标点都没有才按字数硬断。句末按中文的
  `。！？` 与英文的 `.!?` 认，版本号、小数（`0.7.5`）与 `e.g.` 这类缩写里的点不算
  句末。
- 这修的是真机现象：v0.7.5 的第一条要点被按 90 字硬截成「……只能手动退出再打开。
  现…」，用户问"为什么有『现…』"。那条首句是 89 字，现在整句显示。
- 新增常驻用例 `NOTES-07`（真实的 v0.7.5 与 v0.7.4 正文，四种语言下每条要点与摘要
  都以句末标点或省略号收尾）与 `NOTES-08`（退让次序、硬断上限、版本号与缩写）。
  新增夹具 `test/fixtures/release-notes-v0.7.5.md`，逐字取自该版本的 Release 正文。
- 变异验证三条，各自只让 NOTES-07 / NOTES-08 变红，其余 NOTES 与弹窗用例不动：去掉
  「先留整句」回到硬截（两条红）、去掉子句退让只按词边界（两条红）、英文句点一律当
  句末（NOTES-08 红）。
- 取正文的来源与容错逻辑、弹窗文案与按钮都没有动；运行时其余代码与客户端产物未改。

## [0.1.5] - 2026-10-25

检查更新的弹窗带上"更新了什么"。

- 三个弹窗（已是最新、有新版本、确认下载）都加上该版本发布说明里的摘要（标题下第一
  段）与最多 6 条要点（`## 本次更新` / `## What's New` 小节，按正文次序），并多一个
  「查看完整说明」按钮，打开该版本自己的 Release 页 `…/releases/tag/v<version>`。点
  这个按钮会开浏览器并重新弹出弹窗，让用户接着选；它不是答复，重弹次数有上限，到顶
  按取消键处理，所以"稍后"仍是确认下载弹窗的默认键与取消键。
- 正文按界面语言取中文或英文那半边，只抽纯文本（去掉标题、列表符号、链接与代码号，
  emoji 保留），摘要与每条要点各有字数上限。产品的发布说明模板只有中文半边有摘要段，
  英文弹窗因此只有要点。
- 已是最新时显示的是**已安装版本**的说明：它按 `v<version>` 在同一份版本索引里找，
  即使被标成 GitHub 预发布也找得到（产品的 0.7.x 就是这么发的），所以不额外发请求；
  只有索引里根本没有这一版时，才按 `…/releases/tags/v<version>` 多发一次请求取正文。
- 解析一律尽力而为：拿不到正文、正文为空或结构不符时，弹窗与加入发布说明之前逐字
  相同，也不出现「查看完整说明」按钮。**检查更新不会因为解析发布说明而失败**，按 tag
  取正文的那次请求失败也只是没有说明。
- 新增 `release-notes.js`（纯函数解析，不碰网络与 Electron）与常驻用例
  `NOTES-01`…`NOTES-06`：解析用例喂的是真实的 TokensCowork v0.7.4 Release 正文
  （`test/fixtures/release-notes-v0.7.4.md`）。`HOST-010` 增加一条断言：结果里的正文
  经真实宿主桥原样到达；对应变异 `drop-release-notes` 验证它不是空转。

## [0.1.4] - 2026-10-23

只改测试基建与清单声明，运行时代码与客户端产物一行未改。

- 修 `npm run check:host` 在 CI 上把全绿的运行判成失败：它从子进程的测试报告里数
  `✔ HOST-\d+` 行，那是 `spec` 报告器的格式，而 Node 22 在 stdout 不是终端时默认写
  TAP（`ok 1 - …`），Node 23 起才恒为 `spec`。v0.7.4 的 Windows 门禁跑在 Node
  22.23.2 上，于是 23 条用例 `# pass 23 / # fail 0` 却汇总成「通过 0/0」、退出码 1
  （T0050）；本机 Node 24 复现不出来。
- 新增 `scripts/test-report-summary.mjs`：一个纯函数，两种报告器格式都解析，并把
  报告器自己打印的计数（`ℹ pass N` / `# pass N`）与数出来的用例行对账——对不上就
  报「读不懂测试报告」，所以将来再冒出第三种格式会明着失败，不会悄悄汇总成 0。
  `scripts/verify-host-contract-mutations.mjs` 同一处假设一并改掉。
- 新增常驻用例 GATE-01：把三条临时用例分别在 `tap`、`spec` 和本机默认报告器下真跑
  一遍，要求三份输出解析出同一份通过/失败/未执行；再解析一段 CI 当时打印的 TAP 片段，
  以及一段没有用例行只有计数的未知格式，要求后者报错而不是汇总为 0。
- `@deepseek-ai/dsh` 的 peer 上界由 `<0.3.0-0` 放宽到 `<1.0.0-0`，下界
  `>=0.2.0-rc.2` 不动：上界只挡主版本，小版本的兼容性由 `check:host` 的真实宿主契约
  门禁把关（用户 2026-10-22 的策略）。PACK-03 同步加断言，窄上界会判失败。

## [0.1.3] - 2026-10-22

只加测试与文档，运行时代码与客户端产物一行未改。

- 新增真实宿主契约用例 `HOST-001`…`HOST-023`，覆盖本插件用到的**每一个**宿主接口，
  各对真实 staged 宿主真调一次：真实 Loader 的 `inject` 激活与门禁、条目 config 管道、
  经宿主 `host-runtime-bridge.ts` 投影的 `desktopRuntime`（`updates` 快照、`request`、
  `locale`、`registerTrayItem`/`refresh`/`invoke`、`confirmDownload`、
  `showManualCheckResult`）、真实 `DesktopWebServer` 上的精确路由与同源围栏、
  真实 Connection 上的 RPC 通道与其认证围栏、`@deepseek-ai/dsh-atomic-write`、
  fiber 卸载、宿主自己的 `evaluatePluginCompatibility`、安装包落盘与复用，
  以及浏览器半边的 `__ModuleLoader__` 协议、真实 `SlotRegistry` 坐席与真实
  浏览器 Connection 回环。宿主侧零打桩，详见 [`docs/host-interfaces.md`](host-interfaces.md)。
- 新增常驻命令 `npm run check:host`：只认 `DSH_HOST_ROOT`（staged 宿主的
  `dsh-plugin-desktop` 目录），内部映射到本仓库原有的 `TOKENS_HOST_ROOT` /
  `TOKENS_HARNESS_ROOT` / `DSH_RUNTIME_ROOT`。没有宿主时 23 条全部报
  `NOT EXECUTED` 且退出码为 1；只有「本代宿主没有这个接口」和「本平台不发布该产物」
  两类理由会被单列接受，其余未执行一律判失败。
- 新增 `scripts/verify-host-contract-mutations.mjs`：逐个把被测路径弄坏，
  要求**恰好**预期的那几条用例变红，防止契约用例空转或写得过死。
- 三个 staged 宿主实测：0.2.1-rc.2 与 0.2.0-rc.2 各 23/23；0.1.5-rc.2 19/23，
  未执行的四条都是本代宿主没有该接口（0.1 的 app-boot 无兼容评估器、0.1 线是
  DSH 0.2 之前的浏览器运行时）。
- `test/test_cases.csv` 仍是唯一用例清单，新增 23 行；`npm test` 把未执行的契约
  用例单列、不计入通过，也不因缺宿主而变红。

## [0.1.2] - 2026-10-20

- 去掉已在 DSH 0.2.1 停发的 `@deepseek-ai/dsh-invariants` 依赖；运行时依赖只剩
  `@deepseek-ai/dsh-atomic-write` 0.2.1-rc.2 与 `@deepseek-ai/schemastery`，锁文件不再安装停发包。
- 声明 `@deepseek-ai/dsh` 的双端 peer 区间 `>=0.2.0-rc.2 <0.3.0-0` 并标记 `optional`，
  DSH 0.2 宿主由此判断兼容；开发依赖的 cordis 随之升到 4.0.5，与 DSH 0.2.1-rc.2 宿主一致。
- 新增清单契约用例 PACK-03，守住"不得再引用停发包"和 peer 区间写法。
- 修复侧栏下载按钮在 DSH 0.2 宿主上渲染即崩：`@deepseek-ai/dsh-client-ui-primitives` 自 0.2.0-rc.2
  起把 `IconDownloadOutline16` 改名为 `IconDownloadOutlineRegular`，而客户端产物把 `@deepseek-ai/*`
  置为 external、名字在渲染时才解析，所以加载和 peer 门禁都发现不了，只在真有可用更新时抛错。
- 客户端开发依赖对齐到产品锁定的宿主版本 0.2.1-rc.2（`dsh-api-remotes`、`dsh-client-ui-primitives`、
  `dsh-client-ui-sidebar`、`dsh-client-ui-slots`，新增 `dsh-client-ui-renderer`）；DSH 0.2 已停发
  `@deepseek-ai/dsh-client-runtime`，客户端 `Context` 类型改从 `@deepseek-ai/cordis` 取、`slots`
  坐席由 `dsh-client-ui-renderer` 提供，并从 `dsh.client.inject` 去掉这个已不存在的包名。
- `@deepseek-ai/schemastery` 下界提到 `^3.18.5`，与产品注入的运行时依赖一致（3.18.5 需要
  `cosmokit` 1.8.6 的 `createVolatile`，3.18.1 的闭包与线上不同）。
- 新增用例 PACK-04：按客户端入口的值导入逐名核对运行时包的真实导出，并在
  `TOKENS_HARNESS_ROOT` 指向真实宿主时对宿主的同名包重跑一遍。

## [0.1.1] - 2026-10-08

- 下载拒绝不安全资产名，处理文件系统短写、截断响应及阻塞流取消，失败时保留已有安装包。
- 托盘与原生更新对话框支持中文和英文，并增加双语市场元数据。
- 功能用例与自动化实现统一维护在两个测试文件中，兼容用例使用固定上游 Host 源码。
- 新增私有 npm 发布工作流、发布账号及包完整性检查，支持已有标签手动重试。
- CI 在 Windows 执行安装包相关用例，避免 Ubuntu 的不支持平台分支跳过发布门禁。

[0.1.1]: https://github.com/sobermh/tokens_DshVersionUpdates_code/compare/2ff0e212b5d487b6762c4c1412d59b83c89eab3a...v0.1.1
[0.1.2]: https://github.com/sobermh/tokens_DshVersionUpdates_code/compare/v0.1.1...v0.1.2
[0.1.3]: https://github.com/sobermh/tokens_DshVersionUpdates_code/compare/v0.1.2...v0.1.3
[0.1.4]: https://github.com/sobermh/tokens_DshVersionUpdates_code/compare/v0.1.3...v0.1.4
[0.1.5]: https://github.com/sobermh/tokens_DshVersionUpdates_code/compare/v0.1.4...v0.1.5
[0.1.6]: https://github.com/sobermh/tokens_DshVersionUpdates_code/compare/v0.1.5...v0.1.6
[0.1.7]: https://github.com/sobermh/tokens_DshVersionUpdates_code/compare/v0.1.6...v0.1.7
