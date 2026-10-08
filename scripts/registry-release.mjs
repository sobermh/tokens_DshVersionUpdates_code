import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { RELEASE_REGISTRY, validateRelease } from './validate-release.mjs';

export function assertUnpublishedStatus(status) {
  if (status === 404) return;
  if (status === 200) throw new Error('This exact version is already published; do not overwrite it');
  throw new Error(`Registry query failed (${status}); absence is not confirmed`);
}
export async function registryRelease(mode, { manifest, token, filename, fetchImpl = fetch }) {
  validateRelease(manifest, `v${manifest.version}`);
  if (!token) throw new Error('Configure VERDACCIO_PUBLISH_TOKEN before releasing');
  const request = path => fetchImpl(`${RELEASE_REGISTRY}${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    redirect: 'error', signal: AbortSignal.timeout(10_000),
  });
  const who = await request('-/whoami');
  if (who.status !== 200 || (await who.json()).username !== 'tokenscowork') throw new Error('Registry publisher must be tokenscowork');
  const spec = encodeURIComponent(manifest.name);
  if (mode === 'check') {
    assertUnpublishedStatus((await request(`${spec}/${manifest.version}`)).status);
    console.log('Publisher verified; exact release version is not published');
    return;
  }
  if (mode !== 'verify') throw new Error('Expected check or verify');
  const expected = `sha512-${createHash('sha512').update(await readFile(filename)).digest('base64')}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await request(`${spec}/${manifest.version}`);
    if (response.status === 200) {
      const metadata = await response.json();
      if (metadata.name !== manifest.name || metadata.version !== manifest.version) throw new Error('Published package identity does not match');
      if (metadata.dist?.integrity !== expected) throw new Error('Published tarball integrity does not match the checked package');
      const latestResponse = await request(`${spec}/latest`);
      if (latestResponse.status === 200 && (await latestResponse.json()).version === manifest.version) {
        console.log(`Verified ${manifest.name}@${manifest.version}, latest, and tarball integrity`);
        return;
      }
      if (![200, 404, 202].includes(latestResponse.status)) throw new Error(`Registry latest query failed (${latestResponse.status})`);
    } else if (![404, 202].includes(response.status)) throw new Error(`Registry verification failed (${response.status})`);
    if (attempt < 2) await delay(1500);
  }
  throw new Error('Release not yet verified; do not publish again');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await registryRelease(process.argv[2], {
      manifest: JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')),
      token: process.env.NODE_AUTH_TOKEN, filename: process.argv[3],
    });
  } catch (error) {
    console.error(error.name === 'TypeError' ? 'Registry request failed; release stopped' : error.message);
    process.exitCode = 1;
  }
}
