/**
 * 图片下载。URL 必须取自接口的 big_cdn_src（含 ?tbpicau= 签名），
 * 自行拼接文件名只能取到防盗链占位图。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

function curlTo(url, outPath, referer) {
  return new Promise((resolve, reject) => {
    const args = ['-s', '-o', outPath, '--max-time', '60', '-A', UA]
    if (referer) args.push('-e', referer)
    args.push(url)
    const p = spawn('curl', args)
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`curl exit ${code}`))))
  })
}

export function collectImageUrls(thread) {
  const out = []
  const push = (urls, floor, kind, idx) => {
    for (const u of urls || []) {
      if (!u) continue
      out.push({ url: u, floor, kind, idx })
    }
  }
  for (const f of thread.floors || []) {
    push(f.images, f.floor, 'floor', 0)
    ;(f.subs || []).forEach((s, i) => push(s.images, f.floor, 'sub', i + 1))
  }
  return out
}

export async function downloadThreadImages(thread, outDir, { referer } = {}) {
  fs.mkdirSync(outDir, { recursive: true })
  const list = collectImageUrls(thread)
  const results = []
  let n = 0
  for (const item of list) {
    n++
    const ext = (item.url.match(/\.(jpe?g|png|gif|webp)/i) || [, 'jpg'])[1].toLowerCase()
    const name = item.kind === 'floor'
      ? `f${item.floor}.${ext}`
      : `f${item.floor}-sub${item.idx}.${ext}`
    const file = path.join(outDir, name)
    try {
      await curlTo(item.url, file, referer)
      const bytes = fs.existsSync(file) ? fs.statSync(file).size : 0
      results.push({ url: item.url, file, bytes, ok: bytes > 5000 })
    } catch (e) {
      results.push({ url: item.url, file, bytes: 0, ok: false, error: String(e.message || e) })
    }
  }
  return results
}

// 多张图 MD5 相同说明取到的是占位图，签名 URL 已过期
export function detectPlaceholders(files) {
  const seen = new Map()
  const dup = []
  for (const f of files) {
    if (!f.ok) continue
    const h = crypto.createHash('md5').update(fs.readFileSync(f.file)).digest('hex')
    if (seen.has(h)) dup.push({ file: f.file, sameAs: seen.get(h) })
    else seen.set(h, f.file)
  }
  return { placeholders: dup, suspected: dup.length > 0 }
}