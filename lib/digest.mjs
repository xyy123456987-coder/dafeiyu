// 每日整理：把主人前一天的原话提炼成专属档案。只有这一处调模型（离线跑，不在对话轮里）。
import { previousDayRange } from './core.mjs'
import { mergeProfile } from './core.mjs'
import { cfg, loadProfile, saveProfile, log, readDigest, writeDigest } from './store.mjs'
import { messagesIn, askModel } from './host.mjs'

const DIGEST_SYSTEM =
  '你是专属档案整理助手。用户会给你某人前一天的原话（带「主人：」「我：」标记）。\n' +
  '只提炼关于这个人的长期信息：喜好、近况、约定、他要求怎么称呼、雷区。\n' +
  '输出格式严格每行「类型|事实键|一句话|可见范围」，不要解释：\n' +
  '- 类型只能是：喜好 / 近况 / 约定 / 称呼 / 雷区\n' +
  '- 事实键写「对象.方面」，不许写具体值（主人.饮食 ✓，主人.饮食戒糖 ✗）\n' +
  '- 一句话用「我」指这个人，一条只装一件事\n' +
  '- 可见范围：私聊说过的写 private；他明确说不介意别人知道的写 public\n' +
  '- 实在没内容就只输出「无」\n' +
  '⚠ 他提到别人的事不要记成他的；寒暄、撒娇、一次性的琐事都不记。'

const KINDS = ['喜好', '近况', '约定', '称呼', '雷区']

export function parseDigest(text) {
  const out = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const s = line.trim()
    if (!s || /^无$/.test(s) || /^跳过$/.test(s)) continue
    const parts = s.split(/[|｜]/)
    if (parts.length < 3) continue
    const kind = KINDS.includes(parts[0].trim()) ? parts[0].trim() : '近况'
    const key = parts[1].trim()
    const body = parts[2].trim()
    const scope = parts[3] && /public/i.test(parts[3]) ? 'public' : 'private'
    if (body) out.push({ kind, key, text: body, scope })
  }
  return out
}

/** 跑一次整理。返回 { ok, day, added, superseded } 或 { ok:true, skipped }。 */
export async function runDigest(ctx, agent, opts) {
  const o = opts || {}
  const c = cfg()
  const range = o.range || previousDayRange()
  if (!o.force && readDigest(range.day)) return { ok: true, skipped: 'already-done', day: range.day }

  const sids = (c.ownerSessions || []).map(String).filter(Boolean)
  if (!sids.length) {
    log('整理跳过：没绑主人会话')
    return { ok: true, skipped: 'no-owner-session' }
  }
  const lines = []
  for (const sid of sids) {
    for (const m of await messagesIn(ctx, sid, range.from, range.to)) {
      lines.push((m.who === 'user' ? '主人：' : '我：') + m.text.slice(0, 500))
    }
  }
  if (!lines.length) {
    log('整理跳过：' + range.day + ' 没有主人消息')
    writeDigest(range.day, { day: range.day, at: new Date().toISOString(), skipped: 'no-messages', candidates: [] })
    return { ok: true, skipped: 'no-messages', day: range.day }
  }
  const r = await askModel(ctx, agent, DIGEST_SYSTEM, lines.join('\n').slice(0, 20000), 1500)
  if (!r.ok) {
    log('整理失败：' + r.message)
    return { ok: false, message: r.message }
  }
  const candidates = parseDigest(r.text).map((x) => ({
    ...x,
    source: [{ day: range.day, from: 'dsh', sessionId: sids[0] }],
  }))
  writeDigest(range.day, {
    day: range.day,
    at: new Date().toISOString(),
    model: (r.provider || '?') + '/' + (r.model || '?'),
    raw: r.text,
    candidates,
  })
  const merged = mergeProfile(loadProfile(), candidates)
  saveProfile(merged.profile)
  log('整理完成：' + range.day + ' 新增 ' + merged.added.length + ' 条、作废 ' + merged.superseded.length + ' 条')
  return { ok: true, day: range.day, added: merged.added.length, superseded: merged.superseded.length, candidates: candidates.length }
}
