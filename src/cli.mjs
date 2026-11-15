#!/usr/bin/env node
/**
 * 命令行入口。
 *
 *   fetch <tid>                                   抓帖
 *   plan <tid> --forum <吧名>                      生成计划
 *   images <tid>                                  下载图片
 *   post --forum <吧名> --title <标题> --body-file <文件>
 *   reply <tid> --text <内容>
 *   nested <tid> --pid <pid> --text <内容>
 *   run --tid <新帖tid> --source <源帖tid> [--gap 20]
 *   archive <tid> [...] --out <目录>               完整存档
 */
import fs from 'node:fs'
import path from 'node:path'
import { fetchThread, saveThread } from './fetch.mjs'
import { buildPlan } from './plan.mjs'
import { downloadThreadImages, detectPlaceholders } from './images.mjs'
import { connect } from './cdp.mjs'
import { publishThread, replyFloor, replyNested } from './publish.mjs'
import { runReplica, mapFloorPids, loadProgress, saveProgress } from './replica.mjs'

const argv = process.argv.slice(2)
const cmd = argv[0]
const flags = {}
const positionals = []
for (let i = 1; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    const k = argv[i].slice(2)
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'
    flags[k] = v
  } else {
    positionals.push(argv[i])
  }
}

const OUT = path.resolve(process.env.TIEBA_OUT_DIR || './out')
const PORT = Number(process.env.TIEBA_CDP_PORT || 9350)

function getBduss() {
  if (process.env.TIEBA_BDUSS) return process.env.TIEBA_BDUSS.trim()
  const candidates = [
    process.env.TIEBA_BDUSS_FILE,
    path.join(OUT, 'bduss.txt'),
    path.join(process.env.HOME || process.env.USERPROFILE || '.', '.config', 'tieba-replica', 'bduss.txt'),
  ].filter(Boolean)
  for (const f of candidates) {
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim()
  }
  throw new Error('没有 BDUSS。设置 TIEBA_BDUSS 环境变量，或把 BDUSS 写进 out/bduss.txt')
}

const log = (...a) => console.log(...a)

async function main() {
  switch (cmd) {
    case 'fetch': {
      const tid = positionals[0] || flags.tid
      if (!tid) throw new Error('用法: fetch <tid>')
      const thread = await fetchThread({ bduss: getBduss(), tid })
      const saved = saveThread(thread, OUT)
      log(`抓取完成: ${thread.totalFloors} 楼 / ${thread.totalSubs} 楼中楼 / ${thread.totalImages} 图`)
      log(`→ ${saved.json}`)
      log(`→ ${saved.md}`)
      break
    }

    case 'plan': {
      const tid = positionals[0] || flags.tid
      const thread = JSON.parse(fs.readFileSync(path.join(OUT, `${tid}.json`), 'utf8'))
      const plan = buildPlan(thread, { sourceForum: flags.forum || '' })
      const file = path.join(OUT, `${tid}.plan.json`)
      fs.writeFileSync(file, JSON.stringify(plan, null, 2), 'utf8')
      log(`计划生成: 父楼层 ${plan.parent.length} 条 / 合计 ${plan.all.length} 条`)
      log(`→ ${file}`)
      break
    }

    case 'images': {
      const tid = positionals[0] || flags.tid
      const thread = JSON.parse(fs.readFileSync(path.join(OUT, `${tid}.json`), 'utf8'))
      const files = await downloadThreadImages(thread, path.join(OUT, 'img'))
      const check = detectPlaceholders(files)
      const ok = files.filter((f) => f.ok).length
      log(`下载完成: ${ok}/${files.length}`)
      if (check.suspected) {
        log('⚠ 检测到内容完全相同的文件，很可能拿到的是防盗链占位图，签名 URL 已过期，重新 fetch')
      }
      break
    }

    case 'post': {
      const cdp = await connect(PORT)
      const body = flags['body-file'] ? fs.readFileSync(flags['body-file'], 'utf8') : flags.body || ''
      const r = await publishThread(cdp, { forum: flags.forum, title: flags.title, body })
      cdp.close()
      log(r.ok ? `发布成功: ${r.url}` : `发布失败: ${r.error}`)
      break
    }

    case 'reply': {
      const tid = positionals[0] || flags.tid
      const cdp = await connect(PORT)
      const r = await replyFloor(cdp, { tid, text: flags.text })
      cdp.close()
      log(r.ok ? '已发送' : `失败: ${r.error}`)
      break
    }

    case 'nested': {
      const tid = positionals[0] || flags.tid
      const cdp = await connect(PORT)
      const r = await replyNested(cdp, { tid, pid: flags.pid, text: flags.text })
      cdp.close()
      log(r.ok ? '已发送' : `失败: ${r.error}`)
      break
    }

    case 'run': {
      const newTid = flags.tid
      const sourceTid = flags.source
      if (!newTid || !sourceTid) throw new Error('用法: run --tid <新帖tid> --source <源帖tid>')
      const bduss = getBduss()
      const thread = JSON.parse(fs.readFileSync(path.join(OUT, `${sourceTid}.json`), 'utf8'))
      const plan = buildPlan(thread, { sourceForum: flags.forum || '' })
      const progressFile = path.join(OUT, `progress-${newTid}.json`)

      const cdp = await connect(PORT)
      const prog = loadProgress(progressFile)
      // 先补已有父楼层的 pid，保证重跑时楼中楼能定位
      prog.pidByKey = { ...(prog.pidByKey || {}), ...(await mapFloorPids({ bduss, tid: newTid })) }
      saveProgress(progressFile, prog)

      const r = await runReplica(cdp, {
        bduss,
        newTid,
        plan,
        progressFile,
        gapSec: Number(flags.gap || 20),
        log,
      })
      cdp.close()
      log(`\n本轮新发 ${r.sent}，跳过 ${r.skipped}，失败 ${r.failed.length}`)
      if (r.failed.length) log('失败明细:', r.failed)
      break
    }

    case 'archive': {
      // 直接调用同目录模块，不额外起进程
      const { archiveThreads } = await import('./archive.mjs')
      const metas = await archiveThreads({
        bduss: getBduss(),
        tids: positionals,
        outRoot: flags.out || path.join(OUT, 'archive'),
        log,
      })
      log(`
完成 ${metas.length} 个帖子`)
      break
    }

    default:
      log(`未知命令: ${cmd}`)
      log('可用: fetch | plan | images | post | reply | nested | run | archive')
      process.exit(1)
  }
}

main().catch((e) => {
  console.error('错误:', e.message)
  process.exit(1)
})