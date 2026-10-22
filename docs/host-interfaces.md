# 宿主接口与真实宿主契约用例

本插件用到的**每一个** DSH 宿主接口，各有一条对真实 staged 宿主的常驻用例。
命令是 `npm run check:host`，用例编号 `HOST-001`…`HOST-023`，清单在
[`test/test_cases.csv`](../test/test_cases.csv)，实现在 [`test/host-contract/`](../test/host-contract/)。

## 怎么跑

```sh
# 产品门禁只传这一个变量：staged 宿主的 dsh-plugin-desktop 目录
DSH_HOST_ROOT=C:\…\.build\desktop\dsh-plugin-desktop npm run check:host

# 本地一次跑多个 staged 宿主（门禁不传这个）
DSH_HOST_ROOTS="…\.build\desktop\dsh-plugin-desktop;…\.build\desktop-v060\dsh-plugin-desktop" npm run check:host

# 变异验证：逐个把被测路径弄坏，要求恰好预期的用例变红
DSH_HOST_ROOT=… node scripts/verify-host-contract-mutations.mjs
```

`check:host` 内部把 `DSH_HOST_ROOT` 映射到本仓库原有的 `TOKENS_HOST_ROOT`
（契约夹具）、`TOKENS_HARNESS_ROOT` 与 `DSH_RUNTIME_ROOT`（既有用例），门禁不需要知道这些名字。

**fail closed**：没有 `DSH_HOST_ROOT` 时 23 条全部报 `NOT EXECUTED` 且退出码为 1。
只有两类未执行理由会被接受并单列——`host-generation:`（本代宿主没有这个接口）和
`platform:`（本平台不发布该产物）；其余一律判失败，用例不可能悄悄停跑。
`npm test` 会把未执行的用例单独列出、不计入通过，但不因缺宿主而变红。

## 文件分工

| 文件 | 职责 |
|---|---|
| `test/host-contract/live-host.mjs` | 用宿主自带 launcher 起一次性 profile；真实 webServer / credentials / connection；经真实 `host-runtime-bridge.ts` 投影 `desktopRuntime`；夹具家目录围栏 |
| `test/host-contract/client-runtime.mjs` | 浏览器半边：宿主的 `__ModuleLoader__` 协议、真实 `SlotRegistry`、真实浏览器 Connection |
| `test/host-contract/cases.mjs` | `HOST-001`…`HOST-023` 的断言 |
| `test/host-contract/host-modules.mjs` | 只读 resolve hook，把 `@deepseek-ai/*` 指向 staged 宿主 |
| `scripts/check-host-contracts.mjs` | `npm run check:host`：变量映射、多宿主、未执行理由的准入判定 |
| `scripts/verify-host-contract-mutations.mjs` | 变异验证矩阵 |

## 真实到什么程度

- 宿主**自己的** `@deepseek-ai/dsh-app-boot` 的 `boot()` 起一次性 `$DSH_HOME`，
  真实 Loader 按 `export const inject` 激活本插件，条目配置取产品
  `cordis.patch.yml` 里本插件那一行的实际值。
- `webServer` 是从 staged 宿主 `src/webserver.ts` 编译出来的 `DesktopWebServer`
  （上游 `dsh-host-webserver` 的产品子类），真绑 127.0.0.1 随机端口。
- `connection` 是宿主的 `@deepseek-ai/dsh-client-connection`，凭据落在真实
  `dsh-credentials-local` 上；浏览器 Cookie 由宿主自己的
  `authenticatedUrl()` + `authorizeIndex()` 签发，夹具只扮演载体。
- `desktopRuntime` 是宿主 `src/host-runtime-bridge.ts` 的 `createHostRuntime()`
  经一对真实 `HostRpc` 投影出来的对象——打包应用里 Host 进程拿到的就是它。
- 所有 `@deepseek-ai/*` 由只读 resolve hook 指向 staged 宿主，不会多出第二份运行时副本
  （会破坏 Cordis 的 module-local service symbol）。

### 三处脚本化（都不是宿主接口）

1. **桥另一端的 Electron 主进程**：夹具扮演原生适配器（`updates.request`、
   `confirmDownload`、`showManualCheckResult`、托盘宿主）。桥本身是真的，
   跨桥的每一次调用都真走了 RPC。
2. **外部 GitHub**：Release 索引、降级 API、安装包资产。
3. **浏览器的 Cookie 罐与渲染层**：产品把渲染层打进 `dsh-web-frontend/dist`，
   staged 树里 `@deepseek-ai/dsh-client-ui-primitives` 是 import `.module.css`
   的 ESM 源码，Node 里无法物化；插件从它取的两个名字由夹具提供，
   **HOST-022 对着 staged 宿主核对这两个名字仍然存在**。

### 夹具安全

每个会写盘的宿主服务都被钉在一次性 `$DSH_HOME` 里（`credentials-local` 同时传
`path` 与 `dshHome`），boot 之后断言 profile 目录、凭据文档、更新状态文件的路径
**都在临时目录内**，断言失败直接中止并删除该目录。开发者真实的 `~/.dsh` 绝不参与。

## 接口 ↔ 用例对照

| 宿主接口（插件真正依赖的部分） | 代码位置 | 用例 |
|---|---|---|
| Loader 按 `export const inject = ['desktopRuntime','webServer']` 激活；入口必须解析到本工作树 | `index.js:54` | HOST-001 |
| 未满足的 inject 必须让插件不运行（0.1 硬失败 / 0.2 warning 都接受） | 同上 | HOST-002 |
| 条目 `config` 经宿主 schemastery 管道到达 `apply`（`productName`/`githubOwner`/`githubRepo`/`releaseIndexURL`/`releaseAPIURL`） | `index.js:68-82,334-352` | HOST-003 |
| `desktopRuntime.updates` 快照：`isPackaged`/`canDownload`/`currentVersion`/`statePath` 经真实桥送达 | `index.js:333` | HOST-004 |
| `desktopRuntime.updates.request`（桥上的文本 IPC，Host 侧重建 `Response`） | `index.js:425` | HOST-005 |
| 同一 request 上的降级地址顺序 | `index.js:349-357,425` | HOST-006 |
| `desktopRuntime.locale`（桥上的实时 getter，切换后会重发托盘） | `index.js:466,483,501,640` | HOST-007 |
| `desktopRuntime.registerTrayItem`：`group`/`order`/`label()` 的跨桥投影与 `refresh()` | `index.js:635` | HOST-008 |
| 托盘 `invoke()` 从原生侧回到插件 | `index.js:645` | HOST-009 |
| `updates.confirmDownload` / `updates.showManualCheckResult`（无 Electron 时的回退路径） | `index.js:461,499` | HOST-010 |
| `webServer.port` + `webServer.register({kind:'exact'})` 的真实回环 HTTP | `index.js:647-657` | HOST-011 |
| 同一路由基于真实绑定端口的同源围栏（反向对照） | `index.js:243,935` | HOST-012 |
| `ctx.inject(['connection'])` 的响应式注入 + `connection.rpc.handle` | `index.js:677-690` | HOST-013 |
| 同一通道的 `download` 端点与未知端点 | `index.js:682-684` | HOST-014 |
| Connection 自己的认证与 Host 围栏（反向对照） | 宿主侧，经本插件通道观测 | HOST-015 |
| `@deepseek-ai/dsh-atomic-write` 的 `writeFileAtomic(adapter.statePath, …)` | `index.js:6,392` | HOST-016 |
| 真实 fiber 卸载时撤回托盘与路由 | `index.js:661-676` | HOST-017 |
| 宿主 app-boot 的 `evaluatePluginCompatibility` 对本插件声明的判定 | `package.json` peer | HOST-018 |
| 安装包字节走 `globalThis.fetch` 而**不**走宿主 IPC；落盘目录与复用 | `index.js:536-556`，`download.js` | HOST-019 |
| `adapter.canDownload=false` 时不提示安装 | `index.js:453-457` | HOST-020 |
| 宿主 `__ModuleLoader__` 协议 + 真实 `SlotRegistry` 的 `sidebar.footer.action` 坐席 | `src/client/index.tsx:144`，`dist/client.js` | HOST-021 |
| 渲染时才解析的名字：primitives 导出、sidebar 插槽声明、`dsh.client.inject` | `src/client/index.tsx:5`，`package.json` | HOST-022 |
| 坐席 `inject()` 面经真实浏览器 Connection 打到活宿主 | `src/client/index.tsx:137-152` | HOST-023 |

## 本地环境注意

- 本仓库主检出的 `node_modules` 是 0.1.2 之前装的（`dsh-client-ui-primitives`
  还是 0.1.0-rc.6，还留着已停发的 `dsh-client-runtime`/`dsh-invariants`），所以
  直接 `npm run typecheck` 会报 `IconDownloadOutlineRegular` 不存在——这是装的
  东西过期，不是代码问题。worktree 里不要 junction 这份 `node_modules`，按
  README 跑一次 `npm ci --ignore-scripts --registry=https://registry.npmjs.org/`。
- `.test-host/` 是 gitignore 的，新检出里是空的，所以 `COMPAT-01…03`（编译真实
  上游桥）会报「Current upstream source missing」。本机用
  `TOKENS_HARNESS_ROOT=…\.build` 即可，它下面就有 `desktop/dsh-plugin-desktop/src`。
  `check:host` 会自动从 `DSH_HOST_ROOT` 推出这个值。

## 顺带核实到的事实

- `connection.rpc.handle(channel, handler)` 在 **0.1.5-rc.2 / 0.2.0-rc.2 / 0.2.1-rc.2
  三代宿主上都只有两个参数**。插件多传的第三个 `{ authority: 'trusted-host' }` 从来没有
  被宿主读过，是死参数（JS 多传参数无副作用）。通道的真实准入规则由 Connection 自己决定：
  HOST-013 证明带宿主签发的 Cookie 能通，HOST-015 证明不带 Cookie 是 401、伪造 Host 是 403。
  本次只加用例、不动运行时代码，所以这个死参数保留，留给主控决定是否在下个功能版本清掉。
- `evaluatePluginCompatibility` 返回的「未满足项」字段在 0.2.0 叫 `peers`、0.2.1 叫
  `requirements`。插件两个都不读，HOST-018 两个名字都认。

## 不写死的口径（T0047 A″）

- 只断言插件真正依赖的东西：它调的接口存在且可调、它读的字段存在且类型对、
  它注册的插槽名在宿主词表里。**不**断言宿主全貌——没有 endpoint 全清单、
  没有事件词表大小、没有宿主内部字段/顺序/数量。宿主新增一律算兼容。
- 形状优先用宿主自己的判定：兼容性用宿主的 `evaluatePluginCompatibility`，
  插槽 `kind`/`scope` 读宿主 sidebar 产物自己的声明，Cookie 用宿主自己签发的，
  Loader 激活与否由宿主自己报告。
- 同一字段在不同代有不同名字时两边都认（0.2.0 的 `peers` 与 0.2.1 的
  `requirements`），不锁其中一个。
- 每条用例都有一条变异（`scripts/verify-host-contract-mutations.mjs`），
  必须**恰好**让它预期的那几条变红：少了说明用例是空转，多了说明写太死、
  以后升级会乱红。

## 三个 staged 宿主的结果

| 宿主 | DSH | 结果 |
|---|---|---|
| `.build/desktop`（2.0.18 / 0.7.x） | 0.2.1-rc.2 | 23/23 |
| `.build/desktop-v060`（2.0.17 / 0.6.x） | 0.2.0-rc.2 | 23/23 |
| `.build/desktop-v0525`（2.0.9 / 0.5.x） | 0.1.5-rc.2 | 19/23，4 条 `host-generation` 未执行 |

0.1.5-rc.2 上未执行的四条，以及**为什么它们不该执行**：

- `HOST-018`：0.1 的 app-boot 没有 `evaluatePluginCompatibility`。任何一个 0.2 宿主
  都能一次性判出三个运行时版本，所以矩阵仍是全的。
- `HOST-021` / `HOST-022` / `HOST-023`：0.1 线是 DSH 0.2 之前的浏览器运行时
  （slot core 没有 Factory 注册，primitives 还叫 `IconDownloadOutline16`）。
  本插件的客户端半边是对着 DSH 0.2 渲染层写的；0.5.x 产品线钉的是旧版本的本插件。

**顺带结论**：本插件的**宿主半边**在 0.1.5-rc.2 上 19 条全绿，也就是说运行时那半边
实际上仍然兼容 DSH 0.1；声明的 peer 下界 `>=0.2.0-rc.2` 是由客户端半边决定的。
这是现状记录，不是改下界的理由——0.5.x 线不升级本插件。
