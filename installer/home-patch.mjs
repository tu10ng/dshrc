/**
 * Text operations on the home-level patch (`$DSH_HOME/cordis.patch.yml`) for the dshrc managed
 * block. The block is plain YAML between two marker comments; everything outside it belongs to
 * the user and is preserved byte for byte.
 *
 * @module dshrc/installer/home-patch
 */

/** First line prefix of the managed block. */
export const BEGIN = '# >>> dshrc >>>'

/** Last line of the managed block. */
export const END = '# <<< dshrc <<<'

/** Loader row ids the block targets; a row with one of these ids outside the block conflicts. */
export const OWNED_IDS = ['dshrc', 'hmr']

/**
 * Quote a YAML single-quoted scalar.
 *
 * @param {string} value - raw value
 * @returns {string} the quoted scalar
 */
function quote(value) {
  return `'${value.replaceAll("'", "''")}'`
}

/**
 * Render the managed block.
 *
 * @param {object} options - block inputs
 * @param {string} options.initPath - absolute path of `rc/init.js`, slash-separated
 * @param {string} options.rcDirUrl - `file:` URL of the `rc/` directory
 * @param {string} options.repoDir - checkout directory, named in the header comment
 * @returns {string} the block, without a trailing newline
 */
export function renderBlock({ initPath, rcDirUrl, repoDir }) {
  return [
    `${BEGIN} managed by \`node dshrc.mjs install\` in ${repoDir}; rerun it instead of editing this block`,
    '- insert:',
    '    - id: dshrc',
    `      name: ${quote(initPath)}`,
    '# Hot-reload edits under rc/. A file URL, because HMR cannot take a Windows drive path as base.',
    '- id: hmr',
    '  config:',
    `    base: ${quote(rcDirUrl)}`,
    "    root: ['.']",
    END,
  ].join('\n')
}

/**
 * Locate the managed block.
 *
 * @param {string} text - patch file content
 * @returns {{ start: number, end: number } | undefined} line range `[start, end]`, inclusive
 * @throws {Error} when a begin marker has no end marker or a marker repeats
 */
function locate(text) {
  const lines = text.split(/\r?\n/)
  const begins = lines.flatMap((line, index) => (line.startsWith(BEGIN) ? [index] : []))
  const ends = lines.flatMap((line, index) => (line.trimEnd() === END ? [index] : []))
  if (begins.length === 0 && ends.length === 0) return undefined
  if (begins.length !== 1 || ends.length !== 1 || ends[0] < begins[0]) {
    throw new Error(`托管块标记不完整或重复（应恰好一行 "${BEGIN}" 在前、一行 "${END}" 在后），请手动修复`)
  }
  return { start: begins[0], end: ends[0] }
}

/**
 * Split the file around the managed block.
 *
 * @param {string} text - patch file content
 * @returns {{ outside: string, block: string | undefined }} the user's content and the block
 */
export function splitBlock(text) {
  const range = locate(text)
  if (range === undefined) return { outside: text, block: undefined }
  const lines = text.split(/\r?\n/)
  const block = lines.slice(range.start, range.end + 1).join('\n')
  const outside = [...lines.slice(0, range.start), ...lines.slice(range.end + 1)].join('\n')
  return { outside, block }
}

/**
 * Find rows outside the block that target an id the block owns.
 *
 * @param {string} text - patch file content
 * @returns {string[]} the conflicting ids, deduplicated
 */
export function findConflicts(text) {
  const { outside } = splitBlock(text)
  const found = new Set()
  for (const line of outside.split(/\r?\n/)) {
    const match = /^\s*(?:-\s+)?id:\s*(['"]?)([\w-]+)\1\s*(?:#.*)?$/.exec(line)
    if (match && OWNED_IDS.includes(match[2])) found.add(match[2])
  }
  return [...found]
}

/**
 * Check that the user's content is empty or a YAML block sequence, which the block can extend.
 *
 * @param {string} text - patch file content
 * @returns {string | undefined} a problem description, or undefined when the block can be added
 */
export function layoutProblem(text) {
  const { outside } = splitBlock(text)
  const first = outside.split(/\r?\n/).map(line => line.trim()).find(line => line !== '' && !line.startsWith('#'))
  if (first === undefined || first === '-' || first.startsWith('- ')) return undefined
  return `现有内容不是 YAML 块序列（首个非注释行是 ${JSON.stringify(first)}），无法自动追加，请把托管块手动加入`
}

/**
 * Insert the block, or replace the existing one in place.
 *
 * @param {string} text - patch file content ('' when the file does not exist)
 * @param {string} block - rendered block
 * @returns {string} the new content, ending with one newline
 */
export function upsertBlock(text, block) {
  const range = locate(text)
  if (range !== undefined) {
    const lines = text.split(/\r?\n/)
    return `${[...lines.slice(0, range.start), block, ...lines.slice(range.end + 1)].join('\n').replace(/\n*$/, '')}\n`
  }
  const head = text.replace(/\s*$/, '')
  return head === '' ? `${block}\n` : `${head}\n\n${block}\n`
}

/**
 * Remove the block.
 *
 * @param {string} text - patch file content
 * @returns {{ text: string, removed: boolean }} the remaining content and whether a block was found
 */
export function removeBlock(text) {
  const range = locate(text)
  if (range === undefined) return { text, removed: false }
  const lines = text.split(/\r?\n/)
  const before = lines.slice(0, range.start).join('\n').replace(/\s*$/, '')
  const after = lines.slice(range.end + 1).join('\n').replace(/^(?:[ \t]*\n)+/, '').replace(/\s*$/, '')
  const rest = [before, after].filter(part => part !== '').join('\n\n')
  return { text: rest === '' ? '' : `${rest}\n`, removed: true }
}
