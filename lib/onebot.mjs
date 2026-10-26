// OneBot 11 HTTP 客户端：只为两件「QQ 桥做不到」的事存在
//   ① 群消息反查发送者 QQ 号（桥转进来只有 kind:'qq'，正文前缀不可信）
//   ② 发群消息时带 at 段（桥只发纯文字）
// ⚠ 全部调用都要显式配置 onebot.baseUrl 才会发生；默认不联网。未实测。

const DEFAULTS = { baseUrl: 'http://127.0.0.1:3000', token: '', timeoutMs: 4000 }

export function normalizeBase(baseUrl) {
  const s = String(baseUrl || '').trim() || DEFAULTS.baseUrl
  return s.replace(/\/+$/, '')
}

async function call(opts, action, params) {
  const o = Object.assign({}, DEFAULTS, opts || {})
  const base = normalizeBase(o.baseUrl)
  const ctl = typeof AbortController === 'function' ? new AbortController() : null
  const timer = ctl ? setTimeout(() => ctl.abort(), Number(o.timeoutMs) || DEFAULTS.timeoutMs) : null
  try {
    const res = await fetch(base + '/' + action, {
      method: 'POST',
      headers: Object.assign(
        { 'content-type': 'application/json' },
        o.token ? { authorization: 'Bearer ' + o.token } : {},
      ),
      body: JSON.stringify(params || {}),
      signal: ctl ? ctl.signal : undefined,
    })
    const data = await res.json()
    return { ok: !!data && (data.status === 'ok' || data.retcode === 0), data }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export const getLoginInfo = (o) => call(o, 'get_login_info', {})
export const getGroupMsgHistory = (o, groupId, count) =>
  call(o, 'get_group_msg_history', { group_id: Number(groupId), count: Number(count) || 20 })

/** 发群消息，segments 用 OneBot 数组格式（能带 at）。 */
export const sendGroupMsg = (o, groupId, segments) =>
  call(o, 'send_group_msg', { group_id: Number(groupId), message: segments })

const stripPrefix = (s) => String(s || '').replace(/^[^：:]{1,40}[：:]\s*/, '').trim()
const norm = (s) => String(s || '').replace(/\s+/g, '').slice(0, 120)

/**
 * 用「正文」在最近的群消息里反查发送者。
 * 返回 { ok:true, qq } | { ok:false, reason }
 * 刻意保守：找不到、找到多条不同的发送者 → 都不认（对齐「认不出谁都不当主人」）。
 */
export async function resolveSender(opts, groupId, text, count) {
  const r = await getGroupMsgHistory(opts, groupId, count || 20)
  if (!r.ok) return { ok: false, reason: '取群历史失败：' + (r.error || (r.data && r.data.wording) || '?') }
  const list = (r.data && r.data.data && r.data.data.messages) || []
  const want = norm(stripPrefix(text))
  if (!want) return { ok: false, reason: '正文为空' }
  const hits = []
  for (const m of list) {
    const raw = norm(stripPrefix(m && (m.raw_message || m.message)))
    if (!raw) continue
    if (raw === want || raw.endsWith(want) || want.endsWith(raw)) {
      const sender = m.sender && (m.sender.user_id || m.user_id)
      if (sender) hits.push(String(sender))
    }
  }
  const uniq = [...new Set(hits)]
  if (uniq.length === 1) return { ok: true, qq: uniq[0] }
  if (!uniq.length) return { ok: false, reason: '最近消息里没匹配到同一条正文' }
  return { ok: false, reason: '匹配到多个不同发送者：' + uniq.slice(0, 5).join(',') }
}

/** 群里说话时只 @ 主人的消息段（沿用 core 的 ownerOnlyAt 语义）。 */
export function groupAtSegments(text, qq) {
  const body = String(text == null ? '' : text)
  const id = String(qq == null ? '' : qq).trim()
  return id ? [{ type: 'at', data: { qq: id } }, { type: 'text', data: { text: ' ' + body } }] : [{ type: 'text', data: { text: body } }]
}
