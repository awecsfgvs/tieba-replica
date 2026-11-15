/**
 * 执行补档：按计划往新帖里灌内容。
 *
 * 顺序很关键 —— 父楼层必须先发，拿到 pid 才能往里塞楼中楼。
 *
 * 断点续传：每发成一条就写一次进度文件，重跑时跳过已完成的 key。
 * 判定「发成了」只认接口回查，不认页面 DOM：
 * 移动版 mo/q/m 只渲染第一页（约 30 楼），第 30 楼之后的回复在 body.innerText 里根本不存在,
 * 靠 DOM 判断会把已成功的一律记成失败，然后重复发送。
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

/**
 * 从新帖接口回读已发内容，返回角标集合，用来对账。
 * 只认这项工作真正权威的信号。
 */
export async function readPostedTags({ bduss, tid }) {
  const { posts } = await fetchAllFloors({ bduss, tid })
  const tags = new Set()
  for (const p of posts) {
    const text = contentToText(p.content)
    const m = text.match(/【(\d+) 楼(?:楼中楼 (\d+))? ·/) 
    if (m) tags.add(m[2] ? `F${m[1]}S${m[2]}` : `F${m[1]}`)
    // 楼中楼内容不在 post_list 里，父楼层的 sub_post_number 能反映
    if (p.subPostNumber > 0) tags.add(`F${p.floor}#hasSubs`)
  }
  return tags
}

/**
 * 跑一条补档任务。
 *
 * @param {import('./cdp.mjs').Cdp} cdp
 * @param {object} opts
 * @param {string} opts.bduss
 * @param {string} opts.newTid        目标帖 tid
 * @param {object} opts.plan          buildPlan 的结果
 * @param {string} opts.progressFile  进度文件路径
 * @param {number} [opts.gapSec=20]   每条间隔（秒）
 * @param {(msg:string)=>void} [opts.log]
 * @returns {Promise<{sent:number, skipped:number, failed:Array}>}
 */
export async function runReplica(cdp, opts) {
  const { bduss, newTid, plan, progressFile, gapSec = 20, log = () => {} } = opts
  const prog = loadProgress(progressFile)
  const done = new Set(prog.done || [])
  let sent = 0
  let skipped = 0
  const failed = []

  // 父楼层 key → 它在目标帖里的 pid（发完才有）
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
        // 图片单独一条，文字已经在上面发过了
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
      // 楼中楼：必须挂在父楼层下
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

    // 补齐间隔
    const elapsed = Date.now() - started
    const wait = gapSec * 1000 - elapsed
    if (wait > 0) await sleep(wait)
  }

  return { sent, skipped, failed, pidByKey }
}

/**
 * 发完父楼层后回读接口，把 key → pid 的映射补全。
 * runReplica 里每发一条主楼层后应该调一次，否则楼中楼没有 pid 可用。
 */
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