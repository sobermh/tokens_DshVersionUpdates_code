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

/** 摘要与单条要点的字符上限：原生对话框一行约 40 个中文字符，要点各占一行。 */
export const MAX_RELEASE_SUMMARY_CHARACTERS = 200
export const MAX_RELEASE_HIGHLIGHT_CHARACTERS = 90

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
    summary: clamp(summaryParagraph(section), MAX_RELEASE_SUMMARY_CHARACTERS),
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
    const text = clamp(inlineText(match[1]), MAX_RELEASE_HIGHLIGHT_CHARACTERS)
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

/** 超长就截断并补省略号；拉丁文本尽量断在词边界，中文按字数硬断。 */
function clamp(value, limit) {
  if (value.length <= limit) return value
  const cut = value.slice(0, limit)
  const boundary = cut.lastIndexOf(' ')
  const kept = boundary > limit * 0.6 ? cut.slice(0, boundary) : cut
  return `${kept.replace(/[\s,;:.!?，、；：。！？-]+$/u, '')}…`
}

function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
