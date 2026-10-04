/**
 * Lets plain `node` run scripts that import the extensionless TypeScript
 * specifiers used throughout src/ (Vite resolves those; raw Node does not).
 *
 *     node --import ./scripts/ts-resolve.mjs scripts/whatever.ts
 *
 * Node 23+ strips TypeScript types natively; this only fixes resolution.
 */

import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
      for (const suffix of ['.ts', '/index.ts', '.tsx']) {
        try {
          const candidate = new URL(specifier + suffix, context.parentURL);
          if (existsSync(fileURLToPath(candidate))) {
            return nextResolve(specifier + suffix, context);
          }
        } catch {
          // Fall through to the default resolver.
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
