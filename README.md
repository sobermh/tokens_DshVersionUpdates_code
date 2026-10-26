# TokensHarness Updates

`@tokens/dsh-version-updates` 是 TokensHarness 的独立 Cordis Host 插件。它优先读取公开的 GitHub Pages `releases.json`，从中选择 `draft=false`、`prerelease=false` 的最高稳定版本；索引不可用时降级读取 [`TokensAPI/tokens_TokensHarness_code`](https://github.com/TokensAPI/tokens_TokensHarness_code) 的 latest GitHub Release API，不使用 npm 作为产品版本源。

插件通过 `desktopRuntime` 使用 TokensHarness 提供的原生托盘、网络和确认对话框能力，并通过私有回环 `webServer` 接管 Desktop 顶部版本按钮。它自行流式下载、校验和打开 Windows / macOS 安装包，负责定时检查、手工检查、版本比较和提示历史；顶部按钮与托盘复用同一个手工检查任务。

发现可安装的新版本后，浏览器客户端会在侧栏底部与设置入口同排、靠右显示下载按钮；下载期间同一位置显示实时百分比。侧栏折叠时保留圆形下载图标和进度环，因此 macOS 不依赖系统托盘也能看到更新状态并开始下载。

当前产品版本以该仓库最高的正式稳定 Release 为准。Release 标签必须使用 `v<version>`，并发布以下安装包：

- `TokensHarness-<version>-windows-amd64-installer.exe`
- `TokensHarness-<version>-macos-arm64-installer.dmg`
- `TokensHarness-<version>-macos-amd64-installer.dmg`

## 版本源地址

默认主地址由 `githubOwner`、`githubRepo` 自动派生为 GitHub Pages
`releases.json`，降级地址自动派生为 GitHub latest Release API。需要换域名、
镜像或自建更新服务时，可以直接覆盖两个 HTTPS 地址：

```yaml
- id: tokens-version-updates
  config:
    releaseIndexURL: https://updates.example.com/releases.json
    releaseAPIURL: https://updates.example.com/releases/latest
```

`releaseIndexURL` 是优先读取的版本索引，`releaseAPIURL` 仅在主地址请求或解析失败时
使用。两个内置默认地址集中写在 `identity.js`；任一字段留空都会继续使用默认地址，
修改了 `githubOwner` / `githubRepo` 时则按新仓库自动派生。无效地址或非 HTTPS 地址
也会回退到对应默认值。

## 自动下载的适用范围

原生适配器只在**已打包**的 Windows / macOS 应用里开放自动下载（`isPackaged && (win32 || darwin)`）。在开发态 Electron、以及打包后的 Linux 上：

- 托盘的「Check Updates…」照常发起检查；
- 检查到新版本时，弹窗会明确告知本构建无法自动安装，并给出手动下载地址
  `https://github.com/<owner>/<repo>/releases/latest`；
- 不会出现确认下载弹窗，也不会写入安装包。

后台定时轮询仅在已打包应用中启用（`isPackaged && config.enabled`），开发态不会后台轮询，但手动检查仍会联网。

## 弹窗里的发布说明

检查更新的三个弹窗（已是最新、有新版本、确认下载）都会带上那一版的发布说明：
标题下第一段作为摘要，`## 本次更新` / `## What's New` 小节里最多 6 条要点（按正文
次序），再加一个「查看完整说明」按钮打开该版本自己的 Release 页
`…/releases/tag/v<version>`。正文按界面语言取中文或英文那半边，只抽纯文本，不渲染
Markdown。

摘要与每条要点各有上限，按**显示宽度**计（摘要 400 列、要点 180 列）：东亚宽字符
（汉字、假名、谚文、全角标点）记 2 列，其余记 1 列，所以 180 列正好是 90 个汉字，
也放得下一句 180 个字符的英文。不按字符个数计是因为一个汉字的显示宽度与信息量都
约等于两个英文字符——同一个「90 个字符」的额度，中文装得下一整句，英文只够一个
主语（真机上 412 个字符的那条英文要点只显示到 73 个字符就没了）。

超了**按句子缩短**：先只留放得下的整句（句末是中文的 `。！？` 或英文的 `.!?`；版本
号、小数和 `e.g.` 这类缩写里的点不算句末），放不下的整句一句都不留半截；首句本身
就超长时才退到子句标点（`，、；：,;:`）并补 `…`，一个可用标点都没有才按显示宽度
硬断。所以每条要点要么是完整的一句，要么明显是省略的一段，不会像硬断那样停在半句上
（「……只能手动退出再打开。现…」）。

正文的来源是版本索引里该 Release 的 `body`：

- 有新版本时取新版本的正文；
- 已是最新时取**已安装版本**的正文，按 `v<version>` 在同一份文档里找，
  即使它被标为 GitHub 预发布也能找到（产品的 0.7.x 就是这么发布的）；
- 只有文档里根本没有这一版时，才按 `…/releases/tags/v<version>` 多发一次请求取它
  的正文。这次请求的任何失败都只是没有说明。

解析是尽力而为：拿不到正文、正文为空或结构不符时，弹窗与加入发布说明之前逐字相同，
按钮里也不会出现「查看完整说明」。**检查更新本身绝不会因为解析发布说明而失败。**

## 安装包的存放位置

安装包默认落在**以产品名命名**的应用数据目录下的 `updates/<version>/`：

| 平台 | 默认位置 |
| --- | --- |
| Windows | `%APPDATA%\<产品名>\updates\<version>\` |
| macOS | `~/Library/Application Support/<产品名>/updates/<version>/` |
| 其余 | `$XDG_CONFIG_HOME/<产品名>/updates/<version>/`（未设时为 `~/.config`） |

产品名取 `config.productName`（默认 `TokensHarness`），所以在 TokensHarness 上就是
`%APPDATA%\TokensHarness\updates\<version>\`。注意它**不跟随宿主的 userData**：
DSH Desktop 在 `main.ts` 里硬编码了 `app.setName('DSH Desktop')`，宿主自己的状态仍写在
`%APPDATA%\DSH Desktop\` 下，安装包不再混在那里。产品名若无法作为单层目录名
（含路径分隔符、盘符、`..` 等），则退回宿主状态文件旁，宁可混在一起也不拼出非法路径。

要换位置，在档案的 `cordis.patch.yml` 里给本插件加上 `downloadDirectory`：

```yaml
- id: tokens-version-updates
  config:
    downloadDirectory: D:\Downloads\TokensHarness
```

档案目录是 `~/.dsh/profiles/<profile>/`，桌面端默认档案为 `desktop`；改完重启应用生效。
几点约定：

- 只接受**绝对路径**，以及 `~`、`~/x` 这类家目录写法；
- 相对路径（含 `./x`、`~user/x`）一律视为无效并回退到默认位置，因为它们的基准是
  桌面进程的 cwd，不可预期；
- 两种情形都再按版本号建子目录，所以不同版本的安装包不会互相覆盖。

## 已下载安装包的复用

开始下载前先看目标路径上是否已有同名文件：体积与 Release 声明一致、且重算
SHA-256 与 Release 声明的摘要完全吻合时，直接复用并拉起安装器，不再发出任何
下载请求。任一环节不满足（文件不在、体积不符、摘要不符、Release 未声明摘要）
都照常重新下载并覆盖。没有摘要就不复用，避免把一个无法验证的旧文件当成安装包
交给用户。

资产名称必须是单层文件名，路径分隔符、Windows 保留名和非法字符会被拒绝。
声明了有效大小时，完整下载的字节数必须一致；文件系统短写会继续写入剩余字节。
只有下载与校验完成后才替换目标文件，失败或取消保留旧文件并清理本次临时文件。

托盘与插件原生弹窗读取 `desktopRuntime.locale`：中文语言使用中文，英语及未知语言
使用英文。侧栏按钮按客户端页面语言显示。市场名称和简介提供 `zh-CN`、`en-US` 两套元数据，
需发布含这些元数据的新包后才会影响市场目录。

验证：

```sh
npm install
npm run check
```

## 宿主兼容范围

插件声明 `@deepseek-ai/dsh` 的 `peerDependencies` 为 `>=0.2.0-rc.2 <1.0.0-0`，并在
`peerDependenciesMeta` 里标记 `optional`。DSH 0.2 的宿主只按这一项判断兼容，不看
`dsh.engine`；上界必须手写 `-0`，否则 semver 会放过下一个主版本的预发布版。标记
`optional` 不会绕过宿主门禁，只是让 npm 不去解析安装，锁文件里不会多出第二份运行时副本。

上界只挡主版本，不卡 `0.x` 的小版本：版本号预测不了兼容性（内核 0.2.0→0.2.1 的 rc
小版本就打坏过别的插件），真正判断兼容的是下面的真实宿主契约门禁；上界写窄只会让契约
全绿的插件为改一行声明重发一版。

下界取本插件实际验证过的运行时（DSH 0.2.0-rc.2）。运行时侧只依赖
`@deepseek-ai/dsh-atomic-write` 与 `@deepseek-ai/schemastery`；不要引入已在 DSH 0.2.1
停发的 `@deepseek-ai/dsh-invariants`。

客户端侧的 `@deepseek-ai/*` 在构建时全部置为 external，名字由宿主在渲染时解析：**宿主改了导出名，
插件既不会在加载时报错，也不会被 peer 门禁拦住，只在界面真要用到那个组件时抛 React 错误。**
所以客户端的开发依赖必须跟住产品实际锁定的宿主版本（当前 0.2.1-rc.2），由用例 PACK-04 逐名核对
导出是否仍在；`TOKENS_HARNESS_ROOT` 指向真实宿主时它会再对宿主的同名包跑一遍。DSH 0.2 已停发
`@deepseek-ai/dsh-client-runtime`：客户端 `Context` 类型改从 `@deepseek-ai/cordis` 取，`slots`
坐席由 `@deepseek-ai/dsh-client-ui-renderer` 挂到 `Context` 上，`dsh.client.inject` 里的陌生包名
会被宿主模块图静默忽略，不要留着。

## 真实宿主契约测试

插件用到的**每一个**宿主接口都有一条对真实 staged 宿主的常驻用例
（`HOST-001`…`HOST-023`），宿主侧零打桩：宿主自带 launcher 起一次性
`$DSH_HOME`，真实 Loader 按 `inject` 激活本插件，`desktopRuntime` 由宿主自己的
`host-runtime-bridge.ts` 跨一对真实 `HostRpc` 投影，`webServer` 是宿主的
`DesktopWebServer` 真绑回环端口，浏览器 Cookie 由宿主自己签发。

```sh
# 产品门禁只传这一个变量：staged 宿主的 dsh-plugin-desktop 目录
DSH_HOST_ROOT=…\.build\desktop\dsh-plugin-desktop npm run check:host
```

没有 `DSH_HOST_ROOT` 时 23 条全部报 `NOT EXECUTED`、退出码为 1，不伪造通过。
接口与用例的逐条对照、三处脚本化边界、三个 staged 宿主的结果，见
[docs/host-interfaces.md](docs/host-interfaces.md)。

## 功能回归测试

`test/` 下有两类文件：

- [test_cases.csv](test/test_cases.csv)：唯一的用例定义和断言映射表。
- [run-test-cases.mjs](test/run-test-cases.mjs)：离线用例的自动化断言、隔离夹具和统一执行入口。
- [host-contract/](test/host-contract/)：真实宿主契约用例——`live-host.mjs`（宿主与夹具）、
  `client-runtime.mjs`（浏览器半边）、`cases.mjs`（断言）、`host-modules.mjs`（resolve hook）。

`npm test` 与 `npm run test:cases` 使用同一入口。在独立仓库执行：

`test_cases.csv` 是唯一的用例定义表，`run-test-cases.mjs` 是唯一的执行入口；
真实宿主契约用例的实现放在 `test/host-contract/`，仍由这张表和这个入口统辖。
每个保留的测试都必须关联 CSV 用例；执行器会将缺少映射、跳过及失败的测试判为未通过——
唯一的例外是报了 `NOT EXECUTED:` 的真实宿主契约用例，它们单列、不计入通过，
由 `npm run check:host` 判定理由是否可接受。

```sh
npm ci --ignore-scripts --registry=https://registry.npmjs.org/
npm run check
npm run test:cases
```

兼容用例直接编译真实上游 Host 桥接源码。CI 根据执行脚本中的 `TEST_UPSTREAM`
固定的提交检出到 `.test-host/desktop`；本地可使用同一目录，或以
`TOKENS_HARNESS_ROOT` 指定包含 `desktop/dsh-plugin-desktop/src` 的宿主项目根目录。
本地缺少专用目录时也会查找相邻的 TokensCowork 项目。

成功报告“全部通过”；失败列出用例和原因。代码测试不代表已经完成真实安装或界面验收。

## 私有 npm 发布

发布配置、凭据要求和手动重试见 [发布说明](docs/publishing.md)。
发布目标仅为 `https://npm.tokensapi.ai/`，插件包版本与产品 Release 版本独立。

## 插件版本记录

### 0.1.7

- 摘要与要点的额度改按**显示宽度**计（东亚宽字符 2 列、其余 1 列，要点 180 列、
  摘要 400 列），不再按字符个数。真机英文弹窗里 410 个字符的那条要点原来只显示到
  「…banner…」、看不出任何实质内容，现在能看到问题本身；170 个字符的第二条整句显示。
  见[弹窗里的发布说明](#弹窗里的发布说明)。
- 中文一个字都不会少：180 列正好等于原来的 90 个汉字，v0.7.5 的中文结果与 0.1.6
  逐字相同；v0.7.4 里混了版本号与标识符的几条从原来的截断处继续往下显示。
- 新增常驻用例 NOTES-09（单字符宽度、两个额度、英文要点的实质内容、中文结果与
  0.1.6 的输出夹具比对）；两次变异验证（宽字符权重改回 1、要点额度改回 90）各自让
  中文与英文那半边的断言变红。
- 只改额度的计量方式，句子／子句边界的判定与取正文的来源、容错逻辑一行未改。

### 0.1.6

- 弹窗里的要点不再被截在句子中间：超长时先只留放得下的整句，首句本身超长才退到
  子句标点并补 `…`，没有标点才硬断。真机上 v0.7.5 那条「……只能手动退出再打开。
  现…」现在是完整的一句。摘要段同样处理。见[弹窗里的发布说明](#弹窗里的发布说明)。
- 新增常驻用例 NOTES-07、NOTES-08，喂的是真实的 v0.7.5 与 v0.7.4 Release 正文；
  三次变异验证（去掉整句优先、去掉子句退让、英文句点一律当句末）各自只让这两条红。
- 只改 `release-notes.js` 的缩短逻辑，取正文的来源与容错逻辑一行未改。

### 0.1.5

- 检查更新的弹窗带上「更新了什么」：该版本的摘要与最多 6 条要点，外加一个
  「查看完整说明」按钮打开它自己的 Release 页。已是最新时显示已安装版本的说明。
  见[弹窗里的发布说明](#弹窗里的发布说明)。
- 解析容错：拿不到正文或结构不符时与原来逐字相同，检查更新不会因此失败。
- 新增 `release-notes.js`（纯函数解析）与常驻用例 NOTES-01…NOTES-06，其中
  解析用例喂的是真实的 v0.7.4 Release 正文。

### 0.1.4

- `check:host` 的汇总不再依赖 Node 选中的测试报告器：Node 22 把结果写成 TAP，
  Node 23 起恒为 spec，只认 spec 让 CI 上 23/23 的运行汇总成 0/0。两种格式都解析，
  并和报告器自己打印的计数对账，对不上就报"读不懂测试报告"而不是汇总为 0（GATE-01）。
- `@deepseek-ai/dsh` 的 peer 上界放宽到 `<1.0.0-0`（下界不动），上界只挡主版本。
- 只改测试基建与声明，运行时代码与客户端产物未改。

### 0.1.3

- 新增真实宿主契约用例 `HOST-001`…`HOST-023` 与常驻命令 `npm run check:host`，
  以及变异验证脚本 `scripts/verify-host-contract-mutations.mjs`。只加测试与文档，
  运行时代码与客户端产物未改。详见 [docs/host-interfaces.md](docs/host-interfaces.md)。

### 0.1.2

- 去掉已在 DSH 0.2.1 停发的 `@deepseek-ai/dsh-invariants` 依赖，运行时依赖升到
  `@deepseek-ai/dsh-atomic-write` 0.2.1-rc.2（该版本已不再要求它）。
- 声明 `@deepseek-ai/dsh` 的双端 peer 区间并标记 `optional`，让 DSH 0.2 宿主能判断兼容。
- 修正侧栏下载按钮的图标导出名：DSH 0.2.0 起 `IconDownloadOutline16` 已改名，改用
  `IconDownloadOutlineRegular`，并把客户端开发依赖对齐到宿主的 0.2.1-rc.2。

### 0.1.1

- 加强安装包文件名、下载大小、短写及取消校验，下载失败时保留原有文件。
- 原生结果弹窗及托盘标签支持中英文，按宿主当前语言生成文案。
- 测试统一为 CSV 与执行器两个文件，补齐自动化映射及私有 npm 发布校验。
