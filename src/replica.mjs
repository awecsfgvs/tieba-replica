/**
 * 执行补档。父楼层先发，取得 pid 后写入楼中楼。
 * 每完成一条写一次进度文件，重跑时跳过已完成项。
 * 发送结果以接口回查为准。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fetchAllFloors, contentToText } from './api.mjs'
import { replyFloor, replyNested, replyWithImage } from './publish.mjs'
import { sleep } from './cdp.mjs'

export function loadProgress(file) {
  if (!fs.existsSync(file)) return { done: [] }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return { done: [] }
  }
}

export function saveProgress(file, prog) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(prog, null, 2), 'utf8')
}

// 回读目标帖，按角标对账
export async function readPostedTags({ bduss, tid }) {
  const { posts } = await fetchAllFloors({ bduss, tid })
  const tags = new Set()
  for (const p of posts) {
    const text = contentToText(p.content)
    const m = text.match(/【(\d+) 楼(?:楼中楼 (\d+))? ·/)
    if (m) tags.add(m[2] ? `F${m[1]}S${m[2]}` : `F${m[1]}`)
    if (p.subPostNumber > 0) tags.add(`F${p.floor}#hasSubs`)
  }
  return tags
}

export async function runReplica(cdp, opts) {
  const { bduss, newTid, plan, progressFile, gapSec = 20, log = () => {} } = opts
  const prog = loadProgress(progressFile)
  const done = new Set(prog.done || [])
  let sent = 0
  let skipped = 0
  const failed = []

  const pidByKey = { ...(prog.pidByKey || {}) }

  for (const item of plan.all) {
    if (done.has(item.key)) {
      skipped++
      continue
    }

    const started = Date.now()
    let result

    if (item.kind === 'floor') {
      result = await replyFloor(cdp, { tid: newTid, text: item.text })
      if (item.images?.length) {
        await sleep(1500)
        const imgLocal = opts.imageMap?.[`F${item.floor}`]
        if (imgLocal) {
          const r2 = await replyWithImage(cdp, {
            tid: newTid,
            text: `【${item.floor} 楼 · ${item.tag.match(/·\s*(.+?)\s*·/)?.[1] || ''}】原帖配图`,
            imagePath: imgLocal,
          })
          if (!r2.ok) log(`⚠ F${item.floor} 配图失败: ${r2.error}`)
        }
      }
    } else {
      const parentPid = pidByKey[item.parentKey]
      if (!parentPid) {
        failed.push({ key: item.key, error: '父楼层的 pid 还没拿到' })
        log(`⚠ ${item.key} 跳过：缺父楼层 pid`)
        continue
      }
      result = await replyNested(cdp, { tid: newTid, pid: parentPid, text: item.text })
    }

    if (result.ok) {
      done.add(item.key)
      sent++
      log(`✅ ${item.key}`)
    } else {
      failed.push({ key: item.key, error: result.error })
      log(`⚠ ${item.key} ${result.error}`)
    }

    prog.done = [...done]
    prog.pidByKey = pidByKey
    saveProgress(progressFile, prog)

    const elapsed = Date.now() - started
    const wait = gapSec * 1000 - elapsed
    if (wait > 0) await sleep(wait)
  }

  return { sent, skipped, failed, pidByKey }
}

// 回读目标帖，建立 楼层 key → pid 映射
export async function mapFloorPids({ bduss, tid }) {
  const { posts } = await fetchAllFloors({ bduss, tid })
  const map = {}
  for (const p of posts) {
    const text = contentToText(p.content)
    const m = text.match(/【(\d+) 楼 ·/)
    if (m) map[`F${m[1]}`] = p.pid
  }
  return map
}