/**
 * Example snippet: a `current_time` tool that tells the model the local date, time, and zone.
 *
 * Model-visible: the schema is sent with every request where the tool is visible. The tool is
 * registered globally; an agent preset that restricts global tools hides it.
 *
 * @module dshrc/snippets/example-tool
 */

export const name = 'dshrc-example-tool'
export const inject = ['tools']

/**
 * @param {object} ctx - Cordis context
 */
export function apply(ctx) {
  ctx.tools.register({
    name: 'current_time',
    description: 'Return the current local date and time with the IANA time zone of the machine running the harness.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute() {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
      return `${new Date().toLocaleString('sv-SE', { timeZone: zone })} (${zone})`
    },
  })
}
