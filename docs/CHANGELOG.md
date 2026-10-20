# 变更记录

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
