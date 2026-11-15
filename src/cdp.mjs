/**
 * 极简 CDP 客户端，依赖 Node 内置 WebSocket（Node 22+）。
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export class Cdp {
  constructor(ws) {
    this._ws = ws
    this._seq = 0
    this._waiters = new Map()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this._waiters.has(msg.id)) {
        this._waiters.get(msg.id)(msg)
        this._waiters.delete(msg.id)
      }
    })
  }

  send(method, params = {}) {
    return new Promise((resolve) => {
      const id = ++this._seq
      this._waiters.set(id, resolve)
      this._ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (r.error || r.result?.exceptionDetails) return null
    return r.result?.result?.value
  }

  // 跳转只用 Page.navigate；location.href= 会销毁执行上下文，后续 evaluate 会挂住
  async goto(url, { timeout = 20000, ready } = {}) {
    await this.send('Page.navigate', { url })
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      await sleep(700)
      if (ready) {
        if (await this.eval(ready)) return true
      } else {
        const state = await this.eval('document.readyState')
        if (state === 'complete') return true
      }
    }
    return false
  }

  async waitFor(expression, { timeout = 20000, interval = 600 } = {}) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await this.eval(expression)) return true
      await sleep(interval)
    }
    return false
  }

  async screenshot(savePath) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' })
    const b64 = r.result?.data
    if (!b64) return null
    const fs = await import('node:fs')
    fs.writeFileSync(savePath, Buffer.from(b64, 'base64'))
    return savePath
  }

  close() {
    this._ws.close()
  }
}

export async function connect(port = 9350, { match = /baidu\.com/ } = {}) {
  const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
  const page = list.find((t) => t.type === 'page' && match.test(t.url)) || list.find((t) => t.type === 'page')
  if (!page) throw new Error(`端口 ${port} 上没有可用的 page target`)
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  return new Cdp(ws)
}

export { sleep }