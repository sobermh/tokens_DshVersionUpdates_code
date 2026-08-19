/** 插件全部可调参数的唯一入口：改品牌、版本源、下载源、轮询节奏只改本文件。 */

/* ====================================================================
 * 身份常量
 * package.json 与 cordis.patch.yml 无法执行 JS，须与本文件手工保持
 * 一致；test/plugin.test.js 会校验两者，失配即测试失败。
 * ==================================================================== */

/** 产品名：用于 User-Agent、弹窗与托盘菜单等用户可见文案。可被 config.productName 覆盖。 */
export const PRODUCT_NAME = 'TokensHarness'

/** npm 包名：须与 package.json 的 name 和 cordis.patch.yml 的 name 一致。 */
export const PACKAGE_NAME = '@tokens/dsh-version-updates'

/** Cordis 插件名：harness 日志与加载器中显示的名字。 */
export const PLUGIN_NAME = 'tokens-dsh-version-updates'

/* ====================================================================
 * 版本源与下载源
 * 每项均为 Config 同名字段的默认值，用户可经 profile 补丁覆盖。
 * ==================================================================== */

/** 产品发布仓库：GitHub Release 版本源。可被 config.githubOwner / githubRepo 覆盖。 */
export const GITHUB_OWNER = 'TokensAPI'
export const GITHUB_REPO = 'tokens_TokensHarness_code'

/** 由发布仓库派生的 latest Release 端点。 */
export const RELEASE_ENDPOINT =
  `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`

/**
 * 下载镜像前缀：空串直连 GitHub 资产地址；设为 HTTPS 前缀时替换资产 URL 的
 * https://github.com 部分（如 https://ghproxy.example/https://github.com）。
 * 可被 config.downloadBaseURL 覆盖；镜像不影响 SHA-256 校验。
 */
export const DOWNLOAD_BASE_URL = ''

/**
 * 安装包下载目录：空串表示放在应用数据目录的 `updates/<version>/` 下
 * （由 adapter.statePath 派生）。设为绝对路径时改用该目录，同样按版本
 * 建子目录；支持 `~` 开头的家目录写法。相对路径视为无效并回退到默认。
 * 可被 config.downloadDirectory 覆盖。
 */
export const DOWNLOAD_DIRECTORY = ''

/* ====================================================================
 * 轮询节奏
 * 每项均为 Config 同名字段的默认值，用户可经 profile 补丁覆盖。
 * ==================================================================== */

/** 后台自动检查开关。可被 config.enabled 覆盖。 */
export const UPDATES_ENABLED = true

/** 启动后首次后台检查的延迟（毫秒）。可被 config.initialDelayMs 覆盖。 */
export const INITIAL_DELAY_MS = 60_000

/** 相邻两次后台检查的间隔（毫秒）。可被 config.intervalMs 覆盖。 */
export const INTERVAL_MS = 6 * 60 * 60 * 1000

/** 单次版本请求的超时（毫秒）。可被 config.requestTimeoutMs 覆盖。 */
export const REQUEST_TIMEOUT_MS = 15_000
