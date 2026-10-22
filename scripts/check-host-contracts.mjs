/**
 * `npm run check:host` — the real-host contract gate.
 *
 * The product gate passes exactly one variable, `DSH_HOST_ROOT`, pointing at a
 * staged host's `dsh-plugin-desktop` directory. This script maps it onto the
 * variables this repository already used (`TOKENS_HOST_ROOT` for the contract
 * fixture, plus `TOKENS_HARNESS_ROOT` and `DSH_RUNTIME_ROOT` for the older
 * suites) so the gate never has to know them.
 *
 * Locally, `DSH_HOST_ROOTS` runs several staged hosts one after another, each
 * in its own process. The gate does not pass it.
 *
 * Fail closed. The run fails when:
 *   - no host root was given at all (every case then reports NOT EXECUTED);
 *   - any case fails;
 *   - any case did not execute for a reason outside the allow-list, which is
 *     only "this host generation has no such interface" and "this platform
 *     publishes no such artifact". A case can never stop running quietly;
 *   - the child's report could not be read, i.e. the case lines counted here
 *     disagree with the counters the reporter printed for the same run.
 *
 * The child's results are read by `scripts/test-report-summary.mjs`, which
 * understands both reporters Node may choose on its own — see the note there.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ALLOWED_SKIP_PREFIXES } from '../test/host-contract/live-host.mjs'
import { describeReportMismatch, summariseCaseReport } from './test-report-summary.mjs'

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const runner = path.join(repositoryRoot, 'test', 'run-test-cases.mjs')
const NOT_EXECUTED = /^NOT EXECUTED: (.*)$/u

/** The staged hosts to check, in the order they were given. */
function hostRoots() {
  const many = process.env.DSH_HOST_ROOTS
  if (many) return many.split(path.delimiter).map(value => value.trim()).filter(Boolean)
  const one = process.env.DSH_HOST_ROOT
  return one ? [one.trim()] : []
}

/**
 * Run the host-contract suite once and summarise it.
 * @param root - the staged host, or undefined to show what an absent one does.
 */
async function checkOne(root) {
  const resolved = root === undefined ? undefined : path.resolve(root)
  if (resolved !== undefined && !existsSync(path.join(resolved, 'package.json'))) {
    return { root: resolved, fatal: `not a staged host directory: ${resolved}` }
  }
  const child = spawn(process.execPath, ['--test-concurrency=1', runner, '--case-worker=host-contract'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      // The one variable the gate knows, mapped onto this repository's own.
      ...(resolved === undefined ? { TOKENS_HOST_ROOT: '' } : {
        TOKENS_HOST_ROOT: resolved,
        // The pre-existing suites take a project root holding `desktop/<host>`.
        TOKENS_HARNESS_ROOT: path.dirname(path.dirname(resolved)),
        DSH_RUNTIME_ROOT: resolved,
      }),
      // Nothing here may resolve the developer's real harness home.
      DSH_HOME: path.join(tmpdir(), 'tokens-version-updates-dsh-home-guard'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk; process.stdout.write(chunk) })
  child.stderr.on('data', (chunk) => { output += chunk; process.stderr.write(chunk) })
  const code = await new Promise(resolve => child.once('close', resolve))

  // Read the report whichever reporter wrote it: Node 22 prints `tap` into a
  // pipe, Node 23 and later always print `spec`. Counting one format only is
  // what made a green CI run summarise 0/0 (T0050).
  const summary = summariseCaseReport(output)
  const unreadable = describeReportMismatch(summary)
  const skipped = summary.skipped
    .map(entry => ({ id: entry.id, reason: NOT_EXECUTED.exec(entry.reason)?.[1] ?? entry.reason }))
  return { root: resolved, code, passed: summary.passed, failed: summary.failed, skipped, unreadable }
}

const roots = hostRoots()
if (roots.length === 0) {
  // Report every case as not executed, then fail: an absent host is exactly
  // the situation this gate exists to catch.
  console.log('=== 真实宿主契约：未提供 DSH_HOST_ROOT ===')
  const summary = await checkOne(undefined)
  console.error(`\ncheck:host 未执行：没有设置 DSH_HOST_ROOT（staged 宿主的 dsh-plugin-desktop 目录）。`)
  console.error(`真实宿主契约用例 ${summary.skipped?.length ?? 0} 条全部 NOT EXECUTED，不计通过。`)
  process.exit(1)
}

const summaries = []
for (const root of roots) {
  console.log(`\n=== 真实宿主契约：${root} ===`)
  summaries.push(await checkOne(root))
}

let failures = 0
console.log('\n=== check:host 汇总 ===')
for (const summary of summaries) {
  if (summary.fatal !== undefined) {
    failures += 1
    console.error(`${summary.root}: ${summary.fatal}`)
    continue
  }
  const disallowed = summary.skipped.filter(entry =>
    !ALLOWED_SKIP_PREFIXES.some(prefix => entry.reason.startsWith(prefix)))
  const total = summary.passed.length + summary.failed.length + summary.skipped.length
  console.log(`${summary.root}`)
  console.log(`  通过 ${summary.passed.length}/${total}`
    + (summary.failed.length ? `，失败 ${summary.failed.join(', ')}` : '')
    + (summary.skipped.length ? `，未执行 ${summary.skipped.length}` : ''))
  for (const entry of summary.skipped) console.log(`  未执行 ${entry.id}：${entry.reason}`)
  for (const entry of disallowed) {
    console.error(`  未执行且理由不被接受 ${entry.id}：${entry.reason}`)
  }
  // Never summarise a run we could not read: the reporter's own counters have
  // to agree with the case lines we counted.
  if (summary.unreadable !== undefined) console.error(`  ${summary.unreadable}`)
  if (summary.code !== 0 || summary.failed.length > 0 || disallowed.length > 0
    || summary.passed.length === 0 || summary.unreadable !== undefined) {
    failures += 1
  }
}

console.log(failures === 0 ? '\ncheck:host 通过' : '\ncheck:host 未通过')
process.exit(failures === 0 ? 0 : 1)
