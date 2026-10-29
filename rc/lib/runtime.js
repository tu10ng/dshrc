/**
 * dshrc host runtime: mounts the snippets `init.js` declares and makes rc failures visible.
 *
 * A snippet is an ordinary Cordis plugin (`name`, optional `inject`, `apply`): declared inline with
 * {@link createRc}'s `snippet()`, or a module under `snippets/` passed to `use()`, or a module
 * whose default export is a plugin. Each snippet mounts as its own child plugin: one failing
 * snippet leaves the others running, and a hot reload disposes everything the previous
 * generation registered.
 *
 * Reports go to the dsh console and to `$DSH_HOME/logs/dshrc.log`:
 * - every mount, with the snippet names (a snippet whose `inject` is unmet waits, unreported);
 * - a snippet whose `apply` throws or rejects;
 * - a hot reload dsh rejected, such as one for a syntax error, and any other dsh warning that names
 *   a file under `rc/`. dsh reports a rejected reload only to its logger and keeps the previous
 *   generation running; that generation's log exporter is still registered, so it reports the
 *   failure. A rejected reload also reverts the other files changed in the same batch.
 *
 * @module dshrc/lib/runtime
 */

import { execFile } from 'node:child_process'
import { appendFileSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { format } from 'node:util'

/** The `rc/` directory. */
const RC_DIR = dirname(dirname(fileURLToPath(import.meta.url)))

/** Spellings of the rc directory that appear in dsh diagnostics: native path, slash path, file URL. */
const RC_MARKERS = [...new Set([RC_DIR, RC_DIR.replaceAll('\\', '/'), pathToFileURL(RC_DIR).href])]

/** Size at which `dshrc.log` rotates to `dshrc.log.old`. */
const LOG_ROTATE_BYTES = 256 * 1024

/** Window in which an identical dsh warning is reported once, in milliseconds. */
const DUPLICATE_WINDOW_MS = 2000

/** Age below which an rc file counts as part of the latest edit, in milliseconds. */
const RECENT_EDIT_MS = 60_000

/** Console prefix of every rc report. */
const PREFIX = '[dshrc]'

/**
 * Resolve the log file under the Harness home.
 *
 * @param {object} ctx - Cordis context
 * @returns {string} absolute path of `dshrc.log`
 */
function logPath(ctx) {
  const dshHomePath = ctx.get('dshHomePath')
  if (typeof dshHomePath === 'function') return dshHomePath('logs', 'dshrc.log')
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'logs', 'dshrc.log')
}

/**
 * Create the reporter shared by the runtime and the log exporter.
 *
 * @param {object} ctx - Cordis context
 * @returns {{ info: (...args: unknown[]) => void, error: (...args: unknown[]) => void }} reporter
 */
function createReporter(ctx) {
  const file = logPath(ctx)
  let fileFailed = false
  const write = (level, args) => {
    const text = format(...args)
    if (level === 'error') console.error(PREFIX, text)
    else console.log(PREFIX, text)
    if (fileFailed) return
    try {
      mkdirSync(dirname(file), { recursive: true })
      try {
        if (statSync(file).size > LOG_ROTATE_BYTES) renameSync(file, `${file}.old`)
      } catch {
        // No log file yet: nothing to rotate.
      }
      appendFileSync(file, `${new Date().toISOString()} ${level.toUpperCase()} ${text}\n`)
    } catch (error) {
      fileFailed = true
      console.error(PREFIX, `无法写入 ${file}，后续只输出到控制台:`, error)
    }
  }
  return {
    info: (...args) => write('info', args),
    error: (...args) => write('error', args),
  }
}

/**
 * List the `.js` files under `rc/`.
 *
 * @param {string} dir - directory to walk
 * @returns {string[]} absolute paths
 */
export function rcFiles(dir = RC_DIR) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name.startsWith('.') ? [] : rcFiles(path)
    return entry.name.endsWith('.js') ? [path] : []
  })
}

/**
 * Parse one file with `node --check` in a child process.
 *
 * @param {string} file - absolute path
 * @returns {Promise<string | undefined>} `location message` when the file fails to parse
 */
function checkSyntax(file) {
  return new Promise((resolve) => {
    execFile(process.execPath, ['--check', file], { encoding: 'utf8' }, (error, _stdout, stderr) => {
      if (!error) return resolve(undefined)
      const lines = (stderr ?? '').split(/\r?\n/)
      const where = lines.find(line => /:\d+$/.test(line))?.replace(/^file:\/\/\//, '') ?? file
      const message = lines.find(line => line.startsWith('SyntaxError')) ?? lines.find(line => line.trim()) ?? error.message
      resolve(`  ${where} ${message}`)
    })
  })
}

/**
 * Locate syntax errors under `rc/`. Node's module SyntaxError carries no file name, so this is how
 * a rejected hot reload gets a location. Files edited within {@link RECENT_EDIT_MS} are checked
 * first, the rest only when those all parse. Child processes keep the dsh event loop free.
 * Skipped under Electron, whose executable is not a Node CLI.
 *
 * @returns {Promise<string[]>} one `location message` entry per file that fails to parse
 */
async function locateSyntaxErrors() {
  if (process.versions.electron) return []
  const now = Date.now()
  const files = rcFiles()
  const recent = files.filter(file => now - statSync(file).mtimeMs < RECENT_EDIT_MS)
  const check = async list => (await Promise.all(list.map(checkSyntax))).filter(Boolean)
  const found = await check(recent)
  return found.length > 0 ? found : check(files.filter(file => !recent.includes(file)))
}

/**
 * Report dsh warnings and errors about the rc: every HMR warning (the managed block points HMR at
 * `rc/` and the patch files only) and any warning that names a file under `rc/`.
 *
 * @param {object} ctx - Cordis context
 * @param {ReturnType<typeof createReporter>} report - reporter
 * @param {WeakSet<object>} reported - errors the snippet wrapper already reported
 */
function exportRcDiagnostics(ctx, report, reported) {
  let last = { text: '', at: 0 }
  ctx.logger.exporter({
    levels: { default: 2 },
    export({ type, name, args }) {
      if (type !== 'warn' && type !== 'error') return
      if (args.some(arg => typeof arg === 'object' && arg !== null && reported.has(arg))) return
      const text = format(...args)
      if (name !== 'hmr' && !RC_MARKERS.some(marker => text.includes(marker))) return
      // HMR reports one rejected reload more than once.
      const now = Date.now()
      if (text === last.text && now - last.at < DUPLICATE_WINDOW_MS) return
      last = { text, at: now }
      if (name === 'hmr' && text.startsWith('SyntaxError')) {
        report.error(`dsh 拒绝了这次热重载: ${text.split('\n')[0]}`)
        locateSyntaxErrors().then(
          located => located.length > 0 && report.error(`语法错误位置:\n${located.join('\n')}`),
          error => report.error('定位语法错误失败:', error),
        )
      } else {
        report.error(`dsh ${name} ${type}:`, text)
      }
      if (name === 'hmr') {
        report.error('dsh 继续运行上一个版本。修好后保存即可；同一批改动的其他文件也被回滚了，修好后如果行为没更新，把它们也重新保存一次。')
      }
    },
  })
}

/**
 * Wrap one snippet module so a failing `apply` is reported under the snippet's name. The error is
 * rethrown, so Cordis still marks the child plugin failed and disposes what it registered.
 *
 * @param {Record<string, any>} snippet - snippet module namespace
 * @param {number} index - position in the snippet list, for unnamed snippets
 * @param {ReturnType<typeof createReporter>} report - reporter
 * @param {WeakSet<object>} reported - errors already reported
 * @returns {{ label: string, plugin: unknown }} the plugin to mount and its display label
 */
function contain(snippet, index, report, reported) {
  if (typeof snippet?.apply !== 'function') {
    // A module that default-exports a plugin (for example a Service subclass) mounts as is.
    if (snippet?.default) return { label: snippet.default.name || `#${index + 1}`, plugin: snippet.default }
    throw new TypeError(`第 ${index + 1} 个片段（${snippet?.name || '未命名'}）没有 apply 函数，也不是 default 导出插件的模块`)
  }
  const label = snippet.name || `#${index + 1}`
  const fail = (error) => {
    if (typeof error === 'object' && error !== null) reported.add(error)
    report.error(`片段 ${label} 加载失败:`, error)
    throw error
  }
  return {
    label,
    plugin: {
      name: label,
      inject: snippet.inject,
      Config: snippet.Config,
      apply(ctx, config) {
        try {
          const result = snippet.apply(ctx, config)
          return typeof result?.then === 'function' ? result.then(undefined, fail) : result
        } catch (error) {
          return fail(error)
        }
      },
    },
  }
}

/**
 * Mount the host snippets under the rc plugin's context.
 *
 * @param {object} ctx - the rc plugin's Cordis context
 * @param {Array<Record<string, any>>} snippets - snippet module namespaces, in mount order
 */
export function mount(ctx, snippets) {
  const report = createReporter(ctx)
  const reported = new WeakSet()
  exportRcDiagnostics(ctx, report, reported)
  const labels = []
  snippets.forEach((snippet, index) => {
    try {
      const { label, plugin } = contain(snippet, index, report, reported)
      labels.push(label)
      ctx.plugin(plugin)
    } catch (error) {
      report.error(error)
    }
  })
  report.info(`已挂载 ${labels.length} 个主机片段${labels.length ? `: ${labels.join(', ')}` : ''}`)
}

/**
 * Create the snippet list of one `init.js` evaluation. A hot reload evaluates `init.js` again and
 * so starts a new list, while this module may stay cached; the list therefore lives in the
 * returned object, never in this module.
 *
 * @returns {{
 *   snippet: (name: string, inject: unknown, apply?: (ctx: object, config?: unknown) => unknown) => void,
 *   use: (snippet: object) => void,
 *   mount: (ctx: object) => void,
 * }} `snippet(name, inject?, apply)` declares an inline snippet (`inject` is optional, as in a
 * Cordis plugin); `use(module)` adds a snippet module or plugin object; `mount(ctx)` mounts them
 * in declaration order
 */
export function createRc() {
  const snippets = []
  return {
    snippet(name, inject, apply) {
      snippets.push(typeof inject === 'function' ? { name, apply: inject } : { name, inject, apply })
    },
    use(snippet) {
      snippets.push(snippet)
    },
    mount(ctx) {
      mount(ctx, snippets)
    },
  }
}
