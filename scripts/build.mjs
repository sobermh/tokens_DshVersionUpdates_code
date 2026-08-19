import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const result = await build({
  entryPoints: ['src/client/index.tsx'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  write: false,
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/*'],
  logLevel: 'info',
})

const artifact = result.outputFiles[0]
if (artifact === undefined) throw new Error('client build produced no output')
const wrapped = `window.__ModuleLoader__.load({
  id: ${JSON.stringify(manifest.name)},
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${artifact.text}
    return module.exports;
  }
});
`

await mkdir(new URL('../dist', import.meta.url), { recursive: true })
await writeFile(new URL('../dist/client.js', import.meta.url), wrapped)
console.log(`dist/client.js written (${(wrapped.length / 1024).toFixed(1)} kB)`)
