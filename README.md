# dshrc

**中文** · [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）的个人 rc：像 Emacs 的 `init.el` 一样，放一些改变 dsh 行为、但还没复杂到需要做成包的片段。

## 为什么

dsh 的一切都是 Cordis 插件，这很好；但哪怕只想加一条 system prompt 规则、一个小 tool、一个拦截 hook，也得建包、写 `cordis.patch.yml`、`dsh plugin add`。Emacs 有 `init.el`：随手写、保存即生效、复杂了再抽成包。dshrc 给 dsh 补上这个位置。

片段直接写在 `rc/init.js` 里，一段一个 `rc.snippet(name, inject?, apply)`。每段都是**普通的 Cordis 插件**（`name`、`inject`、`apply(ctx)`），哪天长大了要变成正式插件包，代码原样可用。

## 工作原理

`node dshrc.mjs install` 往 `$DSH_HOME/cordis.patch.yml` 写入一个托管块。这是 dsh 的 home 层 patch：所有 profile 共享，优先级高于各 profile 自己的 `cordis.patch.yml`。

```yaml
# >>> dshrc >>> managed by `node dshrc.mjs install` in <本仓库>; rerun it instead of editing this block
- insert:
    - id: dshrc
      name: '<本仓库>/rc/init.js'
# Hot-reload edits under rc/. A file URL, because HMR cannot take a Windows drive path as base.
- id: hmr
  config:
    base: 'file:///<本仓库>/rc'
    root: ['.']
# <<< dshrc <<<
```

- 第一段把 `rc/init.js` 作为一个 Loader 行加载。`rc/package.json` 声明了 `dsh.client`，所以 `rc/client.js` 同时作为浏览器侧模块下发。
- 第二段让 dsh 的 HMR 监听 `rc/`。dsh 默认只监听 patch 文件、不监听插件源码；加上它之后保存即生效。

## 安装

需要 Node ≥ 22.19（dsh 本身的要求），不依赖任何 npm 包。

```sh
git clone https://github.com/tu10ng/dshrc ~/projects/dshrc
cd ~/projects/dshrc
node dshrc.mjs install
```

- 安装前对 `rc/` 做语法检查；写入后用 `dsh --profile web --dump-config` 校验组合配置，失败自动恢复原文件。原文件备份为 `cordis.patch.yml.bak-dshrc`。
- 正在运行的 dsh 会通过 HMR 自动加载 rc，已打开的 Web 页面也会自动拿到浏览器侧，无需重启或刷新。
- 可重复执行：托管块原地更新。仓库挪了位置，重新 `install` 一次即可。
- home patch 里如果已有你自己写的 `id: hmr` 或 `id: dshrc` 行，install 会拒绝并请你先合并（home 层的 `config` 是整体替换的，两处同时写会互相覆盖）。

## 写片段

### 主机侧（dsh 进程内，Node）

直接写在 `rc/init.js` 里，和 `init.el` 一样一段接一段往下写：

```js
rc.snippet('my-rules', ['systemPrompt'], (ctx) => {
  ctx.systemPrompt.section({ name: 'my:rules', order: 900, text: '- 回答用中文。', interpolate: false })
})

rc.snippet('hello', (ctx) => {
  ctx.logger('dshrc').info('loaded')
})
```

`rc.snippet(name, inject?, apply)`：`inject` 是要等待的服务（`ctx.tools`、`ctx.systemPrompt` 等），不需要服务时可以省略。片段按文件里的顺序挂载，注释掉就是禁用。`init.js` 里已经以注释的形式写好了三个示例。

保存即热重载：上一版注册的一切（tool、prompt section、hook、监听器、`ctx.effect` 里的副作用）会自动撤销，不会像重复 eval `init.el` 那样叠加 hook。每个片段是独立的子插件，一个片段出错不影响其他片段。

片段写长了，可以挪到 `rc/snippets/<name>.js`，写成插件模块（`export const name`、`inject`、`apply`），再在 `init.js` 里**静态** import：

```js
import * as myTool from './snippets/my-tool.js'
rc.use(myTool)
```

必须是静态 import：dsh 的热重载只跟踪静态依赖。

能用的扩展点和 dsh 插件完全一样，见 dsh 的 [extension cookbook](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/cookbook/extension-cookbook.md) 和各 subsystem 文档。常用的：`ctx.systemPrompt.section()`、`ctx.tools.register()`、`ctx.on('tools/pre-execute', (exec, next) => …)`、`ctx.on('session/event', …)`。

### 浏览器侧（Web Client）

dsh 原样下发 `rc/client.js`，不打包，所以浏览器片段直接写在这个文件里：定义一个插件对象，加进 `snippets` 列表。DOM 改动和监听器都通过 `ctx.effect(() => () => 清理)` 注册，热重载时才会被撤销。保存后已打开的页面会自动更新。

### 浏览器片段 `remember-panel`（已启用）

dsh 只在内存里记"当前选中的全局面板"（待办、插件、自动化任务……），刷新时只恢复上一个会话，于是页面总落回对话。`client.js` 里的 `remember-panel` 把选中的面板存进 localStorage（按地址区分，不同端口各记各的），刷新后等这个面板注册好再选回去；插件重载或被禁用时面板暂时消失、dsh 退回对话，面板回来后也会选回去。回到对话（点会话或新会话）就清掉记录。只用 `ctx.layout.panelInfo`、`ctx.layout.selectPanel` 和 `ctx.slots` 这些公开接口。

实测（headless Edge + 临时 DSH_HOME + dsh-global-todo）：在待办、插件上刷新都留在原面板；新会话后刷新回到对话；禁用再启用自动化任务后自动选回；去掉片段后刷新落回对话（即原来的行为）。如果待办插件注册得慢，刷新的一瞬间可能先闪一下对话。

### 浏览器片段 `ui-text`（已启用）

改界面文字。`texts` 表按"命名空间 → 键 → 文字"填，所有语言都生效；命名空间和键就是各包在 `lib/client.js` 里 `ctx.locale.register(ns, { zh, en })` 注册的那些。目前只有一条：侧边栏左下角的账号名 `settings.account` → `signedIn`，原文"已登录 DeepSeek"，改成"tu10ng的dsh"。DeepSeek 账号资料里没有昵称时 dsh 才显示这句，设置 → 账号与余额里的账号名也用它；如果账号资料返回了昵称，显示的是昵称。

dsh 的 locale 服务没有覆盖接口，同一命名空间同一语言再注册一次会直接报错，所以这里包了一层它的查找（`translate` 在类型上是私有的，dsh 升级后可能要跟着改），再注册一个空字典让已经渲染的文字刷新。卸载时还原。

实测（headless Edge + 临时 DSH_HOME）：替换生效，其他键不受影响；热重载时界面上的文字直接更新，不用刷新；刷新后仍然生效；从片段列表去掉后恢复原文。

### 示例（默认都注释掉了）

| 位置 | 内容 | 实测 |
|---|---|---|
| `init.js` 的 `house-rules` | 往每个 agent 的 system prompt 追加一段 house rules | 出现在 `ctx.systemPrompt.assemble()` 的结果里 |
| `init.js` 的 `current-time` | `current_time` tool：返回本地时间和时区 | 注册成功、执行返回 `2026-10-28 22:19:33 (Asia/Shanghai)` 这种格式 |
| `init.js` 的 `confirm-force-push` | shell 命令里有 `git push --force` 时要求确认（相当于 Emacs 的 advice） | `tools/pre-execute` 对 force push 返回 `ask`，对普通 push 返回 `allow` |
| `client.js` 里的 `exampleCss` | 页面级 CSS | 热加载生效，卸载时样式被移除 |

`current_time` 是全局注册的 tool；agent preset 如果限制了全局 tool，就看不到它。这一点没有在真实对话里验证过。

## Emacs 对照

| Emacs | dshrc |
|---|---|
| `init.el` | `rc/init.js`（主机侧）+ `rc/client.js`（浏览器侧） |
| 在 `init.el` 里写一段 `(add-hook …)` / `(defun …)` | 在 `init.js` 里写一段 `rc.snippet(…)` |
| `(require 'foo)`（`lisp/foo.el`） | `import * as foo from './snippets/foo.js'` + `rc.use(foo)` |
| `add-hook` | `ctx.on('event', listener)` |
| `advice-add :around` | waterfall 监听器：`ctx.on('tools/pre-execute', (exec, next) => …)` |
| `eval-buffer` | 保存文件 |
| `*Messages*` / `*Warnings*` | dsh 控制台里 `[dshrc]` 开头的行 + `$DSH_HOME/logs/dshrc.log` |
| `emacs -q` | `dsh web --patch no-rc.yml`，`no-rc.yml` 内容为 `- id: dshrc` / `  disabled: true`；或者 `node dshrc.mjs uninstall` |
| 包（`package.el`） | dsh 插件包 / bundle（`dsh plugin add`） |

## 出错时

- **片段 `apply` 抛错**：只有这个片段失败，其他照常；报 `[dshrc] 片段 <name> 加载失败` 和堆栈。
- **语法错误**：dsh 拒绝这次热重载，继续运行上一个版本。dsh 自己只把它记进内部 logger、不打印；dshrc 会报 `dsh 拒绝了这次热重载: SyntaxError: …`，并用 `node --check` 定位到文件和行号。
- **被拒绝的热重载会把同一批改动的其他文件也回滚成旧版本**。修好错误后，如果某个文件的改动没生效，把它再保存一次。
- **启动时 rc 出错不会阻止 dsh 启动**：用户插入的行不是 required 条目，失败只打印 warning。
- `node dshrc.mjs check`：语法检查、安装状态、组合校验，以及 `dshrc.log` 最后几条。

## 限制（dsh 0.2.1-rc.2 上实测）

1. **rc 里不能 `import '@deepseek-ai/dsh-*'`**，会报 `ERR_MODULE_NOT_FOUND`。dsh 的模块解析钩子只覆盖 `$DSH_HOME/profiles/**` 和 link 进 profile 的目录。片段通过 `ctx` 上的服务做事即可；真需要 import dsh 包时，就该把它做成插件包了。Node 内置模块（`node:fs` 等）和相对路径 import 都正常。
2. **只能写 JS**：npm 安装的 dsh 不转译 TypeScript。可以用 JSDoc 写类型。
3. **用静态 import**：HMR 只跟踪静态依赖，用 `import()` 动态加载的文件改了不会触发重载。
4. **`rc/` 下只能有一个 Loader 行**（就是 `rc/init.js`）。`rc/package.json` 声明了 `dsh.client`，dsh 要求一个客户端包只有一个 Loader 来源；在 patch 里给 `rc/` 下的其他文件再加行，会让 Web 启动失败。
5. **浏览器片段只能写在 `client.js` 这一个文件里**。
6. **home 层作用于所有 profile**。headless / SDK / ACP profile 默认关闭 HMR：rc 照样加载，但不会热重载。`sdk-minimal` 没有 `hmr` 行，会多一条 patch 目标不存在的 warning。
7. **没有沙箱**：rc 以 dsh 进程的完整权限运行。和 `init.el` 一样，只放你自己写过或读过的代码。
8. **模型可见**：system prompt section 和 tool 会进入每次请求，消耗 token，修改后还会改变 prompt cache 的前缀。

## 命令

```sh
node dshrc.mjs install    [--home <DSH_HOME>] [--profile <name>] [--no-verify]
node dshrc.mjs uninstall  [--home <DSH_HOME>]
node dshrc.mjs check      [--home <DSH_HOME>] [--profile <name>] [--no-verify]
npm test                  # 单元测试；只读 rc/，不会触发正在运行的 dsh 热重载
```

## 结构

```
dshrc/
├── dshrc.mjs                 # install / uninstall / check
├── installer/home-patch.mjs  # 托管块的文本操作
├── rc/                       # dsh 实际加载的目录（HMR 只监听这里）
│   ├── package.json          # 声明 dsh.client
│   ├── init.js               # 主机侧入口：片段直接写在这里
│   ├── client.js             # 浏览器侧入口：浏览器片段
│   ├── lib/runtime.js        # rc.snippet / rc.use、错误隔离与上报、dshrc.log
│   └── snippets/             # 写长了的片段（可选）
└── test/
```

## 兼容

在 dsh 0.2.1-rc.2（npm 全局安装）+ Windows 上开发，端到端验证过：运行中安装和卸载、主机侧与已打开页面的浏览器侧热加载、三个示例片段的实际效果、语法错误上报、片段抛错隔离。dsh 处于 developer preview，接口变化时这里可能需要跟着改。

MIT.
