# TokensHarness Updates

`@tokens/dsh-version-updates` 是 TokensHarness 的独立 Cordis Host 插件。它只读取公开仓库 [`TokensAPI/tokens_TokensHarness_code`](https://github.com/TokensAPI/tokens_TokensHarness_code) 的 latest GitHub Release，不使用 npm 作为产品版本源。

插件通过 `desktopRuntime` 使用 TokensHarness 提供的原生托盘、网络、确认对话框和安装器交接能力。它负责定时检查、手工检查、版本比较和提示历史；Windows 与 macOS 的实际安装包下载及打开仍由 Desktop 原生适配器负责。

当前产品版本以该仓库的 latest Release 为准。Release 标签必须使用 `v<version>`，并发布以下安装包：

- `TokensHarness-<version>-windows-amd64-installer.exe`
- `TokensHarness-<version>-macos-arm64-installer.dmg`
- `TokensHarness-<version>-macos-amd64-installer.dmg`

## 自动下载的适用范围

原生适配器只在**已打包**的 Windows / macOS 应用里开放自动下载（`isPackaged && (win32 || darwin)`）。在开发态 Electron、以及打包后的 Linux 上：

- 托盘的「Check for Updates…」照常发起检查；
- 检查到新版本时，弹窗会明确告知本构建无法自动安装，并给出手动下载地址
  `https://github.com/<owner>/<repo>/releases/latest`；
- 不会出现确认下载弹窗，也不会写入安装包。

后台定时轮询仅在已打包应用中启用（`isPackaged && config.enabled`），开发态永不联网。

验证：

```sh
npm install
npm run check
```
