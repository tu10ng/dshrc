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

    /** Browser snippets, in mount order. */
    const snippets = [
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
