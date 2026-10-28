#!/usr/bin/env node
/**
 * dshrc command line: install this checkout's rc into the DeepSeek Harness home, remove it, or
 * check it. Installation writes one managed block into the home-level patch
 * `$DSH_HOME/cordis.patch.yml`, the layer every profile applies; a running dsh with HMR picks the
 * change up without a restart.
 *
 * Depends only on Node built-ins. Validation shells out to `dsh --dump-config` when `dsh` is on
 * PATH and a profile exists.
 *
 * @module dshrc/cli
 */

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { findConflicts, layoutProblem, removeBlock, renderBlock, splitBlock, upsertBlock } from './installer/home-patch.mjs'
import { rcFiles } from './rc/lib/runtime.js'

const REPO_DIR = dirname(fileURLToPath(import.meta.url))
const RC_DIR = join(REPO_DIR, 'rc')
const INIT_PATH = join(RC_DIR, 'init.js')

/** Entries of `dshrc.log` that `check` prints. */
const LOG_TAIL_ENTRIES = 8

/** Lines of one log entry that `check` prints; the rest are usually stack frames. */
const LOG_ENTRY_LINES = 3

/** Upper bound on one `dsh --dump-config` run, in milliseconds. */
const VERIFY_TIMEOUT_MS = 180_000

const USAGE = `用法: node dshrc.mjs <install|uninstall|check> [选项]

  install    把托管块写入 $DSH_HOME/cordis.patch.yml（可重复执行，原地更新）
  uninstall  从 $DSH_HOME/cordis.patch.yml 移除托管块
  check      语法检查 rc/、显示安装状态、校验组合配置、显示 dshrc.log 末尾

选项:
  --home <dir>      DSH_HOME（默认: 环境变量 DSH_HOME，否则 ~/.dsh）
  --profile <name>  校验时使用的 profile（默认: web，否则第一个已有 profile）
  --no-verify       跳过 dsh --dump-config 校验
  -h, --help        显示帮助`

/** @param {string} path @returns {string} the path with forward slashes */
const slash = path => path.replaceAll('\\', '/')

/** @param {string} home @returns {string} the home-level patch file */
const patchFileOf = home => join(home, 'cordis.patch.yml')

/** @returns {string} the managed block for this checkout */
const blockForThisCheckout = () => renderBlock({
  initPath: slash(INIT_PATH),
  rcDirUrl: pathToFileURL(RC_DIR).href,
  repoDir: slash(REPO_DIR),
})

/**
 * Replace a file through a sibling temporary file, so a watcher never reads a partial write.
 * @param {string} file - target
 * @param {string} text - content
 */
function writeAtomic(file, text) {
  const temporary = `${file}.tmp-dshrc`
  writeFileSync(temporary, text)
  renameSync(temporary, file)
}

/**
 * Parse every rc file with `node --check`.
 * @returns {{ file: string, message: string }[]} the files that fail to parse
 */
function syntaxErrors() {
  return rcFiles().flatMap((file) => {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
    return result.status === 0 ? [] : [{ file: relative(REPO_DIR, file), message: (result.stderr || result.error?.message || '').trim() }]
  })
}

/**
 * Choose the profile used for validation.
 * @param {string} home - DSH_HOME
 * @param {string | undefined} requested - `--profile` value
 * @returns {string | undefined} the profile name, or undefined when the home has none
 */
function pickProfile(home, requested) {
  if (requested) return requested
  const dir = join(home, 'profiles')
  if (!existsSync(dir)) return undefined
  const names = readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(dir, entry.name, 'package.json')))
    .map(entry => entry.name)
  return names.includes('web') ? 'web' : names[0]
}

/**
 * Compose one profile with `dsh --dump-config` and confirm the rc row and HMR base are in it.
 * @param {string} home - DSH_HOME
 * @param {string | undefined} profile - profile name
 * @returns {{ status: 'ok' | 'failed' | 'skipped', detail: string }} the outcome
 */
function verify(home, profile) {
  if (profile === undefined) return { status: 'skipped', detail: `${home} 下还没有 profile，跳过组合校验` }
  if (!/^[\w.-]+$/.test(profile)) return { status: 'failed', detail: `profile 名不合法: ${JSON.stringify(profile)}` }
  const args = ['--profile', profile, '--dump-config']
  const options = { encoding: 'utf8', env: { ...process.env, DSH_HOME: home }, timeout: VERIFY_TIMEOUT_MS }
  // npm installs dsh as `dsh.cmd` on Windows, which only a shell can run; the profile name is
  // checked above, so the command line needs no escaping.
  const result = process.platform === 'win32'
    ? spawnSync(`dsh ${args.join(' ')}`, { ...options, shell: true })
    : spawnSync('dsh', args, options)
  const notFound = result.error?.code === 'ENOENT' || (process.platform === 'win32' && result.status === 1 && /not recognized|不是内部或外部命令/.test(result.stderr ?? ''))
  if (notFound) return { status: 'skipped', detail: 'PATH 上没有 dsh，跳过组合校验' }
  const stderr = (result.stderr ?? '').trim()
  if (result.status !== 0) {
    return { status: 'failed', detail: `dsh --profile ${profile} --dump-config 退出码 ${result.status ?? result.signal}:\n${stderr || result.error?.message || ''}` }
  }
  const stdout = result.stdout ?? ''
  const missing = [
    [pathToFileURL(INIT_PATH).href, 'dshrc 行'],
    [pathToFileURL(RC_DIR).href, 'hmr base'],
  ].filter(([needle]) => !stdout.includes(needle)).map(([, label]) => label)
  if (missing.length > 0) return { status: 'failed', detail: `profile ${profile} 的组合配置里缺少: ${missing.join('、')}` }
  const notes = stderr.split(/\r?\n/).filter(line => /dshrc|hmr/i.test(line))
  return { status: 'ok', detail: `profile ${profile} 组合正常${notes.length ? `；dsh 提示:\n${notes.join('\n')}` : ''}` }
}

/**
 * @param {{ file: string, message: string }[]} errors - syntax errors
 */
function printSyntaxErrors(errors) {
  console.error(`rc/ 中有 ${errors.length} 个文件无法解析:`)
  for (const { file, message } of errors) console.error(`\n  ${file}\n${message.replace(/^/gm, '    ')}`)
}

/**
 * @param {string[]} ids - conflicting row ids
 * @param {string} file - patch file
 */
function printConflicts(ids, file) {
  console.error(`${file} 中托管块之外已有针对 ${ids.map(id => `id: ${id}`).join('、')} 的行。`)
  console.error('home 层的 config 是整体替换的，两处同时写会互相覆盖；请先把那几行合并或删除，再重新安装。托管块内容:')
  console.error(`\n${blockForThisCheckout()}\n`)
}

/**
 * @param {{ home: string, profile?: string, verify: boolean }} options - command options
 * @returns {number} exit code
 */
function install({ home, profile, verify: shouldVerify }) {
  if (!existsSync(home)) {
    console.error(`未找到 DSH_HOME: ${home}（先运行一次 dsh，或用 --home 指定）`)
    return 1
  }
  const errors = syntaxErrors()
  if (errors.length > 0) {
    printSyntaxErrors(errors)
    return 1
  }
  const file = patchFileOf(home)
  const existed = existsSync(file)
  const current = existed ? readFileSync(file, 'utf8') : ''
  const conflicts = findConflicts(current)
  if (conflicts.length > 0) {
    printConflicts(conflicts, file)
    return 1
  }
  const problem = layoutProblem(current)
  if (problem !== undefined) {
    console.error(`${file}: ${problem}\n\n${blockForThisCheckout()}\n`)
    return 1
  }
  const next = upsertBlock(current, blockForThisCheckout())
  const changed = next !== current
  const backup = `${file}.bak-dshrc`
  if (changed) {
    if (existed) copyFileSync(file, backup)
    writeAtomic(file, next)
    console.log(`已写入托管块: ${file}${existed ? `（原文件备份: ${backup}）` : ''}`)
  } else {
    console.log(`托管块已是最新: ${file}`)
  }
  if (shouldVerify) {
    const outcome = verify(home, pickProfile(home, profile))
    if (outcome.status === 'failed') {
      if (changed) {
        if (existed) writeAtomic(file, current)
        else unlinkSync(file)
        console.error(`校验失败，已恢复 ${file}:\n${outcome.detail}`)
      } else {
        console.error(`校验失败:\n${outcome.detail}`)
      }
      return 1
    }
    console.log(outcome.detail)
  }
  console.log([
    '',
    '完成。正在运行的 dsh 会通过 HMR 自动加载 rc；没在运行的话下次启动生效。',
    `- 主机片段: ${slash(join(RC_DIR, 'init.js'))}`,
    `- 浏览器片段: ${slash(join(RC_DIR, 'client.js'))}`,
    `- 日志: ${slash(join(home, 'logs', 'dshrc.log'))}`,
  ].join('\n'))
  return 0
}

/**
 * @param {{ home: string }} options - command options
 * @returns {number} exit code
 */
function uninstall({ home }) {
  const file = patchFileOf(home)
  if (!existsSync(file)) {
    console.log(`${file} 不存在，无需卸载`)
    return 0
  }
  const current = readFileSync(file, 'utf8')
  const { text, removed } = removeBlock(current)
  if (!removed) {
    console.log(`${file} 中没有 dshrc 托管块，无需卸载`)
    return 0
  }
  const backup = `${file}.bak-dshrc`
  copyFileSync(file, backup)
  if (text === '') unlinkSync(file)
  else writeAtomic(file, text)
  console.log(`已移除托管块: ${file}（原文件备份: ${backup}）${text === '' ? '；文件只剩托管块，已删除' : ''}`)
  console.log('正在运行的 dsh 会通过 HMR 卸下 rc。')
  return 0
}

/**
 * @param {{ home: string, profile?: string, verify: boolean }} options - command options
 * @returns {number} exit code
 */
function check({ home, profile, verify: shouldVerify }) {
  let healthy = true
  const errors = syntaxErrors()
  if (errors.length > 0) {
    healthy = false
    printSyntaxErrors(errors)
  } else {
    console.log(`语法检查: rc/ 下 ${rcFiles().length} 个文件全部通过`)
  }

  const file = patchFileOf(home)
  const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
  let block
  try {
    block = splitBlock(current).block
  } catch (error) {
    healthy = false
    console.error(`${file}: ${error.message}`)
  }
  if (block === undefined) {
    console.log(`安装状态: 未安装（${file} 中没有托管块）`)
  } else if (block === blockForThisCheckout()) {
    console.log(`安装状态: 已安装，指向本仓库（${file}）`)
  } else {
    healthy = false
    console.log(`安装状态: 已安装，但托管块与本仓库不一致（另一个 checkout 或旧版本），运行 install 更新（${file}）`)
  }
  const conflicts = findConflicts(current)
  if (conflicts.length > 0) {
    healthy = false
    printConflicts(conflicts, file)
  }
  if (block !== undefined && shouldVerify) {
    const outcome = verify(home, pickProfile(home, profile))
    if (outcome.status === 'failed') healthy = false
    console.log(`组合校验: ${outcome.detail}`)
  }

  const log = join(home, 'logs', 'dshrc.log')
  if (existsSync(log)) {
    const entries = readFileSync(log, 'utf8').trimEnd().split(/\r?\n(?=\d{4}-\d\d-\d\dT)/).slice(-LOG_TAIL_ENTRIES)
    const shown = entries.map((entry) => {
      const lines = entry.split(/\r?\n/)
      const omitted = lines.length - LOG_ENTRY_LINES
      return omitted > 0 ? `${lines.slice(0, LOG_ENTRY_LINES).join('\n')}\n    …（省略 ${omitted} 行，完整内容见日志文件）` : entry
    })
    console.log(`\n${slash(log)} 最后 ${entries.length} 条:\n${shown.join('\n')}`)
  } else {
    console.log(`\n还没有日志: ${slash(log)}（dsh 加载 rc 后生成）`)
  }
  return healthy ? 0 : 1
}

/**
 * @param {string[]} argv - arguments after the script path
 * @returns {number} exit code
 */
function main(argv) {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        'home': { type: 'string' },
        'profile': { type: 'string' },
        'no-verify': { type: 'boolean', default: false },
        'help': { type: 'boolean', short: 'h', default: false },
      },
    })
  } catch (error) {
    console.error(`${error.message}\n\n${USAGE}`)
    return 2
  }
  const { values, positionals } = parsed
  const [command] = positionals
  if (values.help || command === undefined) {
    console.log(USAGE)
    return values.help ? 0 : 2
  }
  const options = {
    home: resolve(values.home ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')),
    profile: values.profile,
    verify: !values['no-verify'],
  }
  switch (command) {
    case 'install': return install(options)
    case 'uninstall': return uninstall(options)
    case 'check': return check(options)
    default:
      console.error(`未知命令: ${command}\n\n${USAGE}`)
      return 2
  }
}

process.exitCode = main(process.argv.slice(2))
