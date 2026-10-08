import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const RELEASE_REPOSITORY = 'sobermh/tokens_DshVersionUpdates_code';
export const RELEASE_REGISTRY = 'https://npm.tokensapi.ai/';

export function validateMarketMetadata(manifest) {
  for (const field of ['displayName', 'summary']) {
    const values = manifest.tokenscowork?.[field];
    if (['zh-CN', 'en-US'].some(locale => typeof values?.[locale] !== 'string' || !values[locale].trim())
      || values['zh-CN'] === values['en-US']) throw new Error(`Invalid bilingual market ${field}`);
  }
}

export function validateRelease(manifest, tag) {
  if (manifest.private === true) throw new Error('Package must be publishable');
  if (manifest.name !== '@tokens/dsh-version-updates') throw new Error('Unexpected release package name');
  const repository = new URL((typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url)?.replace(/^git\+/, ''));
  if (repository.origin !== 'https://github.com' || repository.username || repository.password
    || repository.search || repository.hash
    || repository.pathname.replace(/\.git$/, '') !== `/${RELEASE_REPOSITORY}`) throw new Error('Unexpected release repository');
  validateMarketMetadata(manifest);
  if (manifest.publishConfig?.registry !== 'https://npm.tokensapi.ai/'
    || manifest.publishConfig?.access === 'public') {
    throw new Error('Release must target the private Verdaccio registry');
  }
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(manifest.version)) {
    throw new Error('Only stable versions may update latest');
  }
  if (tag !== `v${manifest.version}`) throw new Error('Release tag must match package.json version');
  return manifest.version;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  validateRelease(manifest, process.argv[2] || `v${manifest.version}`);
  const changelog = readFileSync(new URL('../docs/CHANGELOG.md', import.meta.url), 'utf8');
  if (!changelog.includes(`## [${manifest.version}] - `)
    || !changelog.includes(`[${manifest.version}]: https://github.com/${RELEASE_REPOSITORY}/compare/`)) {
    throw new Error('Release changelog must match package version');
  }
  console.log(`Validated ${manifest.name}@${manifest.version} for Verdaccio`);
}
