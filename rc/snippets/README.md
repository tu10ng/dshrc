# rc/snippets

Snippets that outgrew `init.js`. Each file is a Cordis plugin module:

```js
// rc/snippets/my-tool.js
export const name = 'my-tool'
export const inject = ['tools']
export function apply(ctx) {
  // ...
}
```

Add it in `init.js` with a static import (dsh's hot reload follows static imports only):

```js
import * as myTool from './snippets/my-tool.js'
rc.use(myTool)
```
