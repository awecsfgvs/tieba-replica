# 选择器参考

## 主帖

| 用途 | 选择器 |
|---|---|
| 发帖按钮 | `.add-btn.button-wrapper` |
| 标题输入 | `#tb-editor-title` 或 `input[placeholder*="标题"]` |
| 正文编辑 | `.ql-editor`（取最后一个） |
| 提交 | `.issue-btn` |

发帖按钮需要真实鼠标事件（`Input.dispatchMouseEvent`），DOM `.click()` 无效。

```js
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 })
const box = await cdp.eval(`(()=>{
  const b=document.querySelector('.add-btn.button-wrapper')
  b.scrollIntoView({block:'center'}); const r=b.getBoundingClientRect()
  return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)}
})()`)
for (const type of ['mousePressed', 'mouseReleased']) {
  await cdp.send('Input.dispatchMouseEvent', { type, ...box, button: 'left', clickCount: 1 })
}
```

## 楼层

| 用途 | 选择器 |
|---|---|
| 页面 | `https://tieba.baidu.com/mo/q/m?kz=<tid>` |
| 编辑框 | `textarea.j_editor_content` |
| 提交 | `innerText` 为「发布」或「发表」且 `width > 0` 的元素 |
| 文件输入 | `input[type=file]#pic.upload-input` |

```js
ta.focus()
ta.value = text
ta.dispatchEvent(new Event('input', { bubbles: true }))
ta.dispatchEvent(new Event('change', { bubbles: true }))

b.scrollIntoView({ block: 'center' })
b.click()
```

按钮的 x 坐标可能超出视口，必须先 `scrollIntoView`。

提交后出现的「验证码」组件不影响发送结果。

## 楼中楼

| 用途 | 选择器 |
|---|---|
| 楼层容器 | `.virtual-list-item[data-key="<pid>"]` |
| 回复入口 | 容器内 `innerText` 为「回复」的元素 |
| 编辑框 | `.ql-editor`（弹出后全局唯一） |
| 提交 | `.publish-btn` |

`data-key` 即父楼层 `pid`。

```js
const item = document.querySelector('.virtual-list-item[data-key="<pid>"]')
const btn = [...item.querySelectorAll('span,a,div')]
  .find(e => (e.innerText || '').trim() === '回复' && e.getBoundingClientRect().width > 0)
btn.scrollIntoView({ block: 'center' })
btn.click()

ed.focus()
document.execCommand('insertText', false, text)
```

楼中楼提交按钮是 `.publish-btn`，与主帖的 `.issue-btn` 不同。

## 图片

```js
const obj = await cdp.send('Runtime.evaluate', {
  expression: `document.querySelector('input[type=file]#pic')`,
})
await cdp.send('DOM.setFileInputFiles', {
  files: [absPath],
  objectId: obj.result.result.objectId,
})
await sleep(6000)
```

上传过程页面无任何视觉变化。

## 填字

两个编辑器都监听 `input` 事件。`textarea` 用原生 setter 赋值后派发事件，`.ql-editor` 用 `document.execCommand('insertText')`。

CDP 的 `Input.insertText` 为插入语义，无法替换框内已有内容，不适用于这两个编辑器。