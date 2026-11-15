/**
 * 生成补档计划：把源帖拆成「按顺序要发的东西」。
 *
 * 结构是两层，跟原帖一致：
 *   父楼层  → 发成主楼层，占楼层号
 *   楼中楼  → 发成该父楼层下的楼中楼，不占楼层号
 *
 * 每条都带角标【N 楼 · 昵称 · 时间】，读的人能对上原帖。
 */

/** 补档时不能真的 @ 出去：半角 @ 换全角 ＠，视觉几乎一致，贴吧不会解析成提及段 */
export function neutralizeMentions(text) {
  return String(text || '').replace(/@(?=[^\s@:：])/g, '＠')
}

/**
 * @param {object} thread fetchThread 的结果
 * @param {{sourceUrl?:string, sourceForum?:string}} opts
 * @returns {{parent: Array, all: Array}}
 */
export function buildPlan(thread, opts = {}) {
  const parent = []
  const all = []
  const first = thread.floors[0]
  const sourceUrl = opts.sourceUrl || `https://tieba.baidu.com/p/${thread.tid}`
  const sourceForum = opts.sourceForum || ''

  // 主楼：来源声明 + 原 1 楼内容
  const head = [
    `【补档】${thread.title}`,
    '',
    `原文出自${sourceForum ? `「${sourceForum}」吧` : '贴吧'}，楼主 ${first?.author || '匿名'}，原帖发于 ${first?.timeText || ''}`,
    `原帖：${sourceUrl}`,
    '',
    '按原楼层顺序补档，每条回复注明原作者与时间，正文未作改动。',
    '',
    '—'.repeat(12),
    '',
    first?.text ? neutralizeMentions(first.text) : '',
  ].filter(Boolean).join('\n')

  parent.push({ kind: 'head', title: `【补档】${thread.title}`, text: head })

  for (const f of thread.floors) {
    if (f.floor === 1) continue
    const tag = `【${f.floor} 楼 · ${f.author} · ${f.timeText}】`
    const body = neutralizeMentions(f.text)
    const item = {
      key: `F${f.floor}`,
      kind: 'floor',
      floor: f.floor,
      tag,
      text: body ? `${tag}\n${body}` : `${tag}\n（原帖为纯图片）`,
      images: f.images || [],
      subs: [],
    }

    for (let i = 0; i < f.subs.length; i++) {
      const s = f.subs[i]
      const subTag = `【${f.floor} 楼楼中楼 ${i + 1} · ${s.author} · ${s.timeText}】`
      const subBody = neutralizeMentions(s.text)
      const subItem = {
        key: `F${f.floor}S${i + 1}`,
        kind: 'sub',
        floor: f.floor,
        parentKey: item.key,
        tag: subTag,
        text: subBody ? `${subTag}\n${subBody}` : `${subTag}\n（原帖为纯图片）`,
        images: s.images || [],
      }
      item.subs.push(subItem)
      all.push(subItem)
    }
    parent.push(item)
    all.push(item)
  }

  // all 按「楼层 → 该层楼中楼」顺序排，保证父楼层先于它的子回复
  all.sort((a, b) => {
    if (a.floor !== b.floor) return a.floor - b.floor
    if (a.kind === b.kind) return 0
    return a.kind === 'floor' ? -1 : 1
  })

  return { parent, all }
}