/**
 * 贴吧 App 接口封装。
 *
 * 读接口 /c/f/pb/page 返回结构化 JSON（楼层 + content 段 + 图片签名 URL），
 * 楼层正文里 content 是分段数组：
 *   { type: 0, text }                普通文字
 *   { type: 2, text, c }             表情（text 为 image_emoticonN，c 为中文名）
 *   { type: 3, big_cdn_src, ... }    图片
 *   { type: 4, text: "@某人", uid }   已解析成提及的 @
 *
 * 签名规则：参数按 key 升序拼成 k=v 连写，末尾接盐 "tiebaclient!!!"，MD5。
 */
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'

const APP_HOST = 'https://tiebac.baidu.com'
const APP_UA = 'bdtb for Android 12.60.1.0'
const APP_VER = '12.60.1.0'
const SIGN_SALT = 'tiebaclient!!!'

/** 计算 sign：key 升序 → "k1=v1k2=v2..." → 追加盐 → md5 */
export function sign(params) {
  const raw = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('')
  return crypto.createHash('md5').update(raw).update(SIGN_SALT).digest('hex')
}

function curlForm(url, form) {
  return new Promise((resolve, reject) => {
    const args = [
      '-s', '--max-time', '30',
      '-A', APP_UA,
      '-H', 'Content-Type: application/x-www-form-urlencoded',
    ]
    for (const [k, v] of Object.entries(form)) args.push('--data-urlencode', `${k}=${v}`)
    args.push(url)
    const p = spawn('curl', args)
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err += d })
    p.on('error', reject)
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`curl exit ${code}: ${err}`))
      try {
        resolve(JSON.parse(out))
      } catch {
        reject(new Error(`接口返回不是 JSON: ${out.slice(0, 200)}`))
      }
    })
  })
}

/** 限速器：接口调用之间至少间隔 ms，避免触发风控 */
function throttle(ms) {
  let last = 0
  return async () => {
    const wait = ms - (Date.now() - last)
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    last = Date.now()
  }
}
const gate = throttle(1200)

/**
 * 调 App 接口。params 里的 BDUSS 由调用方传入。
 * 会自动补 _client_version、加 sign、走限速。
 */
export async function appPost(pathname, params) {
  const full = { ...params, _client_version: APP_VER }
  full.sign = sign(full)
  await gate()
  const res = await curlForm(APP_HOST + pathname, full)
  if (res.error_code !== 0) {
    const e = new Error(`接口错误 ${res.error_code}: ${res.error_msg || ''}`)
    e.code = res.error_code
    e.raw = res
    throw e
  }
  return res
}

/** 帖子一页（每页 30 楼，pn 从 1 开始） */
export async function fetchPage({ bduss, tid, pn = 1, rn = 30 }) {
  return appPost('/c/f/pb/page', {
    BDUSS: bduss,
    kz: tid,
    pn,
    rn,
    is_default: 1,
    sort: 0,
  })
}

/**
 * 抓整帖所有楼层（自动翻页）。
 * 返回 { title, replyNum, posts: [{ floor, pid, time, author, content[], subPostNumber }] }
 */
export async function fetchAllFloors({ bduss, tid, maxPages = 10 }) {
  const posts = []
  let title = ''
  let replyNum = 0
  for (let pn = 1; pn <= maxPages; pn++) {
    const r = await fetchPage({ bduss, tid, pn })
    if (pn === 1) {
      title = r.thread?.title || ''
      replyNum = r.thread?.reply_num || 0
    }
    const list = r.post_list || []
    if (!list.length) break
    for (const p of list) {
      posts.push({
        floor: p.floor,
        pid: String(p.id),
        time: p.time,
        author: p.author?.name_show || p.author?.name || '匿名',
        authorId: p.author?.id,
        subPostNumber: p.sub_post_number || 0,
        content: p.content || [],
      })
    }
    if (list.length < 30) break
  }
  return { title, replyNum, posts }
}

/** 某一层的楼中楼（pn 从 1 开始） */
export async function fetchSubPosts({ bduss, tid, pid, pn = 1, rn = 30 }) {
  const r = await appPost('/c/f/pb/floor', { BDUSS: bduss, kz: tid, pid, pn, rn })
  return (r.subpost_list || []).map((s) => ({
    id: String(s.id),
    time: s.time,
    // 楼中楼的昵称在 author.name_show，跟老接口的 user 字段不是一回事
    author: s.author?.name_show || s.author?.name || s.nick || s.user || '匿名',
    content: s.content || (s.text ? [{ type: 0, text: s.text }] : []),
    images: s.images || [],
  }))
}

/** content 段数组 → 纯文本（表情还原成 [中文名]） */
export function contentToText(content) {
  return (content || [])
    .map((c) => {
      if (c.type === 2) return c.c ? `[${c.c}]` : ''
      if (c.type === 3) return ''
      return c.text || ''
    })
    .join('')
    .trim()
}

/** content 段数组 → 图片 URL 列表（必须用 big_cdn_src，带签名） */
export function contentImages(content) {
  return (content || [])
    .filter((c) => c.type === 3)
    .map((c) => c.big_cdn_src || c.cdn_src)
    .filter(Boolean)
}

/** 时间戳秒 → "YYYY-MM-DD HH:MM:SS" */
export function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(Number(ts) * 1000)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}