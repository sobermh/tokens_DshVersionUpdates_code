import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import * as tar from 'tar';
import { validateRelease } from './validate-release.mjs';

export async function verifyTarball(filename, expected) {
  const contents = new Map();
  const invalid = [];
  await tar.t({ file: filename, onReadEntry(entry) {
    if (entry.type === 'Directory') { entry.resume(); return; }
    if (!['File', 'OldFile'].includes(entry.type)) { invalid.push(entry.path); entry.resume(); return; }
    const chunks = [];
    entry.on('data', chunk => chunks.push(chunk));
    entry.on('end', () => {
      if (contents.has(entry.path)) invalid.push(entry.path);
      contents.set(entry.path, Buffer.concat(chunks));
    });
  } });
  assert.deepEqual(invalid, [], 'No links or duplicate entries allowed');
  const allowed = ['package.json', 'index.js', 'identity.js', 'download.js', 'messages.js',
    'index.d.ts', 'dist/client.js', 'cordis.patch.yml', 'README.md', 'LICENSE'];
  assert.deepEqual([...contents.keys()].sort(), allowed.map(name => `package/${name}`).sort(),
    'Tarball must contain exactly the runtime files and public documentation');
  const manifest = JSON.parse(contents.get('package/package.json'));
  validateRelease(manifest, `v${expected.version}`);
  for (const field of ['main', 'types', 'exports', 'dsh', 'dependencies', 'peerDependencies', 'engines']) {
    assert.deepEqual(manifest[field], expected[field], `Packaged ${field} differs`);
  }
  for (const name of allowed) assert.ok(contents.get(`package/${name}`).length, `Empty resource ${name}`);
  assert.match(contents.get('package/cordis.patch.yml').toString(), /name: '@tokens\/dsh-version-updates'/);
  assert.match(contents.get('package/dist/client.js').toString(), /window\.__ModuleLoader__\.load/);
  console.log(`Verified ${manifest.name}@${manifest.version}: ${contents.size} files`);
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifyTarball(process.argv[2], JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')));
}
