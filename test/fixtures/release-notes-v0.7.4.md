# TokensCowork v0.7.4

在 v0.7.3 基础上的维护版：发布流程新增"插件真实内核契约"门禁，每个内置插件与市场插件在装配好的内核上把自己用到的接口各真调一次，任一失败即不发版；四个内置插件随之更新到带契约用例的版本；内核日志不再把 `code` 字段当密钥脱敏，错误码可读；插件市场在热更新无法替换已加载依赖时提示重启并提供一键重启。内核版本与 v0.7.3 相同。

[中文](#user-content-release-notes-zh) | [English](#user-content-release-notes-en)

<a name="release-notes-zh"></a>

## 本次更新

### 🐛 问题修复

- 内核日志：上游脱敏规则把任何名为 `code` 的字段都当作密钥改写成 `***`，错误码（如 `INTERNAL_UNKNOWN`、HTTP 状态）在日志里看不到，排查连接中心等插件故障时无从下手。现在 `code` 一律不脱敏；`auth_code` / `authorization_code`、URL 查询串里的 code 与长 token 规则保持上游原样。
- 插件市场：插件热更新只替换插件自身模块，已加载的共享依赖仍运行旧代码，内核日志写明"changed modules keep running their previous code until a restart"，但界面无任何提示，用户以为更新已生效（连接中心 2.9.7 更新后微信仍报错，重启后才恢复）。现在市场页在这种情况下显示横幅，说明哪个插件需要重启才能生效，并提供一键重启。
- "联网搜索"升到 0.2.4：修复一个真实缺陷——凭据服务在插件之后激活时，插件里的 API Key 永远读不到、静默走无 Key 额度；现在每次按需读取凭据。

### ⚠️ 其他变更

- 发布门禁新增"插件真实内核契约"步骤，内置插件功能回归也改为在同一门禁里用装配好的内核执行（以前是没有内核的独立任务，预发布不跑）：`build.mjs check` 与 CI 的 Windows 质量门禁最后一步把每个内置插件（按 pin）和市场插件（按仓库默认分支）隔离检出，带 `DSH_HOST_ROOT` 跑它们自己的 `npm run check:host`，插件用到的每个内核接口都对装配好的内核各调一次；任一插件红即不发版。预发布构建也跑，不再只在转稳定版时验插件。0.7.0–0.7.3 连接中心在 DSH 0.2.1 上全部故障却四个版本没被发现，就是因为以前没有这一步。
- 内置插件更新到带契约用例的版本（运行时代码除联网搜索外未变）："TokensAPI 账户" 0.1.12（15 条）、"TokensAPI 模型" 0.2.28（29 条，并修正两条用例映射；输入框模型菜单用例所需的 zustand/immer 改由插件自己钉住，不再依赖门禁之外的目录）、"联网搜索" 0.2.4（18 条，变异验证常驻；test:cases 与 check:host 共用同一个"跑没跑"判定）、"TokensCowork 更新" 0.1.4（23 条，变异验证常驻；契约报告解析同时认 spec 与 tap 报告器并与计数对账，不再因 CI 的 Node 22 默认 tap 输出而汇总成 0/0）。
- 市场插件同步更新（通过插件市场获取，不随安装包）：连接中心 2.9.7 修复 DSH 0.2.1 要求显式 Peer 导致所有渠道（微信等）调用内核返回 `INTERNAL_UNKNOWN` 的问题，并新增 11 个网关端点、11 个渠道与 11 条完整真实内核的契约用例；**更新连接中心后需重启 TokensCowork 才生效**。工具按需加载 0.2.8、插件体检 0.4.7、会议转写 0.2.14 各自新增真实内核契约用例与变异验证。
- 内核兼容声明策略调整：插件的内核 peer 上界改为 `<1.0.0-0`（只拦主版本），下界保持最低验证过的内核；内核小版本升级不再要求重新发布契约仍绿的插件，由契约门禁而不是版本区间把关。各插件在下次发版时逐个采用（本次已采用：工具按需加载 0.2.8、TokensCowork 更新 0.1.4、联网搜索 0.2.4；其余内置插件没有 peer 声明）。
- 产品版本使用 v0.7.4，发布时设置 GitHub Pre-release 标记；升级与降级说明与 v0.7.0 相同，仍不支持回退到 0.5.x。

### 内置组件与插件

| 组件 | 版本 |
|---|---|
| Desktop | 2.0.18 |
| DSH | 0.2.1-rc.2 |
| TokensCowork 更新 | 0.1.4 |
| Tokens Cowork UI | 0.2.24 |
| TokensAPI 账户 | 0.1.12 |
| TokensAPI 模型 | 0.2.28 |
| 联网搜索 | 0.2.4 |
| 循环护栏 | 0.1.0 |

## 下载说明

| 系统 | 架构 | 安装包 |
|---|---|---|
| Windows | amd64 | [EXE](https://github.com/TokensAPI/TokensCowork/releases/download/v0.7.4/TokensCowork-0.7.4-windows-amd64-installer.exe) |
| macOS | arm64 | [DMG](https://github.com/TokensAPI/TokensCowork/releases/download/v0.7.4/TokensCowork-0.7.4-macos-arm64-installer.dmg) |
| macOS | amd64 | [DMG](https://github.com/TokensAPI/TokensCowork/releases/download/v0.7.4/TokensCowork-0.7.4-macos-amd64-installer.dmg) |

[SHA-256](https://github.com/TokensAPI/TokensCowork/releases/download/v0.7.4/TokensCowork-0.7.4-SHA256SUMS.txt) · [plugins.json](https://github.com/TokensAPI/TokensCowork/releases/download/v0.7.4/TokensCowork-0.7.4-plugins.json)

## 安装说明

### Windows

完全退出 TokensCowork，再运行 amd64 安装器。安装器未签名，核对仓库及 SHA-256 后安装。

### macOS

按处理器选择 arm64 或 amd64 DMG，将应用拖入"应用程序"。应用由发布流程签名并经 Apple 公证。

## 验证结果

- 插件契约门禁有效性：把连接中心 2.9.6 的桥换进当前用例，在 0.2.1-rc.2 内核上 HOST-RPC / HOST-CHANNEL 整段红（错误与用户微信截图一致），2.9.7 绿；同一个 2.9.6 桥在 0.2.0-rc.2 上绿，证明不是误报。各插件自带的变异验证在 0.2.1-rc.2 / 0.2.0-rc.2 / 0.1.5-rc.2 三条内核线上逐条命中预期用例。
- 内置插件契约：账户 15/15 × 3 内核；模型 29/29（0.2.1、0.2.0）、0.1.5 上 6 条按代际显式未执行；联网搜索 18/18 × 3 内核；更新 23/23（0.2.1、0.2.0）、0.1.5 上 4 条显式未执行。
- 内核日志脱敏：覆盖用例与上游 diagnostics.spec 同步，`code` 不再脱敏、`auth_code` 仍脱敏；覆盖体检与构建代码回归通过。
- 完整产品门禁（`build.mjs check`）21 步通过：装配、immutable 安装、运行时补丁、压缩与 RPC smoke、插件编译与裁剪、许可证、Fabric/Market 检查、配置、Desktop 编译、typecheck、closure/CLI/Loader/Profile 校验、品牌门禁，以及新增的插件真实内核契约（6 个内置 + 4 个市场插件，2 个无 agent 的内置插件按配置豁免）和随后以同一内核跑的内置插件功能回归；市场插件重启提示：外层 55 项、staging 三个 tsconfig 类型检查与 vitest 354 项通过，两处变异验证命中。
- 尚未在真实设备上执行 v0.7.4 安装包的安装与上述功能验收。

## 已知限制

- 与 v0.7.3 相同：通过 TokensAPI 使用 gpt 系列模型时上游渠道目前只接受 Codex 客户端，发送会失败；Discover 首页的视觉验收尚未完成；降级回 0.5.x 会丢失迁移后的设置与会话显示；切换模型后向路由保存失败时按钮退回原模型并写日志，不弹提示；市场"发现"页首次打开仍需约 1–2 秒。
- 插件热更新能否不重启即生效取决于改动是否触及已加载的共享依赖：触及时市场页会提示重启，这一提示在真实设备上的验收尚未完成。

## 完整变更

[TokensCowork v0.7.3…v0.7.4](https://github.com/TokensAPI/TokensCowork/compare/v0.7.3...v0.7.4)

<a name="release-notes-en"></a>

## What's New

### 🐛 Bug Fixes

- Core logs: the upstream redaction rule treated every field named `code` as a secret and rewrote it to `***`, so error codes (such as `INTERNAL_UNKNOWN` or HTTP statuses) never reached the log and plugin failures like Connect Hub's could not be diagnosed. `code` is no longer redacted; `auth_code` / `authorization_code`, `code` in URL query strings and the long-token rule stay as upstream.
- Plugin market: a hot update swaps only the plugin's own modules, shared dependencies already loaded keep running their previous code (the core logs "changed modules keep running their previous code until a restart"), but the UI said nothing, so users assumed the update had taken effect (WeChat kept failing after the Connect Hub 2.9.7 update until a restart). The market page now shows a banner naming the plugin that needs a restart to take effect, with a one-click restart.
- "Web Search" 0.2.4 fixes a real defect: when the credentials service activated after the plugin, the stored API key was never read and requests silently fell back to the keyless quota; credentials are now read on demand.

### ⚠️ Other Changes

- The release gate gains a "plugin real-core contract" step, and the built-in plugin regression now runs inside the same gate against the assembled core (it used to be a separate job without a core that pre-releases skipped): the last step of `build.mjs check` and of the CI Windows quality gate checks out every built-in plugin (at its pin) and every market plugin (at its repository default branch) in isolation and runs their own `npm run check:host` with `DSH_HOST_ROOT`, so each core API a plugin uses is called once against the assembled core; any red plugin blocks the release. Pre-release builds run it too instead of only stable promotions. Connect Hub was broken on DSH 0.2.1 in 0.7.0–0.7.3 for four releases without being noticed because this step did not exist.
- Built-in plugins move to versions carrying contract cases (runtime code unchanged except Web Search): "TokensAPI Account" 0.1.12 (15 cases), "TokensAPI Models" 0.2.28 (29 cases, two case mappings corrected; the zustand/immer the composer model-menu cases need are now pinned by the plugin itself instead of a directory outside the gate), "Web Search" 0.2.4 (18 cases, resident mutation verification; test:cases and check:host now share one executed-or-not verdict), "TokensCowork Updates" 0.1.4 (23 cases, resident mutation verification; the contract report parser now accepts both the spec and tap reporters and reconciles with the reporter counts, so CI's Node 22 tap output no longer sums to 0/0).
- Market plugins updated alongside (obtained from the plugin market, not bundled): Connect Hub 2.9.7 fixes DSH 0.2.1's explicit-Peer requirement that made every channel (WeChat and others) get `INTERNAL_UNKNOWN` from the core, and adds contract cases for 11 gateway endpoints, 11 channels and 11 full real-core flows; **restart TokensCowork after updating Connect Hub**. Progressive Tools 0.2.8, Plugin Check 0.4.7 and Meeting Transcription 0.2.14 each add real-core contract cases with mutation verification.
- Core compatibility policy: plugin core peer upper bounds become `<1.0.0-0` (block only a major), lower bounds stay at the lowest verified core; a core minor bump no longer forces republishing plugins whose contracts are green, the contract gate guards instead of the version range. Each plugin adopts it at its next release (adopted now: Progressive Tools 0.2.8, TokensCowork Updates 0.1.4, Web Search 0.2.4; the remaining built-ins declare no peers).
- The product version is v0.7.4 and is marked as a GitHub Pre-release; upgrade and downgrade notes are unchanged from v0.7.0, and downgrading to 0.5.x is still unsupported.

### Bundled Components and Plugins

| Component | Version |
|---|---|
| Desktop | 2.0.18 |
| DSH | 0.2.1-rc.2 |
| TokensCowork 更新 | 0.1.4 |
| Tokens Cowork UI | 0.2.24 |
| TokensAPI 账户 | 0.1.12 |
| TokensAPI 模型 | 0.2.28 |
| 联网搜索 | 0.2.4 |
| 循环护栏 | 0.1.0 |

## Downloads

| Platform | Architecture | Installer |
|---|---|---|
| Windows | amd64 | [EXE](https://github.com/TokensAPI/TokensCowork/releases/download/v0.7.4/TokensCowork-0.7.4-windows-amd64-installer.exe) |
| macOS | arm64 | [DMG](https://github.com/TokensAPI/TokensCowork/releases/download/v0.7.4/TokensCowork-0.7.4-macos-arm64-installer.dmg) |
| macOS | amd64 | [DMG](https://github.com/TokensAPI/TokensCowork/releases/download/v0.7.4/TokensCowork-0.7.4-macos-amd64-installer.dmg) |

[SHA-256](https://github.com/TokensAPI/TokensCowork/releases/download/v0.7.4/TokensCowork-0.7.4-SHA256SUMS.txt) · [plugins.json](https://github.com/TokensAPI/TokensCowork/releases/download/v0.7.4/TokensCowork-0.7.4-plugins.json)

## Installation

### Windows Installation

Exit TokensCowork before running the amd64 installer. It is unsigned; verify the repository and SHA-256.

### macOS Installation

Choose the DMG matching your processor and drag the app into Applications. The app is signed by the release pipeline and notarized by Apple.

## Verification

Gate validity: with the Connect Hub 2.9.6 bridge swapped into the current contract suite, the HOST-RPC / HOST-CHANNEL cases all fail on the 0.2.1-rc.2 core (the same error as the user's WeChat screenshot) and pass with 2.9.7; the same 2.9.6 bridge passes on 0.2.0-rc.2, so it is not a false positive. Each plugin's mutation verification hits exactly the expected cases on the 0.2.1-rc.2 / 0.2.0-rc.2 / 0.1.5-rc.2 core lines. Built-in contracts: Account 15/15 on all three cores; Models 29/29 on 0.2.1 and 0.2.0 with 6 cases explicitly not executed on 0.1.5; Web Search 18/18 on all three; Updates 23/23 on 0.2.1 and 0.2.0 with 4 explicitly not executed on 0.1.5. Core log redaction: the overlay cases are aligned with upstream diagnostics.spec, `code` is no longer redacted while `auth_code` still is; overlay doctor and build-code regression passed. The full product gate (`build.mjs check`) passed all 21 steps (assembly, immutable install, runtime patches, compaction and RPC smoke, plugin compilation and pruning, licenses, Fabric/Market checks, configuration, Desktop build, typecheck, closure/CLI/Loader/Profile verification, branding gate, and the new plugin real-core contracts for 6 built-in and 4 market plugins, with the 2 agent-less built-ins exempt by configuration, followed by the built-in plugin regression against the same core). Market restart prompt: 55 outer cases, the three staging tsconfig typechecks and 354 vitest cases passed, and both mutation checks hit. Installation and functional acceptance of the v0.7.4 installers on real devices have not been performed yet.

## Known Limitations

Same as v0.7.3: GPT models via TokensAPI currently fail to send because the upstream channel only accepts the Codex client; visual acceptance of the Discover home is pending; downgrading to 0.5.x loses the display of migrated settings and sessions; a failed route save after a model pick reverts the button and logs the reason without a toast; the first open of the market Discover still takes about 1–2 seconds. Whether a plugin hot update takes effect without a restart depends on whether it touches already-loaded shared dependencies: when it does, the market page asks for a restart, and that prompt has not yet been accepted on a real device.

## Full Changelog

[TokensCowork v0.7.3…v0.7.4](https://github.com/TokensAPI/TokensCowork/compare/v0.7.3...v0.7.4)

<!-- tokenscowork:distribution=bundled -->
