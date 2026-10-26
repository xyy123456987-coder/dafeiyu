// dsh-feiyu-owner · 入口：注入、整理、主动开口、Agent 内单主人绑定、设置页。
// 未在真实 DSH 安装运行过；群聊反查与 @ 依赖 OneBot，未实测。
// 认主规则（用户 2026-10-26 明确）：只锁安装者在对话里给出的那**一个** QQ 号，与是否群主无关；
//   未绑定时由 Agent 主动询问，群号不是首次认主的必填项。
import { DATA_OK, DATA_DIR, REASON, ensureDir, log, cfg, saveCfg, loadProfile, saveProfile } from './store.mjs'
import { sessionIdOf, textOf, say } from './host.mjs'
import { runDigest, parseDigest } from './digest.mjs'
import { pickForInjection, renderInjection, blockEntry, previousDayRange, dayKey, shouldAskOnboard, shouldAskInChat, parseOwnerQq, newInstallId } from './core.mjs'
import { resolveSender, sendGroupMsg, groupAtSegments, getLoginInfo, normalizeBase } from './onebot.mjs'
import { makeSetupTool, hasDefineTool } from './tool.mjs'
import { generateSpeak } from './speak.mjs'
import { PAGE } from './page.mjs'

export const name = 'feiyu-owner'
export const inject = ['systemPrompt', 'agents', 'timer', 'webServer', 'sessions', 'llm']

const GROUP_DEFAULTS = {
  enabled: false,
  baseUrl: 'http://127.0.0.1:3000',
  token: '',
  groupId: '',
  sessionIds: [],
  historyCount: 20,
  logOnly: true,
}

const ONBOARD_LINE =
  '【专属主人 · 还没绑定】现在还没有锁定主人。' +
  '如果对方告诉你自己的 QQ 号，就调用 feiyu_owner_setup 保存（ownerQq=那个号，confirm=true）；' +
  '只锁一个号，群号可以先不填。如果对方还没说，就先问一句「你的 QQ 号是多少？我记下来，以后只认你」。'

export function apply(ctx) {
  if (!DATA_OK) {
    console.error('[feiyu-owner] ' + REASON + ' —— 不写入任何文件')
    return
  }
  ensureDir()
  log('apply 启动，dataDir=' + DATA_DIR + '；宿主 defineTool=' + (hasDefineTool() ? '有' : '无（用标准 JSON Schema）'))

  // 第一次装：生成安装标识。弹窗、对话兜底、设置页都读这一份状态。
  try {
    if (!cfg().installId) {
      const saved = saveCfg(Object.assign({}, cfg(), { installId: newInstallId(), installedAt: new Date().toISOString() }))
      log('记下新安装：' + cfg().installId + (saved ? '' : '（写盘失败，下次启动会再生成）'))
    }
  } catch (error) {
    log('安装标识写不进去：' + (error && error.message))
  }

  const mounted = new Map()
  const lastUserId = new Map()
  const ownerSeen = new Map()
  const digestDone = new Set()
  const resolving = new Set()
  let lastSpeakAt = 0
  let busy = false

  const group = () => Object.assign({}, GROUP_DEFAULTS, cfg().group || {})
  const boundOwner = () => ((cfg().ownerQq || []).filter(Boolean)[0] || '')
  const listOf = () => (ctx.agents && ctx.agents.list ? ctx.agents.list() : []) || []
  const agentForOwner = (list) => {
    const owners = (cfg().ownerSessions || []).map(String)
    return list.find((a) => owners.includes(sessionIdOf(a.session))) || null
  }
  function modeOf(sid) {
    const c = cfg()
    if ((c.ownerSessions || []).map(String).includes(String(sid))) return 'private'
    if ((group().sessionIds || []).map(String).includes(String(sid))) return 'group'
    return 'other'
  }

  // 首次安装：界面那条路没走成时，Agent 在对话里补问一句（只问一次，且不在群里问）
  function askOnboardOnce(agent, sid) {
    const c = cfg()
    if (!shouldAskInChat(c, modeOf(sid))) return
    try {
      saveCfg(Object.assign({}, c, { onboardedAskedAt: new Date().toISOString() }))
    } catch (error) {
      return
    }
    Promise.resolve()
      .then(() => say(ctx, agent, '（第一次见面，先把关系定下来：问对方一句「你的 QQ 号是多少？我记下来，以后只认你」——不要提插件、不要一次问一堆）'))
      .then((r) => log(r.ok ? '已主动询问主人 QQ' : '主动询问失败：' + r.message))
      .catch((e) => log('主动询问出错：' + (e && e.message)))
  }

  function verifyIncoming(sid, text) {
    const g = group()
    if (!g.enabled || !g.groupId || !text || resolving.has(sid)) return
    ownerSeen.delete(sid)
    resolving.add(sid)
    resolveSender(g, g.groupId, text, g.historyCount)
      .then((r) => {
        const owners = (cfg().ownerQq || []).map(String)
        if (r.ok && owners.includes(String(r.qq))) {
          ownerSeen.set(sid, { qq: String(r.qq), at: Date.now(), text })
          log('群 ' + sid + ' 反查确认主人在说话（' + r.qq + '）')
        } else {
          log('群反查未确认主人：' + (r.ok ? '发言者是 ' + r.qq : r.reason))
        }
      })
      .catch((e) => log('群反查出错：' + (e && e.message)))
      .finally(() => resolving.delete(sid))
  }

  function mountFor(agent, sid) {
    const offs = []
    try {
      const off = agent.ctx.on('agent/inbox/inserted', (payload) => {
        const txt = textOf(payload && payload.message ? payload.message : payload).trim()
        if (!txt) return
        lastUserId.set(sid, txt)
        if (modeOf(sid) === 'group') verifyIncoming(sid, txt)
      })
      if (typeof off === 'function') offs.push(off)
    } catch (error) {
      log('监听 inbox 失败：' + (error && error.message))
    }
    try {
      const off = agent.ctx.systemPrompt.context({
        name: 'dsh-feiyu-owner',
        order: 900,
        text: () => {
          try {
            const c = cfg()
            const owner = boundOwner()
            // 还没绑定：只放引导，不注入档案（没有档案）
            if (!owner) return modeOf(sid) === 'group' ? '' : ONBOARD_LINE
            if (!c.enabled) return ''
            const profile = loadProfile()
            if (!profile.items.length) return ''
            const mode = modeOf(sid)
            const query = lastUserId.get(sid) || ''
            const seen = ownerSeen.get(sid)
            const verified = !!seen && seen.text === query && Date.now() - seen.at < 10 * 60000
            const picked = pickForInjection(profile, {
              query,
              group: mode !== 'private',
              maxItems: c.maxItems,
              maxChars: c.maxChars,
            })
            let text = renderInjection(picked, { ownerName: c.ownerName })
            if (mode === 'group' && verified) {
              text += '\n（刚刚说话的就是' + c.ownerName + '，这一轮先回' + c.ownerName + '，再回其他人。）'
            }
            return text
          } catch (error) {
            return ''
          }
        },
      })
      if (typeof off === 'function') offs.push(off)
    } catch (error) {
      log('注入挂不上：' + (error && error.message))
    }
    try {
      const t = makeSetupTool({ sid, modeOf })
      const off = t ? agent.ctx.tools.register(t) : null
      if (typeof off === 'function') offs.push(off)
      log('绑定工具已挂：' + sid)
    } catch (error) {
      log('绑定工具挂不上：' + (error && error.message))
    }
    askOnboardOnce(agent, sid)
    return () => {
      for (const f of offs) {
        try {
          if (typeof f === 'function') f()
        } catch (error) {}
      }
    }
  }

  async function groupSpeak(agent, text) {
    const c = cfg()
    const g = group()
    if (!c.enabled) return { ok: false, message: '插件总开关没开' }
    if (!g.enabled) return { ok: false, message: '群聊增强没开' }
    if (!g.groupId) return { ok: false, message: '没配群号' }
    const segs = groupAtSegments(text, boundOwner())
    if (g.logOnly || c.dryRun) {
      log('试运行：本来要在群 ' + g.groupId + ' 发 ' + JSON.stringify(segs))
      return { ok: true, dryRun: true, segments: segs }
    }
    const r = await sendGroupMsg(g, g.groupId, segs)
    log(r.ok ? '群消息已发送（' + g.groupId + '）' : '群消息发送失败：' + JSON.stringify(r).slice(0, 200))
    return { ok: r.ok, segments: segs, error: r.ok ? undefined : r.error || (r.data && r.data.wording) }
  }

  async function proactive(agent) {
    const c = cfg()
    const toGroup = !!group().enabled
    const r = await generateSpeak(ctx, agent, {
      ownerName: c.ownerName,
      group: toGroup,
      profile: loadProfile(),
      fallback: String((c.speakUp && c.speakUp.text) || '想跟你说说话了。'),
    })
    log((r.ok ? '主动句来自模型：' : '主动句退回兜底（' + r.message + '）：') + r.text)
    if (toGroup) return groupSpeak(agent, r.text)
    if (!agent) return { ok: false, message: '主人会话不在线' }
    if (c.dryRun) {
      log('试运行：本来要在 ' + sessionIdOf(agent.session) + ' 说「' + r.text + '」')
      return { ok: true, dryRun: true, text: r.text }
    }
    const sent = await say(ctx, agent, r.text)
    return { ok: sent.ok, text: r.text, message: sent.message }
  }

  function tick() {
    try {
      const c = cfg()
      const list = listOf()
      const alive = new Set()
      for (const agent of list) {
        const sid = sessionIdOf(agent.session)
        if (!sid) continue
        alive.add(sid)
        const cur = mounted.get(sid)
        if (cur && cur.agent === agent) continue
        if (cur) {
          try {
            cur.off()
          } catch (error) {}
          mounted.delete(sid)
        }
        try {
          mounted.set(sid, { agent, off: mountFor(agent, sid) })
          log('挂上 ' + sid + '（' + modeOf(sid) + '）')
        } catch (error) {
          log('挂 ' + sid + ' 失败：' + (error && error.message))
        }
      }
      for (const [sid, v] of mounted) {
        if (alive.has(sid)) continue
        try {
          v.off()
        } catch (error) {}
        mounted.delete(sid)
        lastUserId.delete(sid)
        ownerSeen.delete(sid)
      }
      if (!c.enabled || busy) return
      const now = new Date()
      const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')
      const today = dayKey(now.getTime())
      if (hhmm >= (c.digestAt || '04:30') && !digestDone.has(today)) {
        digestDone.add(today)
        busy = true
        Promise.resolve()
          .then(() => runDigest(ctx, agentForOwner(list) || list[0]))
          .catch((error) => log('整理出错：' + (error && error.message)))
          .finally(() => {
            busy = false
          })
      }
      const sp = c.speakUp || {}
      if (!sp.enabled) return
      const cd = Math.max(1, Number(sp.cooldownMinutes) || 180) * 60000
      const h = now.getHours()
      const quiet = Number(sp.quietTo) > Number(sp.quietFrom) && h >= Number(sp.quietFrom) && h < Number(sp.quietTo)
      if (quiet || Date.now() - lastSpeakAt < cd) return
      const agent = agentForOwner(list)
      lastSpeakAt = Date.now()
      Promise.resolve()
        .then(() => proactive(agent))
        .then((r) => log(r.ok ? '主动开口完成' + (r.dryRun ? '（试运行）' : '') : '主动开口失败：' + r.message))
        .catch((error) => log('主动开口出错：' + (error && error.message)))
    } catch (error) {
      log('tick 出错：' + (error && error.message))
    }
  }

  try {
    ctx.effect(() => ctx.interval(tick, 500))
  } catch (error) {
    log('定时器不可用：' + (error && error.message))
  }
  tick()

  try {
    ctx.effect(() => () => {
      for (const v of mounted.values()) {
        try {
          v.off()
        } catch (error) {}
      }
      mounted.clear()
    })
  } catch (error) {}

  const route = (path, handler) =>
    ctx.effect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path,
        handler: async (req, res) => {
          try {
            await handler(req, res)
          } catch (error) {
            try {
              res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ ok: false, error: String((error && error.message) || error) }))
            } catch (e2) {}
          }
        },
      }),
    )
  const json = (res, o) => {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(o))
  }
  const body = async (req) => {
    let s = ''
    for await (const ch of req) s += ch
    try {
      return JSON.parse(s || '{}')
    } catch (error) {
      return {}
    }
  }

  try {
    route('/dsh-feiyu-owner/page', (req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(PAGE)
    })
    route('/dsh-feiyu-owner/list', (req, res) => {
      const c = cfg()
      const p = loadProfile()
      json(res, {
        ok: true,
        dataDir: DATA_DIR,
        cfg: c,
        owner: boundOwner(),
        group: group(),
        defineTool: hasDefineTool(),
        ownerSeen: [...ownerSeen.entries()].map(([sid, v]) => ({ sid, qq: v.qq, at: v.at })),
        items: p.items.map((x) => ({
          id: x.id,
          key: x.key,
          text: x.text,
          kind: x.kind,
          scope: x.scope,
          pinned: !!x.pinned,
          supersededBy: x.supersededBy || null,
        })),
        blockedKeys: p.blockedKeys || [],
      })
    })

    // ---------- 首次向导：界面弹窗 / 对话兜底共用这一份状态 ----------
    // 只接受本机请求：认主 = 授权，按规矩只能由坐在机器前的人点。
    const isLocalReq = (req) => {
      const a = String((req.socket && req.socket.remoteAddress) || '')
      return !a || a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'
    }
    const sessionIdIn = (v) => String(v == null ? '' : v).trim()

    route('/dsh-feiyu-owner/onboard', async (req, res) => {
      const method = String(req.method || 'GET').toUpperCase()
      if (method !== 'POST') {
        const c = cfg()
        const shouldAsk = shouldAskOnboard(c)
        json(res, {
          ok: true,
          shouldAsk,
          owner: boundOwner(),
          ownerName: c.ownerName || '主人',
          installId: c.installId || '',
          installedAt: c.installedAt || '',
          seenAt: c.onboardSeenAt || null,
          dismissedAt: c.onboardDismissedAt || null,
          boundFrom: c.onboardBoundFrom || '',
          dataDir: DATA_DIR,
        })
        if (shouldAsk) log('界面来问首次绑定状态：该弹窗')
        return
      }
      if (!isLocalReq(req)) return json(res, { ok: false, message: '只接受本机操作。' })
      const b = await body(req)
      const action = String(b.action || '')
      const nowIso = new Date().toISOString()
      if (action === 'seen') {
        const c = cfg()
        if (c.onboardSeenAt) return json(res, { ok: true, seenAt: c.onboardSeenAt })
        saveCfg(Object.assign({}, c, { onboardSeenAt: nowIso }))
        log('弹窗已经在界面里出现（' + nowIso + '）')
        return json(res, { ok: true, seenAt: nowIso })
      }
      if (action === 'dismiss') {
        saveCfg(Object.assign({}, cfg(), { onboardDismissedAt: nowIso }))
        log('点了「先不用」：以后不再自动弹，只在设置页手动绑')
        return json(res, { ok: true, dismissedAt: nowIso })
      }
      json(res, { ok: false, message: '不认识的 action：' + action })
    })

    route('/dsh-feiyu-owner/bind', async (req, res) => {
      if (!isLocalReq(req)) return json(res, { ok: false, message: '只接受本机操作。' })
      const b = await body(req)
      const c = cfg()
      const ownerNow = boundOwner()
      const parsed = parseOwnerQq(b.ownerQq)
      if (!parsed.ok) return json(res, { ok: false, message: parsed.message })
      if (ownerNow && ownerNow !== parsed.qq) {
        return json(res, {
          ok: false,
          message: '已经锁定主人 ' + ownerNow + ' 了。要换人，在对话里明确跟我说一次（我会再确认）。',
        })
      }
      if (!b.confirm) return json(res, { ok: false, message: '要保存请带上确认。' })
      const name = String(b.ownerName || '').trim() || c.ownerName || '主人'
      const extraSessions = (Array.isArray(b.ownerSessions) ? b.ownerSessions : [sessionIdIn(b.sessionId)])
        .map(sessionIdIn)
        .filter(Boolean)
      const next = Object.assign({}, c, {
        ownerQq: [parsed.qq],
        ownerName: name,
        ownerSessions: [...new Set([...(c.ownerSessions || []).map(String), ...extraSessions])],
        onboardBoundAt: new Date().toISOString(),
        onboardBoundFrom: 'dialog',
      })
      const saved = saveCfg(next)
      log('弹窗里绑定主人：' + parsed.qq + (saved ? '' : '（写盘失败）'))
      json(res, {
        ok: saved,
        owner: parsed.qq,
        ownerName: name,
        message: saved
          ? '已经记住：以后只认 ' + parsed.qq + '，称呼你「' + name + '」。'
          : '保存失败：数据目录必须落在 E 盘，检查一下再试。',
      })
    })
    route('/dsh-feiyu-owner/save', async (req, res) => {
      const b = await body(req)
      const next = Object.assign({}, cfg())
      for (const k of ['enabled', 'dryRun', 'ownerName', 'targetSession', 'digestAt', 'maxItems', 'maxChars']) {
        if (b[k] !== undefined) next[k] = b[k]
      }
      // ownerQq 只保留一个；想换主人必须走绑定工具（force）
      if (b.ownerQq !== undefined) {
        const one = String(b.ownerQq || '').trim()
        if (one && one !== boundOwner()) {
          return json(res, { ok: false, message: 'Use feiyu_owner_setup to bind or replace the owner.' })
        }
      }
      if (Array.isArray(b.ownerSessions)) next.ownerSessions = b.ownerSessions.map(String).filter(Boolean)
      if (b.speakUp && typeof b.speakUp === 'object') next.speakUp = Object.assign({}, cfg().speakUp, b.speakUp)
      if (b.group && typeof b.group === 'object') {
        const g = Object.assign({}, GROUP_DEFAULTS, cfg().group || {}, b.group)
        if (Array.isArray(g.sessionIds)) g.sessionIds = g.sessionIds.map(String).filter(Boolean)
        next.group = g
      }
      json(res, { ok: saveCfg(next), cfg: next })
    })
    route('/dsh-feiyu-owner/delete', async (req, res) => {
      const b = await body(req)
      const r = blockEntry(loadProfile(), String(b.id || ''))
      if (r.removed) saveProfile(r.profile)
      json(res, { ok: r.removed })
    })
    route('/dsh-feiyu-owner/pin', async (req, res) => {
      const b = await body(req)
      const p = loadProfile()
      const it = p.items.find((x) => String(x.id) === String(b.id || ''))
      if (!it) return json(res, { ok: false, message: '没这条' })
      it.pinned = b.pinned === undefined ? !it.pinned : !!b.pinned
      saveProfile(p)
      json(res, { ok: true, pinned: it.pinned })
    })
    route('/dsh-feiyu-owner/digest', async (req, res) => {
      json(res, await runDigest(ctx, agentForOwner(listOf()) || listOf()[0], { force: true }))
    })
    route('/dsh-feiyu-owner/speak-preview', async (req, res) => {
      const list = listOf()
      json(res, await generateSpeak(ctx, agentForOwner(list) || list[0], {
        ownerName: cfg().ownerName,
        group: !!group().enabled,
        profile: loadProfile(),
        fallback: String((cfg().speakUp && cfg().speakUp.text) || '想跟你说说话了。'),
      }))
    })
    route('/dsh-feiyu-owner/group-check', async (req, res) => {
      const b = await body(req)
      const g = Object.assign({}, group(), b.groupId ? { groupId: String(b.groupId) } : {})
      const out = { ok: false, baseUrl: normalizeBase(g.baseUrl), groupId: g.groupId, enabled: !!g.enabled, owner: boundOwner() }
      try {
        const login = await getLoginInfo(g)
        out.bot = login.ok ? login.data && login.data.data : { error: login.error }
        out.ok = login.ok
        if (login.ok && g.groupId) {
          if (b.text) out.resolve = await resolveSender(g, g.groupId, String(b.text), g.historyCount)
          out.preview = groupAtSegments('在吗？', boundOwner())
        }
      } catch (error) {
        out.error = String((error && error.message) || error)
      }
      json(res, out)
    })
    route('/dsh-feiyu-owner/group-send', async (req, res) => {
      const b = await body(req)
      const list = listOf()
      if (b.text) return json(res, await groupSpeak(agentForOwner(list) || list[0], String(b.text)))
      json(res, await proactive(agentForOwner(list) || list[0]))
    })
    route('/dsh-feiyu-owner/selftest', async (req, res) => {
      const c = cfg()
      const list = listOf()
      const { modelOf } = await import('./host.mjs')
      json(res, {
        ok: true,
        dataDir: DATA_DIR,
        defineTool: hasDefineTool(),
        owner: boundOwner(),
        onboardedAskedAt: c.onboardedAskedAt || null,
        onboard: {
          installId: c.installId || '',
          installedAt: c.installedAt || '',
          seenAt: c.onboardSeenAt || null,
          dismissedAt: c.onboardDismissedAt || null,
          boundAt: c.onboardBoundAt || null,
          boundFrom: c.onboardBoundFrom || '',
          shouldAskDialog: shouldAskOnboard(c),
          shouldAskInChat: shouldAskInChat(c, 'private'),
        },
        agents: list.length,
        mounted: [...mounted.keys()].map((sid) => ({ sid, mode: modeOf(sid) })),
        ownerSessionOnline: !!agentForOwner(list),
        group: group(),
        yesterday: previousDayRange(),
        model: modelOf(ctx, agentForOwner(list) || list[0]),
      })
    })
  } catch (error) {
    log('路由挂不上：' + (error && error.message))
  }

  log('apply 结束')
}

export { runDigest, parseDigest }
