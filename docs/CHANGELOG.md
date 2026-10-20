# 变更记录

## [0.1.2] - 2026-10-20

- 去掉已在 DSH 0.2.1 停发的 `@deepseek-ai/dsh-invariants` 依赖；运行时依赖只剩
  `@deepseek-ai/dsh-atomic-write` 0.2.1-rc.2 与 `@deepseek-ai/schemastery`，锁文件不再安装停发包。
- 声明 `@deepseek-ai/dsh` 的双端 peer 区间 `>=0.2.0-rc.2 <0.3.0-0` 并标记 `optional`，
  DSH 0.2 宿主由此判断兼容；开发依赖的 cordis 随之升到 4.0.5，与 DSH 0.2.1-rc.2 宿主一致。
- 新增清单契约用例 PACK-03，守住"不得再引用停发包"和 peer 区间写法。

## [0.1.1] - 2026-10-08

- 下载拒绝不安全资产名，处理文件系统短写、截断响应及阻塞流取消，失败时保留已有安装包。
- 托盘与原生更新对话框支持中文和英文，并增加双语市场元数据。
- 功能用例与自动化实现统一维护在两个测试文件中，兼容用例使用固定上游 Host 源码。
- 新增私有 npm 发布工作流、发布账号及包完整性检查，支持已有标签手动重试。
- CI 在 Windows 执行安装包相关用例，避免 Ubuntu 的不支持平台分支跳过发布门禁。

[0.1.1]: https://github.com/sobermh/tokens_DshVersionUpdates_code/compare/2ff0e212b5d487b6762c4c1412d59b83c89eab3a...v0.1.1
[0.1.2]: https://github.com/sobermh/tokens_DshVersionUpdates_code/compare/v0.1.1...v0.1.2
