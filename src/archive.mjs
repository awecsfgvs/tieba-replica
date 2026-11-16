#!/usr/bin/env node
/**
 * 把帖子完整存档到本地。
 *
 *   node src/archive.mjs <tid> [...] --out <目录>
 */
import fs from 'node:fs'
import path from 'node:path'
import { fetchThread, saveThread } from './fetch.mjs'
import { downloadThreadImages } from './images.mjs'

function defaultBduss() {
  if (process.env.TIEBA_BDUSS) return process.env.TIEBA_BDUSS.trim()
  const f = process.env.TIEBA_BDUSS_FILE || './out/bduss.txt'
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim()
  throw new Error('缺少 BDUSS：设置 TIEBA_BDUSS 或 TIEBA_BDUSS_FILE')
}

/**
 * 存档一个帖子。
 * @param {{bduss:string, tid:string, root:string, log?:Function}} opts
 */
export async function archiveOne({ bduss, tid, root, log = console.log }) {
  const dir = path.join(root, tid)
  fs.mkdirSync(dir, { recursive: true })

  log(`[${tid}] 抓取中…`)
  const thread = await fetchThread({ bduss, tid })
  saveThread(thread, dir)

  const jsonSrc = path.join(dir, `${tid}.json`)
  const mdSrc = path.join(dir, `${tid}.md`)
  if (fs.existsSync(jsonSrc)) fs.renameSync(jsonSrc, path.join(dir, 'thread.json'))
  if (fs.existsSync(mdSrc)) fs.renameSync(mdSrc, path.join(dir, 'thread.md'))

  log(`[${tid}] 楼层 ${thread.totalFloors} / 楼中楼 ${thread.totalSubs} / 图片 ${thread.totalImages}`)

  let images = []
  if (thread.totalImages > 0) {
    log(`[${tid}] 下载图片…`)
    images = await downloadThreadImages(thread, path.join(dir, 'img'), {
      referer: `https://tieba.baidu.com/p/${tid}`,
    })
    log(`[${tid}] 图片 ${images.filter((r) => r.ok).length}/${images.length}`)
  }

  const meta = {
    tid,
    title: thread.title,
    url: `https://tieba.baidu.com/p/${tid}`,
    archivedAt: new Date().toISOString(),
    floors: thread.totalFloors,
    subPosts: thread.totalSubs,
    images: thread.totalImages,
    imagesDownloaded: images.filter((r) => r.ok).length,
    files: { json: 'thread.json', markdown: 'thread.md', images: 'img/' },
  }
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')
  return meta
}

/**
 * 批量存档，并在根目录写索引。
 * @param {{bduss:string, tids:string[], outRoot:string, log?:Function}} opts
 */
export async function archiveThreads({ bduss, tids, outRoot, log = console.log }) {
  fs.mkdirSync(outRoot, { recursive: true })
  const metas = []

  for (const tid of tids) {
    try {
      metas.push(await archiveOne({ bduss, tid, root: outRoot, log }))
    } catch (e) {
      log(`[${tid}] 失败: ${e.message}`)
    }
  }

  // 扫描整个目录，索引累积历史存档
  const all = []
  for (const name of fs.readdirSync(outRoot)) {
    const metaFile = path.join(outRoot, name, 'meta.json')
    if (!fs.existsSync(metaFile)) continue
    try {
      all.push(JSON.parse(fs.readFileSync(metaFile, 'utf8')))
    } catch {}
  }
  all.sort((a, b) => String(b.archivedAt).localeCompare(String(a.archivedAt)))

  const out = []
  out.push('# 贴吧存档', '')
  out.push(`共 ${all.length} 个帖子，更新于 ${new Date().toLocaleString('zh-CN')}`, '')
  out.push('| tid | 标题 | 楼层 | 楼中楼 | 图片 | 存档时间 |')
  out.push('|---|---|---|---|---|---|')
  for (const m of all) {
    const d = String(m.archivedAt || '').slice(0, 10)
    out.push(`| [${m.tid}](./${m.tid}/thread.md) | ${m.title} | ${m.floors} | ${m.subPosts} | ${m.imagesDownloaded}/${m.images} | ${d} |`)
  }
  out.push('')
  fs.writeFileSync(path.join(outRoot, 'index.md'), out.join('\n'), 'utf8')

  return metas
}

const isDirectRun = process.argv[1] && /archive\.mjs$/.test(process.argv[1])
if (isDirectRun) {
  const argv = process.argv.slice(2)
  const tids = []
  let outRoot = ''
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') outRoot = argv[++i]
    else if (!argv[i].startsWith('--')) tids.push(argv[i])
  }
  if (!tids.length || !outRoot) {
    console.error('用法: archive.mjs <tid> [...] --out <目录>')
    process.exit(1)
  }
  archiveThreads({ bduss: defaultBduss(), tids, outRoot })
    .then((metas) => {
      console.log(`\n完成 ${metas.length} 个帖子 → ${outRoot}`)
      for (const m of metas) console.log(`  ${m.tid}  ${m.floors} 楼 / ${m.subPosts} 楼中楼 / ${m.imagesDownloaded} 图`)
    })
    .catch((e) => {
      console.error('错误:', e.message)
      process.exit(1)
    })
}