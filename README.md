# tieba-replica

把贴吧一个帖子按原样搬到另一个帖子：楼层还是楼层，楼中楼还是挂在楼层下面的楼中楼，图片一起搬。

不是截图、不是导出、不是长图 —— 是**在目标帖里重新发一遍**，结构跟原帖一致。

```
原帖                          副本
2 楼  A                      2 楼  A（带【2 楼 · A · 时间】角标）
 ├ 楼中楼1  B                 ├ 楼中楼1  B
 └ 楼中楼2  C                 └ 楼中楼2  C
3 楼  D                      3 楼  D
```

---

## 为什么难

贴吧有**三条完全不同的发布通道**，长得像但不是一回事：

| 目标 | 入口 | 编辑器 | 提交按钮 |
|---|---|---|---|
| 主帖 | PC 版吧页 `.add-btn` | `.ql-editor` ×2（标题+正文） | `.issue-btn` |
| 楼层 | 移动版 `mo/q/m?kz=` | `textarea.j_editor_content` | 文本为「发布」的元素 |
| 楼中楼 | PC 版楼层内 `span.reply` | 独立 `.ql-editor` | `.publish-btn` |

用移动版那个 `textarea` 只能发**主楼层**，所以偷懒的结果就是所有楼中楼全被拉平成主楼层。要复刻原结构，楼中楼必须走 PC 版那条 `span.reply → .ql-editor → .publish-btn`。

---

## 装

```bash
git clone https://github.com/<you>/tieba-replica
cd tieba-replica
node --version   # 需要 22+（用了内置 WebSocket）
```

无依赖，不装包。

准备两样东西：

**1. BDUSS**（读接口用）

```bash
export TIEBA_BDUSS='你的BDUSS'
# 或者写进 out/bduss.txt（已在 .gitignore 里）
```

**2. 一个带调试端口的浏览器**（发帖用）

```powershell
# Windows
Start-Process msedge.exe -ArgumentList '--remote-debugging-port=9350','--user-data-dir=C:\edge-tieba'
```

```bash
# macOS / Linux
google-chrome --remote-debugging-port=9350 --user-data-dir=/tmp/chrome-tieba
```

然后在那个窗口里**手动登录一次贴吧**，登录态会留在 `user-data-dir` 里，以后不用再登。

---

## 用

```bash
# 1. 抓原帖（楼层 + 楼中楼 + 图片 URL）
node src/cli.mjs fetch 11192856383

# 2. 生成补档计划
node src/cli.mjs plan 11192856383 --forum 华北水利水电大学

# 3. 下载原帖图片
node src/cli.mjs images 11192856383
#    ⚠ 如果输出「检测到内容完全相同的文件」，说明拿到的是防盗链占位图，
#      签名 URL 过期了，重新跑一次 fetch 再 images

# 4. 发主帖，拿到新 tid
node src/cli.mjs post --forum 华北水利水电大学 \
  --title '【补档】原帖标题' --body-file out/head.txt

# 5. 灌内容（断点续传，中断了重跑同一条命令即可）
node src/cli.mjs run --tid <新帖tid> --source 11192856383 --gap 20
```

`--gap 20` 是每条之间间隔 20 秒。跑太快会触发风控，别调太低。

进度存在 `out/progress-<新帖tid>.json`，发成功一条写一次，重跑自动跳过。

单独发一条也是可以的：

```bash
node src/cli.mjs reply <tid> --text '内容'
node src/cli.mjs nested <tid> --pid <楼层pid> --text '内容'
```

`pid` 是父楼层的 `id`，`fetch` 出来的 JSON 里每层都有。

---

## 六个踩过的坑

这些是这套东西能跑起来之前真正卡住的地方，留着给后来人。

### 1. 判定成功只能靠接口，不能靠 DOM

移动版 `mo/q/m?kz=` **只渲染第一页**（约 30 楼）。第 31 楼之后的回复在 `document.body.innerText` 里根本不存在。

靠 DOM 判断 → 所有超过 30 楼的都记成失败 → 重复发送。

正确做法是发完回查 App 接口 `/c/f/pb/page`：

```js
const { posts } = await fetchAllFloors({ bduss, tid })
const tags = new Set()
for (const p of posts) {
  const m = contentToText(p.content).match(/【(\d+) 楼(?:楼中楼 (\d+))? ·/)
  if (m) tags.add(m[2] ? `F${m[1]}S${m[2]}` : `F${m[1]}`)
}
```

### 2. `rn` 最大 30，传 100 也只给 30

```js
// 想要全帖必须翻页
for (let pn = 1; pn <= 10; pn++) {
  const r = await fetchPage({ bduss, tid, pn })   // 每次最多 30 条
  if ((r.post_list || []).length < 30) break
}
```

### 3. 图片必须用带签名的 URL

接口返回的 `big_cdn_src` 长这样：

```
https://tiebapic.baidu.com/forum/w%3D960%3Bq%3D100/sign=xxxx/xxx.jpg?tbpicau=2026-11-25-05_yyyy
```

带 `?tbpicau=` 这个签名参数。拿文件名硬拼 `/forum/pic/item/<name>.jpg`，四个不同 URL 会返回**四个字节完全相同的 4262 字节、238×238 占位图**。加 BDUSS、加 Referer 都没用。

自检办法很简单：下载完算 MD5，几个文件一样就是中招了。

### 4. 填字不能用 `Input.insertText`

CDP 的 `Input.insertText` 是**插入**语义，替换不掉框里的残留内容。而且贴吧这两个编辑器（`textarea` 和 `ql-editor`）都监听 `input` 事件。

```js
// 移动版 textarea
ta.focus()
ta.value = text
ta.dispatchEvent(new Event('input', { bubbles: true }))
ta.dispatchEvent(new Event('change', { bubbles: true }))

// PC 版 ql-editor
ed.focus()
document.execCommand('insertText', false, text)
```

### 5. 发图完全没有视觉反馈

移动版回帖页常驻一个 `input[type=file]#pic`，用 `DOM.setFileInputFiles` 塞文件进去就行：

```js
const obj = await cdp.send('Runtime.evaluate', {
  expression: `document.querySelector('input[type=file]#pic')`,
})
await cdp.send('DOM.setFileInputFiles', { files: [absPath], objectId: obj.result.result.objectId })
await sleep(6000)   // 等后台上传
```

**但塞完之后页面上什么都看不到**：`img[src^="blob:"]` 数量是 0，没有缩略图，没有进度条。看起来完全像失败。

实际是成功的。唯一可靠的判定是发完回查接口 `content` 里有没有 `type: 3` 段。

### 6. 不要在页面里用 `location.href=` 跳转

会销毁执行上下文，之后所有 `Runtime.evaluate` 都挂住，只能重连。

一律用 `Page.navigate`，然后 sleep 轮询。

---

## 内容段结构

接口返回的 `content` 是分段数组，一个楼层可能混着好几种：

```js
[
  { type: 0, text: '普通文字' },                    // 文字
  { type: 2, text: 'image_emoticon9', c: '泪' },    // 表情，c 是中文名
  { type: 3, big_cdn_src: 'https://...' },          // 图片
  { type: 4, text: '@某人', uid: 123456 },          // 已解析成真提及的 @
]
```

`type: 2` 直接发原文会出现 `image_emoticon9` 这种字母串，要换成 `[泪]`。

搬运时如果不想真的 @ 到人，把半角 `@` 换成全角 `＠`（U+FF20）—— 贴吧的解析器只认半角，全角就是普通字符：

```js
export function neutralizeMentions(text) {
  return String(text || '').replace(/@(?=[^\s@:：])/g, '＠')
}
```

---

## 项目结构

```
src/
  api.mjs      App 接口封装：sign 算法、翻页、楼中楼、content 解析
  cdp.mjs      极简 CDP 客户端，只依赖 Node 内置 WebSocket
  fetch.mjs    抓帖 → 结构化 JSON + 可读 Markdown
  plan.mjs     生成补档计划（父楼层 / 楼中楼分开，文本清洗）
  images.mjs   图片下载 + 占位图自检
  publish.mjs  三条发布通道：主帖 / 楼层 / 楼中楼 / 带图
  replica.mjs  执行补档：断点续传 + 接口回查对账
  cli.mjs      命令行入口
```

---

## 注意

- 只跑自己的号，别拿去批量搬运别人的内容。
- 间隔别低于 20 秒。贴吧的风控按小时算发帖量，跑太快直接封号。
- 楼中楼不占楼层号，但主楼层有限制 —— 一个号一天发不了几十个新主题。
- 删掉发错的内容很麻烦：移动版「操作」菜单点不动，PC 版 DOM 里也没有删除元素。发之前想清楚。

## License

MIT