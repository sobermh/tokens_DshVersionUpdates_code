# TokensHarness Updates

`@tokens/dsh-version-updates` 是 TokensHarness 的独立 Cordis Host 插件。它优先读取公开的 GitHub Pages `releases.json`，从中选择 `draft=false`、`prerelease=false` 的最高稳定版本；索引不可用时降级读取 [`TokensAPI/tokens_TokensHarness_code`](https://github.com/TokensAPI/tokens_TokensHarness_code) 的 latest GitHub Release API，不使用 npm 作为产品版本源。

插件通过 `desktopRuntime` 使用 TokensHarness 提供的原生托盘、网络和确认对话框能力，并自行流式下载、校验和打开 Windows / macOS 安装包。它负责定时检查、手工检查、版本比较和提示历史。

发现可安装的新版本后，浏览器客户端会在侧栏底部、设置入口上方显示下载按钮；下载期间同一位置显示实时百分比。侧栏折叠时保留圆形下载图标和进度环，因此 macOS 不依赖系统托盘也能看到更新状态并开始下载。

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

后台定时轮询仅在已打包应用中启用（`isPackaged && config.enabled`），开发态永不联网。

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

验证：

```sh
npm install
npm run check
```
