# 三条发布通道速查

## 主帖（PC 版）

```js
// 1. 打开发布器：必须真实鼠标事件，DOM .click() 不触发
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 })
const box = await cdp.eval(`(()=>{
  const b=document.querySelector('.add-btn.button-wrapper')
  b.scrollIntoView({block:'center'}); const r=b.getBoundingClientRect()
  return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)}
})()`)
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...box, button:'left', clickCount:1 })
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...box, button:'left', clickCount:1 })

// 2. 标题 #tb-editor-title，正文是最后一个 .ql-editor
// 3. 提交 .issue-btn（不是底部的 .operate-btn.publish，那个被遮罩挡着点不到）
```

## 楼层（移动版）

```js
// 页面：https://tieba.baidu.com/mo/q/m?kz=<tid>
ta.focus()
ta.value = text
ta.dispatchEvent(new Event('input', { bubbles: true }))
ta.dispatchEvent(new Event('change', { bubbles: true }))

// 提交按钮文案是「发布」，但它的 x 坐标可能到 2400+（视口外）
b.scrollIntoView({ block: 'center' })
b.click()
```

提交后会出现一个 `验证码:` 组件 —— **那是装饰性的，回复照样发出去了**，别被它骗了去重试。

## 楼中楼（PC 版）

```js
// 楼层容器 = .virtual-list-item[data-key="<pid>"]，data-key 就是 pid
const item = document.querySelector('.virtual-list-item[data-key="<pid>"]')
const btn = [...item.querySelectorAll('span,a,div')]
  .find(e => (e.innerText || '').trim() === '回复' && e.getBoundingClientRect().width > 0)
btn.scrollIntoView({ block: 'center' })
btn.click()

// 弹出来的是独立 .ql-editor
ed.focus()
document.execCommand('insertText', false, text)

// 提交 .publish-btn（不是主帖的 .issue-btn）
document.querySelectorAll('.publish-btn')[last].click()
```

## 发图（移动版）

```js
// 常驻 input[type=file]#pic.upload-input accept="image/*"
const obj = await cdp.send('Runtime.evaluate', { expression: `document.querySelector('input[type=file]#pic')` })
await cdp.send('DOM.setFileInputFiles', { files: [abs], objectId: obj.result.result.objectId })
await sleep(6000)
// 页面无任何反馈，imgs=0 是正常的
```
