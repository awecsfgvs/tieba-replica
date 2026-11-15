/**
 * 极简 CDP 客户端，只依赖 Node 内置 WebSocket（Node 22+）。
 *
 * 用法：
 *   const cdp = await connect(9350)          // 连到已开的 Edge/Chrome 调试端口
 *   await cdp.goto(url)                      // 导航并等待
 *   await cdp.eval('document.title')         // 在页面里求值
 *   cdp.close()
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

  /** 页面内求值。出错返回 null，不抛，方便轮询。 */
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (r.error || r.result?.exceptionDetails) return null
    return r.result?.result?.value
  }

  /**
   * 导航。
   *
   * 注意：不要在页面里用 location.href= 或 location.reload() 跳转 ——
   * 那会销毁执行上下文，后续 Runtime.evaluate 会挂住。只能用 Page.navigate。
   */
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

  /** 等某个条件成立，返回是否等到 */
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

/**
 * 连到本机已在跑的浏览器调试端口。
 * 启动示例（Windows）：
 *   Start-Process msedge.exe -ArgumentList '--remote-debugging-port=9350','--user-data-dir=<profile>'
 */
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