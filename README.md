# tieba-replica

把贴吧一个帖子按原结构复制到另一个帖子。

```
原帖                          副本
2 楼  A                      2 楼  A【2 楼 · A · 时间】
 ├ 楼中楼1  B                 ├ 楼中楼1  B
 └ 楼中楼2  C                 └ 楼中楼2  C
3 楼  D                      3 楼  D
```

楼层发成楼层，楼中楼挂在父楼层下，图片一起搬。

## 安装

```bash
git clone https://github.com/awecsfgvs/tieba-replica
cd tieba-replica
```

Node 22+，无依赖。

需要准备：

**BDUSS**（读接口）

```bash
export TIEBA_BDUSS='你的BDUSS'
```

或写进 `out/bduss.txt`。

**带调试端口的浏览器**（发帖）

```powershell
Start-Process msedge.exe -ArgumentList '--remote-debugging-port=9350','--user-data-dir=C:\edge-tieba'
```

```bash
google-chrome --remote-debugging-port=9350 --user-data-dir=/tmp/chrome-tieba
```

在该窗口登录一次贴吧，登录态保存在 `user-data-dir`。

## 命令

### fetch — 抓帖

```bash
node src/cli.mjs fetch <tid>
```

输出 `out/<tid>.json` 和 `out/<tid>.md`。

### plan — 生成计划

```bash
node src/cli.mjs plan <tid> --forum <吧名>
```

输出 `out/<tid>.plan.json`。每条带 `key`、`kind`（`floor` / `sub`）、`parentKey`、`text`、`images`。

### images — 下载图片

```bash
node src/cli.mjs images <tid>
```

输出到 `out/img/`，文件名 `f<楼层>.jpg`。

### post — 发主帖

```bash
node src/cli.mjs post --forum <吧名> --title '<标题>' --body-file out/head.txt
```

成功输出新帖 URL。

### run — 灌内容

```bash
node src/cli.mjs run --tid <新帖tid> --source <源帖tid> --gap 20
```

按计划顺序发完。父楼层先发，拿到 pid 后往里面塞楼中楼。

`--gap` 为每条间隔秒数，默认 20。

进度写在 `out/progress-<新帖tid>.json`，中断后重跑同一条命令会跳过已完成项。

### reply / nested — 单条发送

```bash
node src/cli.mjs reply <tid> --text '内容'
node src/cli.mjs nested <tid> --pid <父楼层pid> --text '内容'
```

### archive — 完整存档

```bash
node src/cli.mjs archive <tid> [<tid> ...] --out <目录>
```

每个帖子产出：

```
<目录>/<tid>/thread.json   楼层 + 楼中楼 + 图片 URL
<目录>/<tid>/thread.md     可读全文
<目录>/<tid>/img/          图片原图
<目录>/<tid>/meta.json     来源、抓取时间、统计
```

同时在 `<目录>/index.md` 生成索引。

## 数据

### 楼层字段

```json
{
  "floor": 2,
  "pid": "154140595448",
  "author": "贴吧用户_JUeZVU2",
  "time": 1794547877,
  "timeText": "2026-11-13 13:27:16",
  "text": "正文",
  "images": ["https://tiebapic.baidu.com/..."],
  "subs": []
}
```

`pid` 用于发楼中楼，指向父楼层。

### content 段

接口返回的 `content` 是分段数组：

```js
{ type: 0, text: '文字' }
{ type: 2, text: 'image_emoticon9', c: '泪' }   // 表情，c 是中文名
{ type: 3, big_cdn_src: 'https://...' }         // 图片
{ type: 4, text: '@某人', uid: 123456 }          // 已解析的提及
```

`type: 3` 是判断图片是否存在的唯一依据。

### 文本处理

- 表情还原为 `[泪]`，否则显示表情代码
- 楼中楼去掉自带的 `回复 某人 :` 前缀
- 半角 `@` 转全角 `＠`，不触发真实提及

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `TIEBA_BDUSS` | — | 读接口凭证 |
| `TIEBA_BDUSS_FILE` | `out/bduss.txt` | 凭证文件路径 |
| `TIEBA_CDP_PORT` | `9350` | 浏览器调试端口 |
| `TIEBA_OUT_DIR` | `./out` | 输出目录 |

## 注意

- 间隔不低于 20 秒，贴吧按小时计发帖量
- 图片 URL 带签名参数，过期后需重新 `fetch`
- 已发出的帖子无法删除，移动版与 PC 版都没有可用入口

## License

MIT