/**
 * Read a `node:test` run's own report, whichever reporter printed it.
 *
 * Node's default reporter is not stable: up to Node 22 a non-TTY stdout gets
 * `tap`, Node 23 and later always get `spec`. The host-contract gate used to
 * count `✔ HOST-001 …` lines only, so on the CI Windows runner (Node 22,
 * piped stdout) it read a 23/23 run as 0/0 and failed it (T0050), while the
 * same commit summarised correctly on a developer's Node 24.
 *
 * Both formats are parsed here, and the reporter's own totals are kept so the
 * caller can cross-check them against the cases it counted: a third format
 * nobody taught this parser then fails loudly instead of summarising zero.
 *
 * Nothing in here spawns anything or reads the environment — it is a pure
 * function over captured output, which is what makes it testable without a
 * staged host (case GATE-01).
 */

/** The case-id shape both the gate and the mutation verifier use. */
export const DEFAULT_CASE_PATTERN = 'HOST-\\d+'

/** Counter names the two reporters print, `spec` with `ℹ` and `tap` with `#`. */
const TOTALS = /^(?:ℹ|#) (tests|pass|fail|skipped|todo|cancelled) (\d+)$/gmu

/**
 * Summarise one test process's output.
 *
 * Only top-level case lines are read (neither format indents those), and each
 * id is reported once however many times it was printed: `spec` repeats every
 * failure in its trailing "failing tests" block, and a run with both reporters
 * active prints every case twice.
 *
 * @param output - everything the test process wrote to stdout and stderr.
 * @param options - `casePattern` is a regex source matching a case id.
 * @returns passed/failed ids, skipped ids with the reason each one reported,
 *   and `totals`, the counters the reporter printed (absent keys mean the
 *   reporter printed none, so the caller must not treat them as zero).
 */
export function summariseCaseReport(output, { casePattern = DEFAULT_CASE_PATTERN } = {}) {
  const text = String(output ?? '')
  // `spec`: "✔ HOST-001 title (1.2ms)", "✖ …", "﹣ … # <reason>".
  const spec = new RegExp(`^([✔✖﹣]) (${casePattern})(?: ([^\\n]*))?$`, 'gmu')
  // `tap`: "ok 1 - HOST-001 title", "not ok 3 - …", "ok 2 - … # SKIP <reason>".
  const tap = new RegExp(`^(not )?ok \\d+ - (${casePattern})(?: ([^\\n]*))?$`, 'gmu')

  const passed = new Set()
  const failed = new Set()
  const skipped = new Map()
  const note = (state, id, reason) => {
    if (state === 'pass') passed.add(id)
    else if (state === 'fail') failed.add(id)
    else if (!skipped.has(id)) skipped.set(id, reason)
  }

  for (const [, mark, id, rest = ''] of text.matchAll(spec)) {
    const state = mark === '✔' ? 'pass' : mark === '✖' ? 'fail' : 'skip'
    note(state, id, state === 'skip' ? skipReason(rest) : undefined)
  }
  for (const [, not, id, rest = ''] of text.matchAll(tap)) {
    const directive = /(?:^|\s)#\s*(SKIP|TODO)\b[ \t]*(.*)$/iu.exec(rest)
    if (not) note('fail', id)
    else if (directive) note('skip', id, directive[2].trim() || directive[1].toUpperCase())
    else note('pass', id)
  }

  const totals = {}
  for (const [, name, value] of text.matchAll(TOTALS)) {
    // Two active reporters print the same counters twice; take the larger so a
    // truncated first block never shrinks the number we check against.
    totals[name] = Math.max(totals[name] ?? 0, Number(value))
  }

  // A failing case is never also a passing one, whatever order the lines came in.
  for (const id of failed) passed.delete(id)
  for (const id of skipped.keys()) { passed.delete(id); failed.delete(id) }
  return {
    passed: [...passed],
    failed: [...failed],
    skipped: [...skipped].map(([id, reason]) => ({ id, reason: reason ?? '' })),
    totals,
  }
}

/** The reason a `spec` skip line carries, which follows the first `# `. */
function skipReason(rest) {
  const marker = rest.indexOf('# ')
  return marker === -1 ? '' : rest.slice(marker + 2).trim()
}

/**
 * Cross-check a summary against the counters the reporter printed.
 *
 * This is the guard the gate was missing: it does not matter which reporter
 * ran, but it does matter that the cases we counted add up to the run the
 * reporter described. Returns a message when they disagree, else undefined.
 *
 * Skipped cases are compared only when the reporter counted no `todo`, since
 * `spec` and `tap` both fold todo into their skip mark but count it apart.
 *
 * @param summary - the result of {@link summariseCaseReport}.
 */
export function describeReportMismatch(summary) {
  const { totals } = summary
  // Every reporter Node ships ends with its counters. None at all means the
  // child never got to run its suite, or printed something else entirely —
  // for instance the internal v8 serialiser it uses when `NODE_TEST_CONTEXT`
  // leaks in from a parent that is itself a test process.
  if (Object.keys(totals).length === 0) {
    return '测试报告里没有任何计数行：子进程可能没跑起来，或者它的报告格式不认识'
      + '（见 scripts/test-report-summary.mjs）'
  }
  const problems = []
  const compare = (label, counted, reported) => {
    if (reported !== undefined && reported !== counted) {
      problems.push(`${label} ${counted}，报告器自己数的是 ${reported}`)
    }
  }
  compare('通过', summary.passed.length, totals.pass)
  compare('失败', summary.failed.length, totals.fail)
  if (!totals.todo) compare('未执行', summary.skipped.length, totals.skipped)
  return problems.length === 0 ? undefined
    : `读不懂测试报告：按用例行数出来的${problems.join('；')}`
      + '（报告器格式可能又变了，见 scripts/test-report-summary.mjs）'
}
