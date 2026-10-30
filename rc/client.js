/**
 * dshrc — browser entry (Web Client half).
 *
 * dsh serves this file as is, so it is one classic script with no imports: browser snippets are
 * defined inline below and listed in `snippets`. A snippet is a Cordis plugin object (`name`,
 * optional `inject`, `apply(ctx)`); register every DOM change or listener through `ctx.effect`
 * so a hot reload removes it. Saving this file hot-reloads it in open pages.
 *
 * Failures are reported in the browser console with the `[dshrc]` prefix.
 *
 * @module dshrc/client
 */

window.__ModuleLoader__.load({
  id: 'dshrc',

  factory(require) {
    void require

    /** Example snippet: page-wide CSS. */
    const exampleCss = {
      name: 'dshrc-example-css',
      apply(ctx) {
        const style = document.createElement('style')
        style.dataset.dshrc = 'example-css'
        style.textContent = `
          /* Your CSS here, for example: */
          /* body { letter-spacing: 0.01em; } */
        `
        document.head.append(style)
        ctx.effect(() => () => style.remove())
      },
    }
    void exampleCss

    /**
     * Keep the selected global panel (待办, 插件, 自动化任务, ...) across a page reload. dsh keeps
     * that selection in memory only and restores just the last Session, so a reload lands on the
     * Conversation. This saves the selection per origin and selects it again once its panel is
     * registered: a plugin's panel can register after this snippet mounts.
     */
    const rememberPanel = {
      name: 'remember-panel',
      inject: ['layout', 'slots'],
      apply(ctx) {
        const key = 'dshrc.active-panel'
        const active = () => ctx.layout.panelInfo.getSnapshot().activePanelId
        const registered = id => ctx.slots.entries('main').some(entry => entry.options.key === id)
        // The panel to select once it is registered: the saved one, or one whose plugin is reloading.
        let pending = localStorage.getItem(key)
        let last = active()
        const restore = () => {
          if (pending === null || !registered(pending)) return
          const id = pending
          pending = null
          if (active() !== id) ctx.layout.selectPanel(id)
        }
        ctx.effect(() => ctx.layout.panelInfo.subscribe(() => {
          const id = active()
          if (id === last) return
          const previous = last
          last = id
          if (id === null && previous !== null && !registered(previous)) {
            // dsh shows the Conversation while a selected panel is unregistered (its plugin is
            // reloading or was disabled); select the panel again when it comes back.
            pending = previous
            return
          }
          pending = null
          if (id === null) localStorage.removeItem(key)
          else localStorage.setItem(key, id)
        }))
        ctx.effect(() => ctx.slots.subscribe('main', restore))
        restore()
      },
    }

    /**
     * Replace UI text, in every language. dsh's locale service has no override and refuses a
     * second dictionary for a namespace, so this wraps its lookup. Namespaces and keys are those
     * the packages register (`ctx.locale.register(ns, { zh, en })` in their lib/client.js).
     */
    const uiText = {
      name: 'ui-text',
      inject: ['locale'],
      apply(ctx) {
        const texts = {
          'settings.account': {
            // Account label at the bottom left of the sidebar, shown when the DeepSeek profile has
            // no name ("已登录 DeepSeek"). Settings → 账号与余额 shows it in that case too.
            signedIn: 'tu10ng的dsh',
          },
        }
        const locale = ctx.locale
        ctx.effect(() => {
          const own = Object.hasOwn(locale, 'translate')
          const previous = locale.translate
          locale.translate = function (ns, key, params) {
            if (!Object.hasOwn(texts, ns) || !Object.hasOwn(texts[ns], key)) return previous.call(this, ns, key, params)
            const text = texts[ns][key]
            return params ? text.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match) : text
          }
          // A dictionary registration republishes the locale, so text already on screen re-renders.
          const republish = () => locale.register('dshrc.ui-text', 'en', {})()
          republish()
          return () => {
            if (own) locale.translate = previous
            else delete locale.translate
            republish()
          }
        })
      },
    }

    /** Browser snippets, in mount order. */
    const snippets = [
      rememberPanel,
      uiText,
      // exampleCss,
    ]

    /**
     * Wrap a snippet so a failing `apply` is reported under its name, then rethrown.
     * @param {object} snippet - Cordis plugin object
     * @returns {object} the plugin to mount
     */
    const contain = (snippet) => ({
      name: snippet.name,
      inject: snippet.inject,
      apply(ctx, config) {
        const fail = (error) => {
          console.error('[dshrc]', `浏览器片段 ${snippet.name} 加载失败:`, error)
          throw error
        }
        try {
          const result = snippet.apply(ctx, config)
          return typeof result?.then === 'function' ? result.then(undefined, fail) : result
        } catch (error) {
          return fail(error)
        }
      },
    })

    return {
      apply(ctx) {
        for (const snippet of snippets) ctx.plugin(contain(snippet))
        console.log('[dshrc]', `已挂载 ${snippets.length} 个浏览器片段`)
      },
    }
  },
})
