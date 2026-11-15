/**
 * 抓帖，输出结构化 JSON 与 Markdown。
 * 文本清洗：表情代码还原为 [中文名]，去掉楼中楼自带的回复前缀。
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

export function normalizeEmoji(text) {
  return String(text || '')
    .replace(/image_emoticon(\d+)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

export function stripReplyPrefix(text) {
  return String(text || '').replace(/^回复\s+\S+\s*[:：]\s*/, '').trim()
}

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