/**
 * dshrc — host entry, the `init.el` of this rc.
 *
 * A snippet is an ordinary Cordis plugin module under `./snippets/`: `name`, optional `inject`,
 * and `apply(ctx)`. To enable one, import it statically and add it to `snippets`; list order is
 * mount order. Saving any file under `rc/` hot-reloads the whole rc and disposes everything the
 * previous version registered.
 *
 * Import snippets statically: dsh's hot reload follows static imports only, so an edit to a
 * dynamically imported file is not picked up until something else reloads.
 *
 * @module dshrc
 */

import { mount } from './lib/runtime.js'

// import * as examplePrompt from './snippets/example-prompt.js'
// import * as exampleTool from './snippets/example-tool.js'
// import * as exampleGuard from './snippets/example-guard.js'

/** Host snippets, in mount order. */
const snippets = [
  // examplePrompt,
  // exampleTool,
  // exampleGuard,
]

/** Plugin name; the Loader row id written by `dshrc.mjs install` is also `dshrc`. */
export const name = 'dshrc'

/**
 * Mount the rc.
 *
 * @param {object} ctx - Cordis context
 */
export function apply(ctx) {
  mount(ctx, snippets)
}
