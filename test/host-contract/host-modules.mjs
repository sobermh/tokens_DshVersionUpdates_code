/**
 * Resolve hook that points every `@deepseek-ai/*` specifier at one staged host.
 *
 * This plugin declares `@deepseek-ai/dsh` as an optional peer and never installs
 * it, so the contract cases must load the copies the product actually ships,
 * which live in a staged host's `node_modules`. The hook rewrites nothing else:
 * the plugin's own modules still come from this work tree, which HOST-001
 * asserts.
 *
 * It also serves the compiled host sources: `compileHostSource()` hands Node a
 * `data:` module, and bare specifiers inside one cannot resolve without a hook.
 *
 * `register()` runs this in its own thread, so the host root arrives through the
 * `data` argument rather than a module-level variable.
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

let hostRequire

export function initialize(data) {
  hostRequire = createRequire(path.join(data.hostRoot, 'package.json'))
}

export function resolve(specifier, context, nextResolve) {
  if (hostRequire !== undefined && (specifier === '@deepseek-ai' || specifier.startsWith('@deepseek-ai/'))) {
    try {
      return { url: pathToFileURL(hostRequire.resolve(specifier)).href, shortCircuit: true }
    } catch {
      // Not shipped by this host generation; let Node report the real failure so
      // a case can report "this host has no such package" instead of a mystery.
    }
  }
  return nextResolve(specifier, context)
}
