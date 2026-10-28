import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mount } from '../rc/lib/runtime.js'

const RC_DIR = fileURLToPath(new URL('../rc/', import.meta.url))
const home = mkdtempSync(join(tmpdir(), 'dshrc-test-'))
after(() => rmSync(home, { recursive: true, force: true }))

/**
 * A Cordis context reduced to what the runtime uses. `plugin` applies synchronously and records
 * the outcome, as a child fiber would.
 * @returns {object} the fake context and its recordings
 */
function fakeContext() {
  const exporters = []
  const mounted = []
  const ctx = {
    get: key => (key === 'dshHomePath' ? (...segments) => join(home, ...segments) : undefined),
    logger: { exporter: exporter => exporters.push(exporter) },
    plugin(plugin) {
      const record = { plugin, outcome: 'active' }
      mounted.push(record)
      try {
        const result = plugin.apply({ child: plugin.name }, undefined)
        if (typeof result?.then === 'function') record.outcome = result.then(() => 'active', () => 'failed')
      } catch {
        record.outcome = 'failed'
      }
    },
  }
  return { ctx, exporters, mounted }
}

/** @returns {string} the log written so far */
const readLog = () => readFileSync(join(home, 'logs', 'dshrc.log'), 'utf8')

/**
 * Run `fn` with console output captured.
 * @param {() => Promise<void> | void} fn - code under test
 * @returns {Promise<string[]>} the captured lines
 */
async function captureConsole(fn) {
  const lines = []
  const { log, error } = console
  console.log = (...args) => lines.push(args.join(' '))
  console.error = (...args) => lines.push(args.map(String).join(' '))
  try {
    await fn()
  } finally {
    Object.assign(console, { log, error })
  }
  return lines
}

describe('snippet modules', () => {
  test('every example snippet is a named Cordis plugin module', async () => {
    const dir = join(RC_DIR, 'snippets')
    for (const file of readdirSync(dir).filter(name => name.endsWith('.js'))) {
      const snippet = await import(pathToFileURL(join(dir, file)).href)
      assert.equal(typeof snippet.name, 'string', file)
      assert.equal(typeof snippet.apply, 'function', file)
    }
  })

  test('init.js is the dshrc plugin', async () => {
    const init = await import(pathToFileURL(join(RC_DIR, 'init.js')).href)
    assert.equal(init.name, 'dshrc')
    assert.equal(typeof init.apply, 'function')
  })
})

describe('mount', () => {
  test('mounts each snippet as its own plugin and reports the list', async () => {
    const { ctx, mounted } = fakeContext()
    const seen = []
    const lines = await captureConsole(() => mount(ctx, [
      { name: 'a', inject: ['tools'], apply: child => seen.push(child) },
      { name: 'b', apply() {} },
    ]))
    assert.deepEqual(mounted.map(({ plugin }) => [plugin.name, plugin.inject]), [['a', ['tools']], ['b', undefined]])
    assert.deepEqual(seen, [{ child: 'a' }])
    assert.match(lines.at(-1), /已挂载 2 个主机片段: a, b/)
    assert.match(readLog(), /INFO 已挂载 2 个主机片段: a, b/)
  })

  test('reports a throwing snippet by name, rethrows it, and keeps its siblings', async () => {
    const { ctx, mounted } = fakeContext()
    const lines = await captureConsole(() => mount(ctx, [
      { name: 'bad', apply() { throw new Error('boom') } },
      { name: 'good', apply() {} },
    ]))
    assert.deepEqual(mounted.map(({ outcome }) => outcome), ['failed', 'active'])
    assert.ok(lines.some(line => line.includes('片段 bad 加载失败') && line.includes('boom')))
    assert.match(readLog(), /ERROR 片段 bad 加载失败: Error: boom/)
  })

  test('reports a rejecting async snippet and leaves the rejection to Cordis', async () => {
    const { ctx, mounted } = fakeContext()
    const lines = await captureConsole(async () => {
      mount(ctx, [{ name: 'late', async apply() { throw new Error('later') } }])
      assert.equal(await mounted[0].outcome, 'failed')
    })
    assert.ok(lines.some(line => line.includes('片段 late 加载失败') && line.includes('later')))
  })

  test('mounts a default-exported plugin unwrapped and reports a module with neither form', async () => {
    const { ctx, mounted } = fakeContext()
    const service = { name: 'svc', apply() {} }
    const lines = await captureConsole(() => mount(ctx, [{ default: service }, { name: 'empty' }]))
    assert.equal(mounted.length, 1)
    assert.equal(mounted[0].plugin, service)
    assert.ok(lines.some(line => line.includes('第 1 个片段既没有导出 apply')))
  })

  test('reports a rejected hot reload once, with a hint, even without a file name', async () => {
    const { ctx, exporters } = fakeContext()
    const lines = await captureConsole(() => {
      mount(ctx, [])
      const [exporter] = exporters
      // Node's module SyntaxError names no file; HMR logs it twice.
      const warning = { type: 'warn', name: 'hmr', args: [new SyntaxError('Unexpected end of input')] }
      exporter.export(warning)
      exporter.export(warning)
      exporter.export({ type: 'info', name: 'hmr', args: [`watching ${RC_DIR}`] })
    })
    const rejected = lines.filter(line => line.includes('dsh 拒绝了这次热重载'))
    assert.equal(rejected.length, 1)
    assert.match(rejected[0], /SyntaxError: Unexpected end of input/)
    assert.equal(lines.filter(line => line.includes('dsh 继续运行上一个版本')).length, 1)
    assert.match(readLog(), /ERROR dsh 拒绝了这次热重载: SyntaxError: Unexpected end of input/)
  })

  test('reports other dsh warnings only when they name an rc file, and skips errors already reported', async () => {
    const { ctx, exporters } = fakeContext()
    const thrown = new Error('boom')
    const lines = await captureConsole(() => {
      mount(ctx, [{ name: 'bad', apply() { throw thrown } }])
      const [exporter] = exporters
      exporter.export({ type: 'warn', name: 'loader', args: ['unrelated plugin failed'] })
      exporter.export({ type: 'warn', name: 'loader', args: [`cannot import ${pathToFileURL(join(RC_DIR, 'snippets', 'x.js')).href}`] })
      exporter.export({ type: 'error', name: 'loader', args: [thrown] })
    })
    const exported = lines.filter(line => line.includes('dsh loader'))
    assert.equal(exported.length, 1)
    assert.match(exported[0], /dsh loader warn: cannot import file:.*\/rc\/snippets\/x\.js/)
  })
})
