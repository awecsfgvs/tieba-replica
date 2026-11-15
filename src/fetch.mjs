/**
 * 抓帖：把源帖抓成结构化 JSON（楼层 + 楼中楼 + 图片 URL + 清洗后的文本）。
 *
 * 清洗规则（不洗会出乱码 / 重复前缀）：
 *   ① image_emoticonN 换成 [中文名]，直接发原文会显示成字母串
 *   ② 去掉楼中楼自带的「回复 某人 :」前缀，否则搬过去变「回复 回复 某人 :」
 *   ③ 图片只留 big_cdn_src（带 tbpicau 签名），硬拼文件名只能拿到防盗链占位图
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  fetchAllFloors,
  fetchSubPosts,
  contentToText,
  contentImages,
  fmtTime,
} from './api.mjs'

/** 表情代码 → 中文名。接口给的是 image_emoticon9，正文里要写成 [泪] 这类。 */
export function normalizeEmoji(text) {
  // 接口 content 里 type:2 已经带中文名，这里兜底处理漏网的裸代码
  return String(text || '')
    .replace(/image_emoticon(\d+)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/** 去掉「回复 197******05 :」这种系统前缀 */
export function stripReplyPrefix(text) {
  return String(text || '').replace(/^回复\s+\S+\s*[:：]\s*/, '').trim()
}

/**
 * 抓一个帖子。
 * @param {{bduss:string, tid:string, fetchSubs?:boolean}} opts
 * @returns {Promise<object>} 结构化结果，可直接落盘成 JSON
 */
export async function fetchThread({ bduss, tid, fetchSubs = true }) {
  const { title, replyNum, posts } = await fetchAllFloors({ bduss, tid })

  const floors = []
  for (const p of posts) {
    const text = normalizeEmoji(contentToText(p.content))
    const images = contentImages(p.content)
    const item = {
      floor: p.floor,
      pid: p.pid,
      author: p.author,
      time: p.time,
      timeText: fmtTime(p.time),
      text,
      images,
      subs: [],
    }

    if (fetchSubs && p.subPostNumber > 0) {
      for (let pn = 1; pn <= Math.ceil(p.subPostNumber / 30); pn++) {
        const subs = await fetchSubPosts({ bduss, tid, pid: p.pid, pn })
        for (const s of subs) {
          item.subs.push({
            id: s.id,
            author: s.author,
            time: s.time,
            timeText: fmtTime(s.time),
            text: stripReplyPrefix(normalizeEmoji(contentToText(s.content))),
            images: contentImages(s.content),
          })
        }
        if (subs.length < 30) break
      }
    }
    floors.push(item)
  }

  return {
    tid,
    title,
    replyNum,
    fetchedAt: new Date().toISOString(),
    totalFloors: floors.length,
    totalSubs: floors.reduce((n, f) => n + f.subs.length, 0),
    totalImages: floors.reduce((n, f) => n + f.images.length + f.subs.reduce((m, s) => m + s.images.length, 0), 0),
    floors,
  }
}

/** 落盘：JSON + 可读 Markdown */
export function saveThread(thread, outDir) {
  fs.mkdirSync(outDir, { recursive: true })
  const base = path.join(outDir, String(thread.tid))
  fs.writeFileSync(`${base}.json`, JSON.stringify(thread, null, 2), 'utf8')

  const lines = [
    `# ${thread.title}`,
    '',
    `- tid: ${thread.tid}`,
    `- 楼层: ${thread.totalFloors}`,
    `- 楼中楼: ${thread.totalSubs}`,
    `- 图片: ${thread.totalImages}`,
    '',
  ]
  for (const f of thread.floors) {
    lines.push(`## ${f.floor} 楼 · ${f.author} · ${f.timeText}`)
    lines.push('')
    if (f.text) lines.push(f.text)
    for (const img of f.images) lines.push(`![](${img})`)
    if (f.subs.length) {
      lines.push('')
      for (let i = 0; i < f.subs.length; i++) {
        const s = f.subs[i]
        lines.push(`> **楼中楼 ${i + 1} · ${s.author} · ${s.timeText}**`)
        if (s.text) lines.push(`> ${s.text}`)
        for (const img of s.images) lines.push(`> ![](${img})`)
        lines.push('')
      }
    }
    lines.push('---', '')
  }
  fs.writeFileSync(`${base}.md`, lines.join('\n'), 'utf8')
  return { json: `${base}.json`, md: `${base}.md` }
}