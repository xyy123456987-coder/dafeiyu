// 宿主交互层：会话事件、模型调用、主动投递。全部 async，调用方必须 await。
import { log } from './store.mjs'

const PLUGIN_ID = 'dsh-feiyu-owner'

// createUserMessage 从宿主那棵树取，取不到用本地等价实现（裸 import 会让插件在别人机器上加载失败）
let createUserMessage = (o) => ({ role: 'user', ...o })
try {
  const mod = await import('@deepseek-ai/dsh-tools')
  if (mod && typeof mod.createUserMessage === 'function') createUserMessage = mod.createUserMessage
} catch (error) {}

export function sessionIdOf(session) {
  if (!session) return ''
  for (const k of ['id', 'sessionId', 'key', 'sid']) {
    const v = session[k]
    if (typeof v === 'string' && v) return v
  }
  return ''
}

export function textOf(p) {
  if (!p) return ''
  if (typeof p === 'string') return p
  if (typeof p.text === 'string') return p.text
  if (typeof p.content === 'string') return p.content
  if (Array.isArray(p.content)) {
    return p.content.map((b) => (typeof b === 'string' ? b : b && typeof b.text === 'string' ? b.text : '')).join(' ')
  }
  return ''
}

/** 会话事件。两路都试，inspect 必须 await（Codex 指出上一版漏了 await，会读到空）。 */
export async function eventsOf(ctx, sid) {
  try {
    const s = ctx.sessions && typeof ctx.sessions.get === 'function' ? ctx.sessions.get(sid) : null
    if (s && typeof s.snapshotEvents === 'function') return s.snapshotEvents() || []
  } catch (error) {}
  try {
    const sc = ctx.get && ctx.get('sessionController')
    if (sc && typeof sc.inspect === 'function') {
      const r = await sc.inspect(sid)
      const ev = (r && (r.events || r.snapshotEvents)) || []
      if (Array.isArray(ev)) return ev
    }
  } catch (error) {
    log('inspect 失败：' + (error && error.message))
  }
  return []
}

export async function messagesIn(ctx, sid, from, to) {
  const out = []
  for (const e of await eventsOf(ctx, sid)) {
    const type = e && (e.type || e.kind)
    if (type !== 'user/message' && type !== 'assistant/message') continue
    const payload = e.payload !== undefined ? e.payload : e.data
    const at = Date.parse((payload && (payload.at || payload.time)) || e.at || 0) || 0
    if (from && at && at < from) continue
    if (to && at && at > to) continue
    const text = textOf(payload && (payload.message || payload)).trim()
    if (text) out.push({ who: type === 'user/message' ? 'user' : 'assistant', text, at })
  }
  return out
}

export function modelOf(ctx, agent) {
  try {
    const h = agent && agent.session && agent.session.requestHeader ? agent.session.requestHeader() : null
    const c = h && h.config
    if (c && c.provider && c.model) return { provider: c.provider, model: c.model }
  } catch (error) {}
  try {
    const o = agent && agent.options
    if (o && o.provider && o.model) return { provider: o.provider, model: o.model }
  } catch (error) {}
  try {
    const svc = ctx.get('agentDefaultModel')
    const sel = svc && svc.currentSelection ? svc.currentSelection() : null
    if (sel && sel.provider && sel.model) return { provider: sel.provider, model: sel.model }
  } catch (error) {}
  return null
}

export async function askModel(ctx, agent, system, user, maxTokens) {
  const t = modelOf(ctx, agent)
  if (!t) return { ok: false, message: '拿不到这个会话在用的模型' }
  let messages
  try {
    messages = [createUserMessage({ content: [{ type: 'text', text: user }], source: { kind: 'plugin', plugin: PLUGIN_ID } })]
  } catch (error) {
    return { ok: false, message: '构造消息失败：' + (error && error.message) }
  }
  let out = ''
  try {
    for await (const chunk of ctx.llm.stream({
      provider: t.provider,
      model: t.model,
      system,
      messages,
      maxTokens: maxTokens || 1200,
      temperature: 0.2,
    })) {
      if (!chunk) continue
      if (chunk.type === 'text-delta') out += chunk.text
      if (chunk.type === 'finish' && chunk.reason && chunk.reason.kind === 'error') {
        const f = chunk.reason.failure || {}
        return { ok: false, message: '模型报错：' + (f.message || f.code || '?') }
      }
    }
  } catch (error) {
    return { ok: false, message: '调用失败：' + (error && error.message) }
  }
  return { ok: true, text: String(out || '').trim(), provider: t.provider, model: t.model }
}

/** 主动说一句话。followup 可能是异步的，必须 await 并把错误接住（上一版漏了）。 */
export async function say(ctx, agent, text) {
  if (!agent) return { ok: false, message: '目标会话不在线' }
  if (typeof agent.followup !== 'function') return { ok: false, message: '这个 agent 没有 followup' }
  try {
    await agent.followup(
      createUserMessage({ content: [{ type: 'text', text: String(text) }], source: { kind: PLUGIN_ID, plugin: PLUGIN_ID } }),
    )
    return { ok: true }
  } catch (error) {
    log('followup 失败：' + (error && error.message))
    return { ok: false, message: String((error && error.message) || error) }
  }
}
