import { run } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const testDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = dirname(testDirectory)
const testFiles = ['comprehensive.test.js', 'plugin.test.js']
if (process.argv.length !== 2) throw new Error('usage: node test/run-test-cases.mjs')

const cases = parseCSV(readFileSync(join(testDirectory, 'test_cases.csv'), 'utf8'))
const seen = new Set()
for (const item of cases) {
  const id = item['用例编号']
  if (!id || seen.has(id)) throw new Error('Missing or duplicate case ID: ' + id)
  seen.add(id)
  if (item['自动化状态'] !== '已自动化') throw new Error(id + ': this suite requires code-driven cases')
  item.references = item['对应测试'].split(/\r?\n|\s+\|\s+/u).filter(Boolean)
  if (!item.references.length) throw new Error(id + ': missing test mapping')
  for (const reference of item.references) {
    const [file, name] = reference.split(' :: ')
    if (!testFiles.some(value => file === 'test/' + value) || !name) {
      throw new Error(id + ': invalid test mapping ' + reference)
    }
  }
}

// Use test-runner events: a named but skipped test is not a passed case.
const results = new Map()
let failedTests = 0
let passedTests = 0
let skippedTests = 0
for await (const event of run({ files: testFiles.map(file => join(testDirectory, file)), isolation: 'process' })) {
  if (!['test:pass', 'test:fail'].includes(event.type)) continue
  const data = event.data
  const file = data.file ? relative(repositoryRoot, resolve(data.file)).replaceAll('\\', '/') : ''
  const key = file + ' :: ' + data.name
  const skipped = Boolean(data.skip || data.todo)
  const passed = event.type === 'test:pass' && !skipped
  const reason = skipped ? 'Skipped/TODO: ' + (data.skip || data.todo)
    : passed ? '' : String(data.details?.error?.cause?.stack ?? data.details?.error?.message ?? 'test failed')
  results.set(key, { passed, reason })
  if (skipped) skippedTests++
  else if (passed) passedTests++
  else {
    failedTests++
    console.error('FAIL ' + key + '\n' + reason)
  }
}

let passedCases = 0
const failures = []
for (const item of cases) {
  const reasons = item.references.flatMap(reference => {
    const result = results.get(reference)
    return result?.passed ? [] : [reference + ': ' + (result?.reason ?? 'not executed')]
  })
  if (reasons.length) failures.push({ id: item['用例编号'], reasons })
  else passedCases++
}
console.log('\n功能回归结果：' + passedCases + '/' + cases.length + ' 条通过')
for (const failure of failures) console.error(failure.id + '\n' + failure.reasons.join('\n'))
console.log('总体结果：' + (failures.length || failedTests ? '未通过' : '全部通过'))
process.exitCode = failures.length || failedTests ? 1 : 0

function parseCSV(source) {
  source = source.replace(/^\uFEFF/u, '')
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        field += character
      }
    } else if (character === '"') {
      quoted = true
    } else if (character === ',') {
      row.push(field)
      field = ''
    } else if (character === '\n') {
      row.push(field.replace(/\r$/u, ''))
      rows.push(row)
      row = []
      field = ''
    } else {
      field += character
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  const [headers, ...records] = rows
  return records
    .filter(record => record.some(value => value !== ''))
    .map(record => Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ''])))
}
