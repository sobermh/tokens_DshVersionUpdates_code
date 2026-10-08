# 私有 npm 发布

包名：`@tokens/dsh-version-updates`；仓库：`sobermh/tokens_DshVersionUpdates_code`。
发布目标固定为 https://npm.tokensapi.ai/，发布账号必须是 `tokenscowork`。
Registry 的 ACL 负责访问控制；依赖安装从公共 npm 获取，不会向公共 npm 发布。

## 工作流与触发

`.github/workflows/publish-npm.yml` 按用户指定保留三种入口：

- 推送 `main`：运行检查和 tarball 验证，不发布。
- 推送 `vX.Y.Z` 标签：标签版本必须与该提交的 package.json 一致，检查通过后发布。
- 手动运行：`publish` 默认 false，只检查。填写已有 `release_tag` 可检查该标签；
  要重试发布，填写标签并显式勾选 `publish`。不接受不存在的标签或预发布标签。

标签解析为 Git 提交 SHA，后续检查和发布均检出相同 SHA。
手动标签与自动标签发布共用并发锁，运行不会被中途取消。
发布任务依赖本次运行的检查任务；其他运行的绿色状态不能替代这个门槛。
默认不上传 tarball 为公开 Actions artifact。

## 检查与构建

项目使用 npm 和 package-lock.json，运行 `npm ci --ignore-scripts`。
`.npmrc` 中的 `legacy-peer-deps=true` 固定原有 RC.6 客户端依赖的兼容安装方式：
上游 peer 范围会解析到要求 RC.7 的包，严格 peer 解析会冲突；不以升级宿主依赖来修复发布配置。
CI 使用 Node 22.19.0、24、26，覆盖声明的最低版本及当前偶数版本线。
`>=24` 是开放范围，不代表未来所有 Node 版本已经验证。

CI 通过 `node test/run-test-cases.mjs --upstream` 读取固定仓库和完整提交，检出真实 Host 源码到 `.test-host/desktop`，
再执行与本地相同的 `npm run check`（语法、类型、客户端构建、全部测试）。
现有测试也查询公开产品 Release，网络或 Release 不完整会让检查失败。

打包使用 `npm pack --ignore-scripts --pack-destination .release`：构建已单独完成，
跳过 prepack。`scripts/verify-tarball.mjs` 校验实际包中所有运行时文件，包含
`dist/client.js`、Cordis 加载补丁、声明及文案模块，拒绝额外文件、链接或缺失资源。
发布阶段重新构建同一提交并验证 tarball，最终发布的就是该阶段验证的同一文件。
安装包消费者不需要现场构建客户端。

## 凭据和不可覆盖保护

在当前 GitHub 仓库 Settings → Secrets and variables → Actions 配置
`VERDACCIO_PUBLISH_TOKEN`。不将 token 放在仓库文件、命令参数或文档中。
setup-node 为私有 Registry 生成认证配置，token 仅注入最后的发布步骤。
缺少 Secret 时明确报错；Registry 身份检查必须返回 `tokenscowork`。

发布前查询准确版本：仅 HTTP 404 允许发布；已存在的版本、鉴权错误、网络错误、
服务端错误或 202 都停止，不将失败当作“版本不存在”。并发锁配合 Registry
不可变版本保护，禁止覆盖或撤销已经发布的版本。

发布关闭生命周期脚本，显式设置私有 Registry 和 latest。
发布后查询准确版本和 latest，核对包身份及本地 tarball 的 SHA-512 integrity。
202 或尚未可查询的结果有界等待；仍未验证则报告失败，不自动再次发布。
重试时若准确版本已存在会拒绝重发，应核查原运行与 Registry，不能覆盖版本。

## 本地验证与启用

```sh
npm ci --ignore-scripts --registry=https://registry.npmjs.org/
npm run check
npm run test:cases
node scripts/validate-release.mjs
npm pack --ignore-scripts --pack-destination .release
node scripts/verify-tarball.mjs .release/<npm-pack-输出的文件名>.tgz
```

目录 `.release` 需先创建；发布测试使用隔离文件和模拟 Registry，不执行真实发布。
本次仅配置流程，版本保持 0.1.0；未经用户确认不提交、推送、创建标签或发布。
仓库当前 isFork=false。将来如果迁移到 fork，需检查真实 Actions 页面是否出现启用确认，
不能仅依赖 API active 状态；启用需获得授权。
本地检查通过不等于远程 Actions 或 Registry 发布已验证。
