import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { BEGIN, END, findConflicts, layoutProblem, removeBlock, renderBlock, splitBlock, upsertBlock } from '../installer/home-patch.mjs'

const block = renderBlock({
  initPath: 'C:/Users/me/projects/dshrc/rc/init.js',
  rcDirUrl: 'file:///C:/Users/me/projects/dshrc/rc',
  repoDir: 'C:/Users/me/projects/dshrc',
})

const userRows = `# my preferences
- id: ui-theme
  config:
    preference: dark
`

describe('renderBlock', () => {
  test('targets the dshrc row and the hmr row between the markers', () => {
    const lines = block.split('\n')
    assert.ok(lines[0].startsWith(BEGIN))
    assert.equal(lines.at(-1), END)
    assert.match(block, /^    - id: dshrc\n      name: 'C:\/Users\/me\/projects\/dshrc\/rc\/init\.js'$/m)
    assert.match(block, /^- id: hmr\n  config:\n    base: 'file:\/\/\/C:\/Users\/me\/projects\/dshrc\/rc'\n    root: \['\.'\]$/m)
  })

  test('doubles single quotes in YAML scalars', () => {
    const quoted = renderBlock({ initPath: "/home/o'neil/rc/init.js", rcDirUrl: "file:///home/o'neil/rc", repoDir: '/x' })
    assert.match(quoted, /name: '\/home\/o''neil\/rc\/init\.js'/)
    assert.match(quoted, /base: 'file:\/\/\/home\/o''neil\/rc'/)
  })
})

describe('upsertBlock', () => {
  test('creates the content of a missing file', () => {
    assert.equal(upsertBlock('', block), `${block}\n`)
  })

  test('appends after existing rows, separated by one blank line', () => {
    assert.equal(upsertBlock(userRows, block), `${userRows}\n${block}\n`)
  })

  test('replaces an existing block in place and keeps rows on both sides', () => {
    const old = renderBlock({ initPath: '/old/rc/init.js', rcDirUrl: 'file:///old/rc', repoDir: '/old' })
    const text = `${userRows}\n${old}\n\n- id: extra\n  disabled: true\n`
    const next = upsertBlock(text, block)
    assert.equal(next, `${userRows}\n${block}\n\n- id: extra\n  disabled: true\n`)
    assert.equal(upsertBlock(next, block), next)
  })

  test('rejects a begin marker without an end marker', () => {
    assert.throws(() => upsertBlock(`${userRows}${BEGIN}\n- id: dshrc\n`, block), /标记不完整/)
  })
})

describe('removeBlock', () => {
  test('restores the content the block was appended to', () => {
    assert.deepEqual(removeBlock(upsertBlock(userRows, block)), { text: userRows, removed: true })
  })

  test('leaves an empty text when the file held only the block', () => {
    assert.deepEqual(removeBlock(`${block}\n`), { text: '', removed: true })
  })

  test('joins the rows on both sides of the block', () => {
    const text = `${userRows}\n${block}\n\n- id: extra\n  disabled: true\n`
    assert.equal(removeBlock(text).text, `${userRows.trimEnd()}\n\n- id: extra\n  disabled: true\n`)
  })

  test('reports a file without a block unchanged', () => {
    assert.deepEqual(removeBlock(userRows), { text: userRows, removed: false })
  })
})

describe('findConflicts', () => {
  test('ignores the rows inside the block', () => {
    assert.deepEqual(findConflicts(upsertBlock(userRows, block)), [])
  })

  test('reports owned ids targeted outside the block, in any quoting', () => {
    const text = `- id: "hmr"\n  disabled: true\n- insert:\n    - id: 'dshrc'\n      name: ./x.js\n- id: hmr-other\n`
    assert.deepEqual(findConflicts(upsertBlock(text, block)).sort(), ['dshrc', 'hmr'])
  })
})

describe('layoutProblem', () => {
  test('accepts an empty file, a comment-only file, and a block sequence', () => {
    assert.equal(layoutProblem(''), undefined)
    assert.equal(layoutProblem('# only a comment\n'), undefined)
    assert.equal(layoutProblem(userRows), undefined)
  })

  test('rejects a flow sequence, which a block item cannot extend', () => {
    assert.match(layoutProblem('[]\n'), /不是 YAML 块序列/)
  })
})

describe('splitBlock', () => {
  test('separates the block from the user content', () => {
    const { outside, block: found } = splitBlock(upsertBlock(userRows, block))
    assert.equal(found, block)
    assert.equal(outside.trim(), userRows.trim())
  })
})
