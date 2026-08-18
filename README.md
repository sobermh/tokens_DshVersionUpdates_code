# TokensHarness Updates

`@tokens/dsh-version-updates` 是 TokensHarness 的独立 Cordis Host 插件。它只读取公开仓库 [`TokensAPI/tokens_TokensHarness_code`](https://github.com/TokensAPI/tokens_TokensHarness_code) 的 latest GitHub Release，不使用 npm 作为产品版本源。

插件通过 `desktopRuntime` 使用 TokensHarness 提供的原生托盘、网络、确认对话框和安装器交接能力。它负责定时检查、手工检查、版本比较和提示历史；Windows 与 macOS 的实际安装包下载及打开仍由 Desktop 原生适配器负责。

当前产品版本以该仓库的 latest Release 为准。Release 标签必须使用 `v<version>`，并发布以下安装包：

- `TokensHarness-<version>-windows-amd64-installer.exe`
- `TokensHarness-<version>-macos-arm64-installer.dmg`
- `TokensHarness-<version>-macos-amd64-installer.dmg`

验证：

```sh
npm install
npm run check
```
