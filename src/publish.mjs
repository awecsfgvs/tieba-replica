/**
 * 发布通道：主帖、楼层、楼中楼、带图。
 *
 * 主帖   PC 版 .add-btn → .ql-editor ×2 → .issue-btn
 * 楼层   移动版 mo/q/m → textarea.j_editor_content（仅主楼层）
 * 楼中楼 PC 版 .virtual-list-item[data-key=<pid>] → span.reply → .ql-editor → .publish-btn
 */
import fs from 'node:fs'
import path from 'node:path'
import { sleep } from './cdp.mjs'

const MOBILE = (tid) => `https://tieba.baidu.com/mo/q/m?kz=${tid}`
const PC = (tid) => `https://tieba.baidu.com/p/${tid}`

// 主帖

/** forum 传吧名，不含「吧」字 */
export async function publishThread(cdp, { forum, title, body }) {
  const url = `https://tieba.baidu.com/f?kw=${encodeURIComponent(forum)}`
  await cdp.goto(url, { timeout: 25000 })
  await cdp.waitFor(`document.querySelector('.add-btn, .button-wrapper') !== null`, { timeout: 15000 })

  // 发布器只响应真实鼠标事件
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 })
  const box = await cdp.eval(`(()=>{
    const b=document.querySelector('.add-btn.button-wrapper')||document.querySelector('.button-wrapper')
    if(!b) return null
    b.scrollIntoView({block:'center'}); const r=b.getBoundingClientRect()
    return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)}
  })()`)
  if (!box) return { ok: false, error: '找不到发帖按钮 .add-btn' }
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 })
  }
  await sleep(1500)

  const ready = await cdp.waitFor(`document.querySelectorAll('.ql-editor').length >= 2`, { timeout: 10000 })
  if (!ready) return { ok: false, error: '发布器没打开（.ql-editor 不足 2 个）' }

  const titleJs = JSON.stringify(title)
  const bodyJs = JSON.stringify(body)
  const filled = await cdp.eval(`(()=>{
    const t=document.querySelector('#tb-editor-title, input[placeholder*="标题"]')
    const eds=[...document.querySelectorAll('.ql-editor')]
    const ed=eds[eds.length-1]
    if(!t||!ed) return 'missing'
    t.focus(); t.value=${titleJs}
    t.dispatchEvent(new Event('input',{bubbles:true}))
    t.dispatchEvent(new Event('change',{bubbles:true}))
    ed.focus()
    document.execCommand('insertText', false, ${bodyJs})
    return 'title='+(t.value||'').length+' body='+(ed.innerText||'').length
  })()`)
  if (!String(filled).startsWith('title=')) return { ok: false, error: `填字失败: ${filled}` }
  await sleep(800)

  const published = await cdp.eval(`(()=>{
    const b=[...document.querySelectorAll('.issue-btn')].filter(e=>e.getBoundingClientRect().width>0)
    if(!b.length) return 'no-btn'
    b[0].scrollIntoView({block:'center'}); b[0].click()
    return 'clicked:'+b.length
  })()`)
  if (!String(published).startsWith('clicked')) return { ok: false, error: `提交按钮异常: ${published}` }

  const tid = await cdp.waitFor(`(()=>{const m=location.href.match(/\\/p\\/(\\d+)/); return m?m[1]:null})()`, { timeout: 20000 })
  const got = await cdp.eval(`(()=>{const m=location.href.match(/\\/p\\/(\\d+)/); return m?m[1]:''})()`)
  return got ? { ok: true, tid: got, url: `https://tieba.baidu.com/p/${got}` } : { ok: false, error: '提交后没拿到 tid' }
}

// 楼层

/** 发主楼层，占楼层号 */
export async function replyFloor(cdp, { tid, text }) {
  await cdp.goto(MOBILE(tid), {
    timeout: 25000,
    ready: `document.querySelector('textarea.j_editor_content, textarea') !== null`,
  })
  await sleep(700)

  const filled = await cdp.eval(`(()=>{
    const ta=[...document.querySelectorAll('textarea')].find(e=>String(e.className).includes('j_editor_content'))||document.querySelector('textarea')
    if(!ta) return 'no-textarea'
    ta.focus(); ta.value=${JSON.stringify(text)}
    ta.dispatchEvent(new Event('input',{bubbles:true}))
    ta.dispatchEvent(new Event('change',{bubbles:true}))
    return 'len='+ta.value.length
  })()`)
  if (filled !== `len=${text.length}`) return { ok: false, error: `填字校验失败: ${filled}` }

  const clicked = await cdp.eval(`(()=>{
    const b=[...document.querySelectorAll('.j_submit_btn,a,button')].filter(e=>{
      const r=e.getBoundingClientRect()
      return /^(发布|发表)$/.test((e.innerText||'').trim()) && r.width>0
    })
    if(!b.length) return 'no-btn'
    // 按钮可能在视口外，需先 scrollIntoView
    b[0].scrollIntoView({block:'center'}); b[0].click()
    return 'clicked:'+b.length
  })()`)
  if (!String(clicked).startsWith('clicked')) return { ok: false, error: `提交失败: ${clicked}` }
  return { ok: true }
}

// 楼中楼

/** pid 为父楼层 id；页面「回复」按钮有多个，须按 data-key 定位父楼层 */
export async function replyNested(cdp, { tid, pid, text }) {
  await cdp.goto(PC(tid), {
    timeout: 25000,
    ready: `document.querySelector('.virtual-list-item[data-key="${pid}"]') !== null`,
  })
  await sleep(800)

  const opened = await cdp.eval(`(()=>{
    const item=document.querySelector('.virtual-list-item[data-key="${pid}"]')
    if(!item) return 'no-item'
    const btn=[...item.querySelectorAll('span,a,div')].find(e=>{
      const t=(e.innerText||'').trim()
      return t==='回复' && e.getBoundingClientRect().width>0
    })
    if(!btn) return 'no-reply-btn'
    btn.scrollIntoView({block:'center'}); btn.click()
    return 'ok'
  })()`)
  if (opened !== 'ok') return { ok: false, error: `打不开回复框: ${opened}` }

  const editorShown = await cdp.waitFor(`document.querySelector('.ql-editor') !== null`, { timeout: 8000 })
  if (!editorShown) return { ok: false, error: '楼中楼编辑器没出现（.ql-editor 缺失）' }
  await sleep(600)

  const filled = await cdp.eval(`(()=>{
    const ed=document.querySelector('.ql-editor')
    if(!ed) return 'no-editor'
    ed.focus()
    document.execCommand('insertText', false, ${JSON.stringify(text)})
    return 'len='+(ed.innerText||'').length
  })()`)
  if (!String(filled).startsWith('len=')) return { ok: false, error: `填字失败: ${filled}` }
  await sleep(500)

  const clicked = await cdp.eval(`(()=>{
    const b=[...document.querySelectorAll('.publish-btn')].filter(e=>e.getBoundingClientRect().width>0)
    if(!b.length) return 'no-publish-btn'
    b[b.length-1].scrollIntoView({block:'center'}); b[b.length-1].click()
    return 'clicked:'+b.length
  })()`)
  if (!String(clicked).startsWith('clicked')) return { ok: false, error: `提交失败: ${clicked}` }
  return { ok: true }
}

// 图片

/** 移动版页面常驻 input[type=file]#pic，上传过程无视觉反馈 */
export async function replyWithImage(cdp, { tid, text, imagePath }) {
  const abs = path.resolve(imagePath)
  if (!fs.existsSync(abs)) return { ok: false, error: `图片不存在: ${abs}` }

  await cdp.goto(MOBILE(tid), {
    timeout: 25000,
    ready: `document.querySelector('input[type=file]') !== null`,
  })
  await sleep(700)

  const obj = await cdp.send('Runtime.evaluate', {
    expression: `document.querySelector('input[type=file]#pic') || document.querySelector('input[type=file]')`,
  })
  const objectId = obj.result?.result?.objectId
  if (!objectId) return { ok: false, error: '找不到 input[type=file]' }

  const set = await cdp.send('DOM.setFileInputFiles', { files: [abs], objectId })
  if (set.error) return { ok: false, error: `setFileInputFiles 失败: ${JSON.stringify(set.error)}` }
  await sleep(6000)

  const r = await replyFloor(cdp, { tid, text })
  return r
}