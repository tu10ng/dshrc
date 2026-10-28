/**
 * Example snippet: ask for confirmation before a shell command force-pushes with git.
 *
 * A listener on the `tools/pre-execute` waterfall, the dsh counterpart of an Emacs advice: it
 * returns its own decision for matching calls and delegates every other call with `next()`.
 *
 * @module dshrc/snippets/example-guard
 */

export const name = 'dshrc-example-guard'
export const inject = ['tools']

/** Shell tools whose `command` argument is checked. */
const SHELL_TOOLS = new Set(['bash', 'pwsh'])

/** `git push` with `--force`, `--force-with-lease`, or `-f`. */
const FORCE_PUSH = /\bgit\b[^;&|]*\bpush\b[^;&|]*(?:--force\b|--force-with-lease\b|\s-f\b)/

/**
 * @param {object} ctx - Cordis context
 */
export function apply(ctx) {
  ctx.on('tools/pre-execute', (exec, next) => {
    const command = exec.arguments?.command
    if (SHELL_TOOLS.has(exec.name) && typeof command === 'string' && FORCE_PUSH.test(command)) {
      return { kind: 'ask', reason: 'dshrc: git force push needs confirmation' }
    }
    return next()
  })
}
