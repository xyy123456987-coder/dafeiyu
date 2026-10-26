// dsh-feiyu-owner · 宿主无关的纯逻辑
//
// 这里放的全是**不碰 ctx、不读文件、不发网络**的函数，所以能在 node 里直接
// `node --test` / 冒烟脚本跑，验收表里的 A1 / C1 / C2 / C3 / D1 都能先在这一层过一遍。
// 宿主侧（lib/index.js）只负责：把 DSH 的真实事件喂进来、把这里算出来的东西塞回 DSH。

import { join } from 'node:path'

// ---------------------------------------------------------------- 存储路径

export const DEFAULT_DATA_DIR = 'E:/AI_Workspace/Data/feiyu-owner/'

/** 只认 E 盘。`E:/x`、`E:\x`、`e:/x` 都算；相对路径、其他盘、UNC 都不算。 */
export function isOnEDrive(p) {
  const s = String(p == null ? '' : p).trim()
  return /^e:[\\/]/i.test(s)
}

/**
 * 决定这次到底往哪儿写。
 * 设计 §2 的硬规矩：不在 E 盘就**拒绝写入**，不去读 DSH_HOME 兜底。
 * 返回 { ok, dir, reason }；ok=false 时调用方只许记日志、不许落盘。
 */
export function resolveDataDir(configured) {
  const raw = String(configured == null ? '' : configured).trim() || DEFAULT_DATA_DIR
  if (!isOnEDrive(raw)) return { ok: false, dir: null, reason: '数据目录不在 E 盘，拒绝写入：' + raw }
  return { ok: true, dir: raw.replace(/[\\/]+$/, ''), reason: '' }
}

export function pathsFor(dir) {
  return {
    config: join(dir, 'config.json'),
    profile: join(dir, 'profile.json'),
    log: join(dir, 'log.jsonl'),
    backupDir: join(dir, 'backup'),
    digest: (day) => join(dir, 'digests', String(day) + '.json'),
  }
}

/** `2026-10-25` 这种本地日期键（按本机时区，不写死北京）。 */
export function dayKey(ts) {
  const d = new Date(ts == null ? Date.now() : ts)
  const off = -d.getTimezoneOffset() * 60000
  return new Date(d.getTime() + off).toISOString().slice(0, 10)
}

/** 前一天 00:00–24:00 的区间，给「每天整理一遍昨天的记录」用。 */
export function previousDayRange(nowTs) {
  const now = new Date(nowTs == null ? Date.now() : nowTs)
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return { from: startOfToday - 86400000, to: startOfToday, day: dayKey(startOfToday - 86400000) }
}

// ---------------------------------------------------------------- 主人是谁

/**
 * 一条消息的来源判定。返回 'owner' | 'other' | 'unknown'。
 *
 * 设计 §4.1 / 验收 C3 的红线：**认不出来就当谁都不是主人**，绝不按昵称、头像、
 * 群里有没有自称来猜。
 *   kind='dsh' → 只看会话 id 在不在主人会话名单里
 *   kind='qq'  → 只看发送者 QQ 号在不在主人名单里；没有发送者号 → unknown
 */
export function whoIs(meta, cfg) {
  const m = meta || {}
  const c = cfg || {}
  const ownerSessions = new Set((c.ownerSessions || []).map(String).filter(Boolean))
  const ownerQq = new Set((c.ownerQq || []).map((x) => String(x).trim()).filter(Boolean))

  if (m.kind === 'dsh') {
    const sid = String(m.sessionId == null ? '' : m.sessionId)
    if (sid && ownerSessions.has(sid)) return 'owner'
    return 'unknown'
  }
  if (m.kind === 'qq') {
    const qq = String(m.senderId == null ? '' : m.senderId).trim()
    if (!qq) return 'unknown' // 桥没带发送者号 → 不猜
    return ownerQq.has(qq) ? 'owner' : 'other'
  }
  return 'unknown'
}

/** 这一轮里主人那条排最前，其他人保持原顺序（验收 C1）。 */
export function prioritize(messages, cfg) {
  const rank = { owner: 0, other: 1, unknown: 2 }
  return (messages || [])
    .map((m, i) => ({ ...m, who: whoIs(m, cfg), _i: i }))
    .sort((a, b) => rank[a.who] - rank[b.who] || a._i - b._i)
    .map(({ _i, ...rest }) => rest)
}

// ---------------------------------------------------------------- 群里只 @ 主人

/** OneBot 11 的 at 段。 */
export function atSegment(qq) {
  return { type: 'at', data: { qq: String(qq) } }
}

export function countAtSegments(segments) {
  return (segments || []).filter((s) => s && s.type === 'at').length
}

/**
 * 主动在群里开口时的消息段：**只有一个 @，对象是主人**（验收 D1）。
 * 主人号拿不到就干脆不 @（宁可不 @，也不 @ 错人）。
 */
export function ownerOnlyAt(text, qq) {
  const body = String(text == null ? '' : text)
  const id = String(qq == null ? '' : qq).trim()
  if (!id) return [{ type: 'text', data: { text: body } }]
  return [atSegment(id), { type: 'text', data: { text: ' ' + body } }]
}

// ---------------------------------------------------------------- 安装后的首次向导

// 弹窗与对话兜底共用的判定，全部纯函数 —— 测试里不用起 DSH 就能验。
//
// 为什么要这层（2026-10-26 使用者原话）：
//   「安装完自动弹窗问我……但是我安装的时候你没有弹窗问我」
//   ⇒ 装好之后不能等使用者自己发现，得**界面先开口**；界面没开/不好使的时候，
//     再由对话补一句（两条路读同一份状态，不会两边都问、也不会都不问）。

export const ONBOARD_VERSION = 2

/** 新的安装标识：每次「第一次装」生成一次，用来让前端只对这一次安装弹一次。 */
export function newInstallId() {
  return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

const firstOwner = (cfg) => String(((cfg || {}).ownerQq || []).filter(Boolean)[0] || '')

/**
 * 要不要在界面里弹「我是不是被装了一个主人插件」。
 * 已经绑定 / 已经点过「先不用」→ 不弹；其余（含老版本升级上来、没弹过的）都弹。
 */
export function shouldAskOnboard(cfg) {
  const c = cfg || {}
  if (firstOwner(c)) return false
  if (c.onboardDismissedAt) return false
  return true
}

/**
 * 对话兜底：界面那条路没走成时才问，而且只问一次。
 *   · 群会话里不问（验收表里那条硬规矩）
 *   · 已经绑定 / 弹窗已经露过脸 / 点过「先不用」→ 都不问
 *   · 「问过一次」只算**这一次安装**里的：老版本留下的 onboardedAskedAt 比 installedAt 早，
 *     升级上来仍然允许再问一次（否则弹窗没起来 + 旧标记 = 两条路都哑了）
 */
export function shouldAskInChat(cfg, mode) {
  const c = cfg || {}
  if (mode === 'group') return false
  if (firstOwner(c)) return false
  if (c.onboardSeenAt) return false
  if (c.onboardDismissedAt) return false
  if (c.onboardedAskedAt) {
    const askedAt = Date.parse(c.onboardedAskedAt) || 0
    const installedAt = Date.parse(c.installedAt) || 0
    if (!installedAt || askedAt >= installedAt) return false
  }
  return true
}

/** 填进来的 QQ 只许一个、4~15 位数字。返回 { ok, qq, message }。 */
export function parseOwnerQq(input) {
  const list = (Array.isArray(input) ? input : String(input == null ? '' : input).split(/[,，;；\s]+/))
    .map((x) => String(x).trim())
    .filter(Boolean)
  if (!list.length) return { ok: false, qq: '', message: '还没填 QQ 号。' }
  if (list.length > 1) return { ok: false, qq: '', message: '只能锁一个主人，你给了 ' + list.length + ' 个。' }
  const qq = list[0]
  if (!/^\d{4,15}$/.test(qq)) return { ok: false, qq: '', message: '「' + qq + '」不像 QQ 号（应为 4~15 位数字）。' }
  return { ok: true, qq, message: '' }
}

// ---------------------------------------------------------------- 专属档案

export const ENTRY_KINDS = ['喜好', '近况', '约定', '称呼', '雷区']
export const SCOPES = ['private', 'public']

/** `主人.饮食` 这种事实键：去空白、全角点统一、小写；不带值。 */
export function normalizeKey(k) {
  let s = String(k == null ? '' : k).trim()
  if (!s) return ''
  s = s.replace(/[．。｡]/g, '.').replace(/[：:]/g, '.').replace(/[｜|]/g, '.')
  s = s.replace(/\s+/g, '').toLowerCase()
  s = s.replace(/^[`'"「『[(（]+/, '').replace(/[`'"」』\])）]+$/, '')
  return s.slice(0, 24)
}

export function emptyProfile() {
  return { version: 1, items: [], blockedKeys: [] }
}

/**
 * 把每日提炼出来的候选并进档案（设计 §4.2）：
 *   · 同一个 key 只留最新，旧的标 supersededBy（不删，可回看）
 *   · 用户删过的 key 记在 blockedKeys 里 → **不再复活**（验收 B3）
 *   · pinned 的条目不被自动覆盖（她手钉的东西优先于自动化）
 */
export function mergeProfile(profile, candidates, nowIso) {
  const p = profile && Array.isArray(profile.items) ? profile : emptyProfile()
  const at = nowIso || new Date().toISOString()
  const blocked = new Set(p.blockedKeys || [])
  const items = p.items.map((x) => ({ ...x }))
  const added = []
  const superseded = []

  for (const raw of candidates || []) {
    const text = String((raw && raw.text) || '').trim()
    if (!text) continue
    const key = normalizeKey(raw.key)
    if (key && blocked.has(key)) continue // 删过的不复活
    const kind = ENTRY_KINDS.includes(raw.kind) ? raw.kind : '近况'
    const scope = SCOPES.includes(raw.scope) ? raw.scope : 'private'
    const source = Array.isArray(raw.source) ? raw.source.slice(0, 8) : []

    const sameKey = key ? items.filter((x) => normalizeKey(x.key) === key && !x.supersededBy) : []
    const dupText = items.find((x) => !x.supersededBy && String(x.text || '').trim() === text)
    if (dupText) continue
    const pinnedHit = sameKey.find((x) => x.pinned)
    if (pinnedHit) continue // 她钉住的，自动化别覆盖

    const entry = {
      id: 'e' + Date.parse(at).toString(36) + Math.floor(Math.random() * 1000),
      key,
      text,
      kind,
      scope,
      source,
      createdAt: at,
      updatedAt: at,
      pinned: false,
      disabled: false,
      supersededBy: null,
    }
    for (const old of sameKey) {
      old.supersededBy = entry.id
      old.updatedAt = at
      superseded.push(old.id)
    }
    items.push(entry)
    added.push(entry.id)
  }
  return { profile: { ...p, items }, added, superseded }
}

/** 设置页删一条：从档案里摘掉，并把它的 key 拉黑，免得下次整理又冒出来。 */
export function blockEntry(profile, id) {
  const p = profile && Array.isArray(profile.items) ? profile : emptyProfile()
  const target = p.items.find((x) => String(x.id) === String(id))
  const blocked = new Set(p.blockedKeys || [])
  if (target) {
    const key = normalizeKey(target.key)
    if (key) blocked.add(key)
  }
  return {
    profile: {
      ...p,
      items: p.items.filter((x) => String(x.id) !== String(id)),
      blockedKeys: [...blocked],
    },
    removed: !!target,
  }
}

// ---------------------------------------------------------------- 注入

const STOP = new Set(['的', '了', '我', '你', '他', '她', '是', '在', '就', '和', '吧', '吗', '啊', '这', '那', '有', '不'])

/** 很土但够用的中文二元切分，只用来给档案条目打个相关度，不是检索系统。 */
export function grams(s) {
  const t = String(s == null ? '' : s).toLowerCase().replace(/[^\p{Script=Han}a-z0-9]+/gu, ' ')
  const out = new Set()
  for (const run of t.split(/\s+/).filter(Boolean)) {
    const chars = [...run]
    if (chars.length === 1) out.add(run)
    for (let i = 0; i + 1 < chars.length; i++) {
      const g = chars[i] + chars[i + 1]
      if (!STOP.has(g)) out.add(g)
    }
  }
  return out
}

/**
 * 每轮挑几条塞进上下文（设计 §4.3）：
 *   · 群聊轮次（group=true）只给 scope:'public'，私聊来源的一条都不进群上下文（验收 C2）
 *   · 不超过 maxItems / maxChars
 *   · 钉住的优先，其余按跟当前话题的重合度排
 */
export function pickForInjection(profile, opts) {
  const o = opts || {}
  const maxItems = Number(o.maxItems) > 0 ? Math.floor(o.maxItems) : 6
  const maxChars = Number(o.maxChars) > 0 ? Math.floor(o.maxChars) : 600
  const q = grams(o.query || '')
  const pool = ((profile && profile.items) || []).filter(
    (x) => x && !x.disabled && !x.supersededBy && (o.group ? x.scope === 'public' : true),
  )
  const scored = pool.map((x, i) => {
    const g = grams(x.text)
    let hit = 0
    for (const k of q) if (g.has(k)) hit++
    return { x, i, score: (x.pinned ? 100 : 0) + hit }
  })
  scored.sort((a, b) => b.score - a.score || a.i - b.i)

  const picked = []
  let used = 0
  for (const row of scored) {
    const n = String(row.x.text || '').length
    if (picked.length >= maxItems) break
    if (picked.length > 0 && used + n > maxChars) continue
    picked.push(row.x)
    used += n
  }
  return picked
}

/** 把挑出来的条目拼成给模型看的一段话。空档案返回 ''（别塞空标题占上下文）。 */
export function renderInjection(items, opts) {
  const o = opts || {}
  const list = items || []
  if (!list.length) return ''
  const call = String(o.ownerName || '主人').trim() || '主人'
  const lines = list.map((x) => '- ' + String(x.text || '').trim())
  return [
    '【' + call + '专属档案】',
    '下面是' + call + '亲口说过、你们之间定下的事（主人是' + call + '，其他人不是）：',
    ...lines,
    '用法：' + call + '说话时优先照着这些回应，称呼、语气按' + call + '的喜好来；',
    '群里主人和别人同时问你时，先回主人，再回别人，别人也照常回应、不冷落。',
    '别人的事不要往' + call + '身上套；别人问起私聊内容就打岔，不要复述。',
  ].join('\n')
}
