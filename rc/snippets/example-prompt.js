/**
 * Example snippet: append house rules to the system prompt of every agent.
 *
 * Model-visible: the text is part of each request's system prompt, so it costs tokens on every
 * turn and changes the prompt-cache prefix when edited.
 *
 * @module dshrc/snippets/example-prompt
 */

export const name = 'dshrc-example-prompt'
export const inject = ['systemPrompt']

const RULES = `# House rules

- Reply in the language the user writes in.
- Prefer small, reviewable changes.`

/**
 * @param {object} ctx - Cordis context
 */
export function apply(ctx) {
  ctx.systemPrompt.section({ name: 'dshrc:house-rules', order: 900, text: RULES, interpolate: false })
}
