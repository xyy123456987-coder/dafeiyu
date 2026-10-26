// 主动开口的那句话：不再用配置里的固定文本，让肥鱼按自己的语气现写一句。
// 只用本地档案当素材（不发私人细节给群），写完做长度和格式清洗；失败就退回配置里的兜底句。
import { pickForInjection } from './core.mjs'
import { askModel } from './host.mjs'

const MAX = 60

export function buildSpeakPrompt(profile, opts) {
  const o = opts || {}
  const name = String(o.ownerName || '主人')
  const seeds = pickForInjection(profile, { group: !!o.group, maxItems: 2, maxChars: 160, query: '' })
  const lines = seeds.map((x) => '- ' + String(x.text || '')).join('\n')
  const system =
    '你就是那个陪' + name + '聊天的角色，现在想主动找' + name + '说一句话。\n' +
    '要求：像真人随口发的消息，一两个短句，不超过' + MAX + '字；可以提到你记得的事，但不要复述档案原文、不要罗列。\n' +
    '不要用「主人」这两个字以外的称呼；不要提系统、插件、记忆、模型；不要问「需要我帮你做什么」；不要用书名号或列表。\n' +
    (o.group ? '这句话会发在群里，只有' + name + '和别人都能看到，所以不能出现私聊细节。' : '这句话只有' + name + '能看到。') +
    '\n只输出这句话本身，不要引号、不要解释。'
  const user = lines ? '你记得的事：\n' + lines : '（暂时没有具体可提的事，就随便关心一句。）'
  return { system, user }
}

/** 清洗模型输出：去引号/换行/前缀，超长截断；空内容视为失败。 */
export function sanitizeLine(text, max) {
  let s = String(text == null ? '' : text).trim()
  s = s.replace(/^["'「『（(]+/, '').replace(/["'」』）)]+$/, '')
  s = s.replace(/\s*[\r\n]+\s*/g, ' ').trim()
  s = s.replace(/^(肥鱼|我)[：:]\s*/, '')
  const limit = Number(max) > 0 ? Math.floor(max) : MAX
  if (s.length > limit) s = s.slice(0, limit)
  return s
}

export async function generateSpeak(ctx, agent, opts) {
  const o = opts || {}
  const fallback = sanitizeLine(o.fallback || '想跟你说说话了。')
  if (!agent) return { ok: false, text: fallback, message: '没有可用会话' }
  const { system, user } = buildSpeakPrompt(o.profile || { items: [] }, o)
  const r = await askModel(ctx, agent, system, user, 200)
  if (!r.ok) return { ok: false, text: fallback, message: r.message }
  const line = sanitizeLine(r.text)
  if (!line) return { ok: false, text: fallback, message: '模型没给出可用的话' }
  return { ok: true, text: line, model: r.provider + '/' + r.model }
}
