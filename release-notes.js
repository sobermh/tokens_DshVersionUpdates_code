/** 发布说明解析：把一个 Release 的正文压成弹窗能显示的摘要与要点。 */

import { isChineseLocale } from './messages.js'

/* ====================================================================
 * 解析口径
 * 正文是我们自己写的发布说明（TokensCowork 的 docs/releases/vX.Y.Z.md，
 * 结构由该仓库的 scripts/validate-release-notes.mjs 固定）：标题下第一段
 * 是摘要，`## 本次更新` / `## What's New` 下按类别列要点。双语正文以
 * `## What's New` 为界，前半是中文、后半是英文。
 *
 * 这里只做「尽力而为」的纯文本抽取：结构不符、正文为空、根本不是我们写的
 * 说明时一律返回空，由调用方退回原有文案——检查更新绝不因为解析而失败。
 * ==================================================================== */

/** 弹窗里最多列出的要点条数。 */
export const MAX_RELEASE_HIGHLIGHTS = 6

/**
 * 摘要与单条要点的上限，按**显示宽度**计（列数，见 displayWidth）：原生对话框
 * 一行约 80 列（≈40 个中文字符），一条要点占两行出头。
 *
 * 不按字符个数计，是因为一个汉字的显示宽度与信息量都约等于两个英文字符：同一个
 * 「90 个字符」的额度，中文装得下一整句，英文只够一个主语——真机英文弹窗里
 * 410 个字符的那条要点只显示到 73 个字符，看不出任何实质内容。
 */
export const MAX_RELEASE_SUMMARY_COLUMNS = 400
export const MAX_RELEASE_HIGHLIGHT_COLUMNS = 180

/** 英文半边的分界标题，也是「这份正文是双语的」的判据。 */
const ENGLISH_BOUNDARY = /^##[ \t]+What's New[ \t]*$/mu

/** 要点所在小节的标题，按界面语言优先匹配。 */
const UPDATE_SECTION_HEADINGS = { zh: '本次更新', en: "What's New" }

/**
 * Select the half of a bilingual release body that matches the interface language.
 * @param {unknown} body Raw Release body.
 * @param {string} [locale] Interface locale; non-Chinese locales read English.
 * @returns {string} One language's text, or the whole body when it is monolingual.
 */
export function selectReleaseNotesLanguage(body, locale) {
  if (typeof body !== 'string') return ''
  const text = body
    .replaceAll('\r\n', '\n')
    .replace(/<!--[^]*?-->/gu, '')
    // GitHub 的语言锚点不是正文，留着会被当成段落。
    .replace(/<a\s+(?:name|id)="[^"]*"\s*>\s*<\/a>/giu, '')
  const boundary = ENGLISH_BOUNDARY.exec(text)
  // 单语的旧说明整段可读，不猜语言。
  if (boundary === null) return text.trim()
  if (!isChineseLocale(locale)) return text.slice(boundary.index).trim()
  return text.slice(0, boundary.index)
    .replace(/^\[中文\]\([^\n]*\)[ \t]*\|[ \t]*\[English\]\([^\n]*\)[ \t]*$/mu, '')
    .replace(/^-{3,}[ \t]*$/gmu, '')
    .trim()
}

/**
 * Extract one release's summary and highlights for the update dialogs.
 * @param {unknown} body Raw Release body.
 * @param {string} [locale] Interface locale.
 * @returns {{ summary: string, highlights: string[] }} Plain text; empty when nothing was usable.
 */
export function summarizeReleaseNotes(body, locale) {
  const section = selectReleaseNotesLanguage(body, locale)
  if (section === '') return { summary: '', highlights: [] }
  return {
    summary: clamp(summaryParagraph(section), MAX_RELEASE_SUMMARY_COLUMNS),
    highlights: highlights(updatesSection(section, locale)),
  }
}

/**
 * Render the release-notes block shown inside a dialog's detail text.
 * @param {unknown} body Raw Release body.
 * @param {string} [locale] Interface locale.
 * @returns {string} Summary and bulleted highlights, or an empty string.
 */
export function renderReleaseNotes(body, locale) {
  const { summary, highlights: items } = summarizeReleaseNotes(body, locale)
  const blocks = []
  if (summary !== '') blocks.push(summary)
  if (items.length > 0) blocks.push(items.map(item => `• ${item}`).join('\n'))
  return blocks.join('\n\n')
}

/* ====================================================================
 * 内部辅助函数
 * ==================================================================== */

/** 标题下的第一段；遇到任何块级语法就停，所以表格和列表都不会混进摘要。 */
function summaryParagraph(section) {
  const paragraph = []
  for (const line of section.split('\n').map(value => value.trim())) {
    if (line === '') {
      if (paragraph.length > 0) break
      continue
    }
    // 段落之前的标题行（`# 产品 vX.Y.Z`、`## What's New`）跳过不算内容。
    if (paragraph.length === 0 && /^#{1,6}\s/u.test(line)) continue
    if (/^(?:#{1,6}\s|[-*+]\s|\d+\.\s|```|>|\||!\[)/u.test(line)) break
    paragraph.push(line)
  }
  return inlineText(paragraph.join(' '))
}

/** `## 本次更新` / `## What's New` 到下一个二级标题之间的原文。 */
function updatesSection(section, locale) {
  const names = isChineseLocale(locale)
    ? [UPDATE_SECTION_HEADINGS.zh, UPDATE_SECTION_HEADINGS.en]
    : [UPDATE_SECTION_HEADINGS.en, UPDATE_SECTION_HEADINGS.zh]
  for (const name of names) {
    const heading = new RegExp(`^##[ \\t]+${escapeForRegExp(name)}[ \\t]*$`, 'mu').exec(section)
    if (heading === null) continue
    const rest = section.slice(heading.index + heading[0].length)
    const next = /^##[ \t]+/mu.exec(rest)
    return next === null ? rest : rest.slice(0, next.index)
  }
  return ''
}

/** 顶格的要点行，按正文自己的次序（校验脚本固定为 ✨ 🐛 🎨 ⚠️）。 */
function highlights(updates) {
  const items = []
  for (const line of updates.split('\n')) {
    // 只认顶格的一级要点：缩进的子项、表格行、组件清单都不是要点。
    const match = /^[-*+][ \t]+(\S.*)$/u.exec(line)
    if (match === null) continue
    const text = clamp(inlineText(match[1]), MAX_RELEASE_HIGHLIGHT_COLUMNS)
    if (text === '') continue
    items.push(text)
    if (items.length >= MAX_RELEASE_HIGHLIGHTS) break
  }
  return items
}

/** 行内 Markdown 去标记：弹窗是纯文本，链接与代码只保留文字。 */
function inlineText(value) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/`+([^`]+)`+/gu, '$1')
    .replace(/\*\*([^*]+)\*\*/gu, '$1')
    .replace(/__([^_]+)__/gu, '$1')
    .replace(/\*([^*\n]+)\*/gu, '$1')
    .replace(/\\([\\`*_{}[\]()#+\-.!])/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim()
}

/**
 * 东亚宽字符与全角字符的码位区间：这些字符在等宽显示里占两列，其余占一列。
 * 按 UAX #11 的 Wide 与 Fullwidth 两类取，外加弹窗里同样占两列的表情符号。
 */
const WIDE_CODE_POINT_RANGES = [
  [0x1100, 0x115f], // 韩文字母
  [0x2e80, 0x303e], // CJK 部首补充、康熙部首、中日韩符号与标点（含全角句号与顿号）
  [0x3041, 0x33ff], // 假名、注音、韩文兼容字母、带圈与方块字符
  [0x3400, 0x4dbf], // CJK 扩展 A
  [0x4e00, 0x9fff], // CJK 统一表意文字
  [0xa000, 0xa4cf], // 彝文音节
  [0xa960, 0xa97f], // 韩文字母扩展 A
  [0xac00, 0xd7a3], // 韩文音节
  [0xf900, 0xfaff], // CJK 兼容表意文字
  [0xfe10, 0xfe19], // 竖排标点
  [0xfe30, 0xfe6f], // CJK 兼容形式、小写变体、全角标点变体
  [0xff00, 0xff60], // 全角 ASCII 与全角标点
  [0xffe0, 0xffe6], // 全角货币与符号
  [0x1f300, 0x1f64f], // 表情符号与象形文字
  [0x1f900, 0x1f9ff], // 补充符号与象形文字
  [0x20000, 0x3fffd], // CJK 扩展 B 及以后
]

/**
 * Measure how many columns a string occupies in the dialog's monospaced text.
 * @param {string} value Plain text.
 * @returns {number} Columns: East Asian wide and fullwidth characters count 2, the rest 1.
 */
export function displayWidth(value) {
  let columns = 0
  for (const character of value) columns += isWide(character.codePointAt(0)) ? 2 : 1
  return columns
}

/** 这个码位是不是占两列。 */
function isWide(code) {
  for (const [start, end] of WIDE_CODE_POINT_RANGES) if (code >= start && code <= end) return true
  return false
}

/**
 * Take the longest prefix fitting a column budget, never splitting a code point.
 * @param {string} value Plain text.
 * @param {number} limit Column budget.
 * @returns {string} Prefix whose display width is at most the budget.
 */
function sliceToWidth(value, limit) {
  let columns = 0
  let end = 0
  for (const character of value) {
    const next = columns + (isWide(character.codePointAt(0)) ? 2 : 1)
    if (next > limit) break
    columns = next
    end += character.length
  }
  return value.slice(0, end)
}

/**
 * 超长就缩短：先只留放得下的整句，一句都放不下才退到标点或词边界并补省略号。
 * 结果要么是完整的一句（以句末标点收尾），要么明显是省略的一段（以 `…` 收尾），
 * 不会像按字数硬断那样停在半句上——中文一条要点常是「问题 + 修法」两句，硬断
 * 出来的「……只能手动退出再打开。现…」看着像是坏了。
 *
 * 额度按显示宽度算，不按字符个数：弹窗能放多少取决于占多少列，而一个汉字占两列。
 */
function clamp(value, limit) {
  if (displayWidth(value) <= limit) return value
  let kept = ''
  for (const sentence of sentences(value)) {
    if (displayWidth((kept + sentence).trimEnd()) > limit) break
    kept += sentence
  }
  kept = kept.trimEnd()
  if (kept !== '') return kept
  return `${elide(value, limit)}…`
}

/** 句末标点：中文的 `。！？` 无歧义，英文的 `.!?` 另按 latinSentenceEnd 判。 */
const SENTENCE_TERMINATORS = '。！？.!?'

/** 紧跟句末标点、仍属于这一句的收尾符号。 */
const SENTENCE_CLOSERS = '"\'“”‘’』」）)］]》'

/** 退让用的子句标点：截不出整句时在这里断。 */
const CLAUSE_PUNCTUATION = '，、；：,;:'

/** 这些词后面的句点是缩写，不是句末。 */
const LATIN_ABBREVIATIONS = new Set(['etc', 'vs', 'al', 'cf', 'inc', 'ltd', 'mr', 'mrs', 'ms', 'dr', 'prof', 'fig'])

/**
 * Split text into sentences, keeping every character so the pieces rejoin exactly.
 * @param {string} value Plain text with whitespace already collapsed.
 * @returns {string[]} Sentences in order; the separating space leads the next one.
 */
function sentences(value) {
  const parts = []
  let start = 0
  for (let index = 0; index < value.length; index += 1) {
    if (!SENTENCE_TERMINATORS.includes(value[index])) continue
    let end = index
    while (end < value.length && SENTENCE_TERMINATORS.includes(value[end])) end += 1
    const run = value.slice(index, end)
    while (end < value.length && SENTENCE_CLOSERS.includes(value[end])) end += 1
    // 纯 ASCII 的句点要排除版本号、小数和缩写；只要混了中文标点就是句末。
    if (!/[。！？]/u.test(run) && !latinSentenceEnd(value, index, end)) {
      index = end - 1
      continue
    }
    parts.push(value.slice(start, end))
    start = end
    index = end - 1
  }
  if (start < value.length) parts.push(value.slice(start))
  return parts
}

/**
 * Decide whether an ASCII `.`/`!`/`?` run really closes a sentence.
 * @param {string} value Whole text.
 * @param {number} index Index of the first terminator.
 * @param {number} end Index just past the terminators and their closers.
 * @returns {boolean} False for version numbers, decimals, initials and abbreviations.
 */
function latinSentenceEnd(value, index, end) {
  // `0.7.5`、`v1.2` 里的点后面接着正文；句末后面是空白或到头。
  if (end < value.length && value[end] !== ' ') return false
  let start = index
  while (start > 0 && /[A-Za-z0-9]/u.test(value[start - 1])) start -= 1
  const word = value.slice(start, index)
  // `e.g.`、`i.e.` 与姓名缩写：句点前只有一个字母。
  if (/^[A-Za-z]$/u.test(word)) return false
  return !LATIN_ABBREVIATIONS.has(word.toLowerCase())
}

/**
 * 整句都放不下时的兜底：先退到子句标点，再退到词边界，都太靠前才硬断。
 * 子句标点优先于词边界——断在子句上像是有意省略，断在半个子句里像是坏了。
 * 两者都要落在后 40% 以内（同样按列算），否则宁可硬断，不为了标点丢掉大半内容。
 */
function elide(value, limit) {
  const cut = sliceToWidth(value, limit)
  const floor = limit * 0.6
  let boundary = -1
  for (let index = cut.length - 1; index > 0; index -= 1) {
    if (displayWidth(cut.slice(0, index)) <= floor) break
    if (CLAUSE_PUNCTUATION.includes(cut[index])) { boundary = index; break }
  }
  if (boundary < 0) {
    const space = cut.lastIndexOf(' ')
    if (space > 0 && displayWidth(cut.slice(0, space)) > floor) boundary = space
  }
  const kept = boundary > 0 ? cut.slice(0, boundary) : cut
  return kept.replace(/[\s,;:.!?，、；：。！？-]+$/u, '')
}

function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
