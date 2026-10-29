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

    /** Browser snippets, in mount order. */
    const snippets = [
      rememberPanel,
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
