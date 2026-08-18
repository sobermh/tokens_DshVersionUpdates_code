/** 插件与产品身份的唯一入口：改名只改本文件，其余引用全部由此派生。 */

/* ====================================================================
 * 身份常量
 * package.json 与 cordis.patch.yml 无法执行 JS，须与本文件手工保持
 * 一致；test/plugin.test.js 会校验两者，失配即测试失败。
 * ==================================================================== */

/** 产品名：用于 User-Agent、托盘菜单等用户可见文案。 */
export const PRODUCT_NAME = 'TokensHarness'

/** npm 包名：须与 package.json 的 name 和 cordis.patch.yml 的 name 一致。 */
export const PACKAGE_NAME = '@tokens/dsh-version-updates'

/** Cordis 插件名：harness 日志与加载器中显示的名字。 */
export const PLUGIN_NAME = 'tokens-dsh-version-updates'

/** 产品发布仓库：GitHub Release 版本源。 */
export const GITHUB_OWNER = 'TokensAPI'
export const GITHUB_REPO = 'tokens_TokensHarness_code'

/** 由发布仓库派生的 latest Release 端点。 */
export const RELEASE_ENDPOINT =
  `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
