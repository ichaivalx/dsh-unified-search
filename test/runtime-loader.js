// Test-only resolution against an installed DSH runtime, including Electron ASAR.
// No runtime dependency on this loader or a machine-specific installation path.
import { registerHooks, createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
if (process.env.DSH_RUNTIME_ANCHOR) {
  const requireFromHost = createRequire(process.env.DSH_RUNTIME_ANCHOR)
  let resolving = false
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (!resolving && specifier.startsWith('@deepseek-ai/')) {
        resolving = true
        try { return { url: pathToFileURL(requireFromHost.resolve(specifier)).href, shortCircuit: true } }
        finally { resolving = false }
      }
      return nextResolve(specifier, context)
    },
  })
}
