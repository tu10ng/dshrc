/**
 * dshrc — host entry, the `init.el` of this rc.
 *
 * Write snippets right here, one `rc.snippet(name, inject?, apply)` per customization; they mount
 * in file order. Comment one out to disable it. Saving this file hot-reloads the whole rc and
 * disposes everything the previous version registered, so a re-saved hook never stacks up.
 *
 * `apply(ctx)` receives an ordinary Cordis context: `inject` names the services it waits for
 * (`ctx.tools`, `ctx.systemPrompt`, ...). When a snippet grows, move it to `./snippets/<name>.js`
 * as a plugin module (`export const name`, `inject`, `apply`) and add it with a static import,
 * because dsh's hot reload follows static imports only:
 *
 *   import * as myTool from './snippets/my-tool.js'
 *   rc.use(myTool)
 *
 * @module dshrc
 */

import { createRc } from './lib/runtime.js'

const rc = createRc()

// ─── house rules in every system prompt ──────────────────────────────────────
// Model-visible: costs tokens on every turn and changes the prompt-cache prefix when edited.

// rc.snippet('house-rules', ['systemPrompt'], (ctx) => {
//   ctx.systemPrompt.section({
//     name: 'dshrc:house-rules',
//     order: 900,
//     interpolate: false,
//     text: '# House rules\n\n- Reply in the language the user writes in.\n- Prefer small, reviewable changes.',
//   })
// })

// ─── current_time tool ───────────────────────────────────────────────────────
// Registered globally; an agent preset that restricts global tools hides it.

// rc.snippet('current-time', ['tools'], (ctx) => {
//   ctx.tools.register({
//     name: 'current_time',
//     description: 'Return the current local date and time with the IANA time zone of the machine running the harness.',
//     parameters: { type: 'object', properties: {}, additionalProperties: false },
//     output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
//     async execute() {
//       const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
//       return `${new Date().toLocaleString('sv-SE', { timeZone: zone })} (${zone})`
//     },
//   })
// })

// ─── ask before git force push ───────────────────────────────────────────────
// A `tools/pre-execute` waterfall listener, dsh's `advice-add :around`: decide for matching calls,
// delegate everything else with `next()`.

// rc.snippet('confirm-force-push', ['tools'], (ctx) => {
//   const forcePush = /\bgit\b[^;&|]*\bpush\b[^;&|]*(?:--force\b|--force-with-lease\b|\s-f\b)/
//   ctx.on('tools/pre-execute', (exec, next) => {
//     const command = exec.arguments?.command
//     if ((exec.name === 'bash' || exec.name === 'pwsh') && typeof command === 'string' && forcePush.test(command)) {
//       return { kind: 'ask', reason: 'dshrc: git force push needs confirmation' }
//     }
//     return next()
//   })
// })

/** Plugin name; the Loader row id written by `dshrc.mjs install` is also `dshrc`. */
export const name = 'dshrc'

/**
 * Mount the rc.
 *
 * @param {object} ctx - Cordis context
 */
export function apply(ctx) {
  rc.mount(ctx)
}
