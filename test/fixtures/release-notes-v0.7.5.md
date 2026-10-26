# TokensCowork v0.7.5

在 v0.7.4 基础上的修正版：插件市场的"立即重启"按钮在用户取消过一次重启确认后仍然可用，不再只能手动退出重开。内核版本与内置插件与 v0.7.4 相同。

[中文](#user-content-release-notes-zh) | [English](#user-content-release-notes-en)

<a name="release-notes-zh"></a>

## 本次更新

### 🐛 问题修复

- 插件市场"需要重启才能完全生效"横幅上的"立即重启"：内核的重启请求在确认框被关掉后（包括点"取消"）就把重启记成"已完成"，之后在本次运行里再点都没有反应，只能手动退出再打开。现在取消后可以再次点击、重新弹出确认框；重启进行中仍只弹一次。

### ⚠️ 其他变更

- 产品版本使用 v0.7.5，发布时设置 GitHub Pre-release 标记；升级与降级说明与 v0.7.0 相同，仍不支持回退到 0.5.x。

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
| Windows | amd64 | [EXE](https://github.com/TokensAPI/TokensCowork/releases/download/v0.7.5/TokensCowork-0.7.5-windows-amd64-installer.exe) |
| macOS | arm64 | [DMG](https://github.com/TokensAPI/TokensCowork/releases/download/v0.7.5/TokensCowork-0.7.5-macos-arm64-installer.dmg) |
| macOS | amd64 | [DMG](https://github.com/TokensAPI/TokensCowork/releases/download/v0.7.5/TokensCowork-0.7.5-macos-amd64-installer.dmg) |

[SHA-256](https://github.com/TokensAPI/TokensCowork/releases/download/v0.7.5/TokensCowork-0.7.5-SHA256SUMS.txt) · [plugins.json](https://github.com/TokensAPI/TokensCowork/releases/download/v0.7.5/TokensCowork-0.7.5-plugins.json)

## 安装说明

### Windows

完全退出 TokensCowork，再运行 amd64 安装器。安装器未签名，核对仓库及 SHA-256 后安装。

### macOS

按处理器选择 arm64 或 amd64 DMG，将应用拖入"应用程序"。应用由发布流程签名并经 Apple 公证。

## 验证结果

- 重启按钮覆盖：用例以 transform 模式加载真实上游 `desktop-actions.ts`（仅把内核 Service 基类换成空壳）：上游取消一次后第二次不再弹框、覆盖后每次都弹，进行中复用同一请求、失败后可重试、锚点漂移报错；构建代码回归 180 项、覆盖体检 86 条 0 变化、staging 的 Desktop 类型检查通过。
- 完整产品门禁 21 步在 CI 的 Windows 质量门禁中执行（含插件真实内核契约与内置插件功能回归），与 v0.7.4 相同。
- 真机：v0.7.4 上重启横幅已出现、文案正确；"取消后再点有效"这一项待 v0.7.5 安装后验收。

## 已知限制

- 与 v0.7.4 相同：通过 TokensAPI 使用 gpt 系列模型时上游渠道目前只接受 Codex 客户端，发送会失败；Discover 首页的视觉验收尚未完成；降级回 0.5.x 会丢失迁移后的设置与会话显示；切换模型后向路由保存失败时按钮退回原模型并写日志，不弹提示；市场"发现"页首次打开仍需约 1–2 秒。
- 插件热更新改到已加载的共享依赖时仍需重启才完全生效，这是内核的限制；市场会提示并提供一键重启。

## 完整变更

[TokensCowork v0.7.4…v0.7.5](https://github.com/TokensAPI/TokensCowork/compare/v0.7.4...v0.7.5)

<a name="release-notes-en"></a>

## What's New

### 🐛 Bug Fixes

- The "Restart now" button on the plugin market's "restart required" banner: the core marked a restart as completed as soon as the confirmation dialog closed, including on Cancel, so later clicks in the same run did nothing and the only way out was to quit and reopen by hand. Cancelling now leaves the button usable and the confirmation appears again; a restart already in progress is still asked for only once.

### ⚠️ Other Changes

- The product version is v0.7.5 and is marked as a GitHub Pre-release; upgrade and downgrade notes are unchanged from v0.7.0, and downgrading to 0.5.x is still unsupported.

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
| Windows | amd64 | [EXE](https://github.com/TokensAPI/TokensCowork/releases/download/v0.7.5/TokensCowork-0.7.5-windows-amd64-installer.exe) |
| macOS | arm64 | [DMG](https://github.com/TokensAPI/TokensCowork/releases/download/v0.7.5/TokensCowork-0.7.5-macos-arm64-installer.dmg) |
| macOS | amd64 | [DMG](https://github.com/TokensAPI/TokensCowork/releases/download/v0.7.5/TokensCowork-0.7.5-macos-amd64-installer.dmg) |

[SHA-256](https://github.com/TokensAPI/TokensCowork/releases/download/v0.7.5/TokensCowork-0.7.5-SHA256SUMS.txt) · [plugins.json](https://github.com/TokensAPI/TokensCowork/releases/download/v0.7.5/TokensCowork-0.7.5-plugins.json)

## Installation

### Windows Installation

Exit TokensCowork before running the amd64 installer. It is unsigned; verify the repository and SHA-256.

### macOS Installation

Choose the DMG matching your processor and drag the app into Applications. The app is signed by the release pipeline and notarized by Apple.

## Verification

Restart-button overlay: the test loads the real upstream `desktop-actions.ts` in transform mode (only the core Service base class is stubbed) and shows that upstream stops asking after one cancelled confirmation while the overlay asks every time, an in-flight request is reused, a failed request can be retried and a drifted anchor fails loudly; build-code regression 180 cases, overlay doctor 86 overlays unchanged, and the staged Desktop typecheck passed. The full 21-step product gate runs in CI's Windows quality gate (including plugin real-core contracts and the built-in plugin regression), as for v0.7.4. On a real device v0.7.4 already showed the restart banner with the right copy; "the button works again after Cancel" is to be accepted once v0.7.5 is installed.

## Known Limitations

Same as v0.7.4: GPT models via TokensAPI currently fail to send because the upstream channel only accepts the Codex client; visual acceptance of the Discover home is pending; downgrading to 0.5.x loses the display of migrated settings and sessions; a failed route save after a model pick reverts the button and logs the reason without a toast; the first open of the market Discover still takes about 1–2 seconds. A plugin hot update that replaces already-loaded shared dependencies still needs a restart to take full effect, which is a core limitation; the market says so and offers a one-click restart.

## Full Changelog

[TokensCowork v0.7.4…v0.7.5](https://github.com/TokensAPI/TokensCowork/compare/v0.7.4...v0.7.5)

<!-- tokenscowork:distribution=bundled -->
