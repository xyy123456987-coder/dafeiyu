// Agent 对话里的绑定工具：安装者说「我 QQ 是 xxx」即可完成绑定（只锁一个，与群主无关）。
//
// 真实宿主实测（2026-10-26，日常 DSH 实例）报错：
//   tool "feiyu_owner_setup" must declare output { schema, render, presentationMeta? }
// → 说明宿主不只要 name/description/parameters，还**强制要求 output 声明**。
//   这里补上 output.schema + output.render；defineTool 拿不到时也照样带这两个字段，
//   跟 dsh-fish-memory 的 remember 工具写法一致（它的 render 返回 [{type:'text',text}]）。
//
// 其余边界不变：群会话拒绝；已绑定要 force；保存要 confirm；只落 E 盘。
import { cfg, saveCfg, log } from './store.mjs'

let defineTool = null
try {
  const mod = await import('@deepseek-ai/dsh-tools')
  if (mod && typeof mod.defineTool === 'function') defineTool = mod.defineTool
} catch (error) {
  log('取不到宿主 defineTool，改用普通工具定义（带 output 声明）：' + (error && error.message))
}

const PROPS = {
  action: { type: 'string', description: "'set'（保存绑定，默认）或 'status'（查看当前绑定）。" },
  ownerQq: { type: 'string', description: '主人的 QQ 号，只能填一个；多个会被拒绝。' },
  ownerName: { type: 'string', description: '怎么称呼主人，例如「主人」「阿肥」。可不填。' },
  groupId: { type: 'string', description: '专属互动的 QQ 群号。可不填，之后再加也行。' },
  groupSessionIds: { type: 'string', description: 'QQ 桥把该群绑到的 DSH 会话 id，多个用逗号分隔。' },
  baseUrl: { type: 'string', description: 'OneBot 11 HTTP 地址，默认 http://127.0.0.1:3000。' },
  confirm: { type: 'boolean', description: '保存绑定要填 true，防误触。' },
  force: { type: 'boolean', description: '已经有绑定时，换人需要填 true。' },
}

const OUTPUT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { ok: { type: 'boolean' }, message: { type: 'string' } },
}

/**
 * 渲染回执。**必须返回内容块数组**（宿主按块渲染），别返回字符串。
 * 另外：宿主校验 `output.presentationMeta` 时要求它是**函数**（传对象会直接拒掉整条工具，
 * 2026-10-26 真机日志里的那条 `must declare output { schema, render, presentationMeta? }`
 * 就是它）；这里干脆不声明，用默认卡片。
 */
const renderOutput = (_args, value) => {
  const v = value || {}
  const mark = v.ok === false ? '✗ ' : '✓ '
  return [{ type: 'text', text: mark + String(v.message || (v.ok === false ? '没成功' : '好了')) }]
}

/** 普通工具定义用的完整 JSON Schema（宿主没给 defineTool 时走这条）。 */
const RAW_PARAMS = { type: 'object', properties: PROPS, additionalProperties: false }

const splitQq = (v) =>
  (Array.isArray(v) ? v : String(v == null ? '' : v).split(/[,，\s]+/))
    .map((x) => String(x).trim())
    .filter(Boolean)

const DESC =
  '设置「主人」绑定：只锁一个 QQ 号，跟对方是不是群主无关。群号可以不填，之后再补。' +
  '只在安装者本机的对话里用；群聊里调用会被拒绝。已绑定要换人需 force=true；查当前绑定用 action=status。'

function build(deps) {
  const { sid, modeOf } = deps
  return {
    name: 'feiyu_owner_setup',
    description: DESC,
    async execute(args) {
      const a = args || {}
      if (modeOf(sid) === 'group') {
        log('拒绝在群会话里改绑定：' + sid)
        return { ok: false, message: '这是群会话，不能在这里绑定主人。请到你自己本机的对话里设置。' }
      }
      const c = cfg()
      const bound = (c.ownerQq || []).filter(Boolean)
      if ((a.action || 'set') === 'status') {
        const g = c.group || {}
        return {
          ok: true,
          message:
            '当前绑定：主人 QQ=' + (bound[0] || '（还没绑定）') +
            '；称呼=' + (c.ownerName || '主人') +
            '；群=' + (g.groupId || '（还没设，不影响认主）') +
            '；群增强=' + (g.enabled ? '开' : '关') +
            '；总开关=' + (c.enabled ? '开' : '关') + '，试运行=' + (c.dryRun ? '开' : '关'),
        }
      }
      const qqList = splitQq(a.ownerQq)
      if (!qqList.length) return { ok: false, message: '没给 QQ 号。请告诉我一个要锁定为主人的 QQ 号。' }
      if (qqList.length > 1) return { ok: false, message: '只能锁定一个主人，你给了 ' + qqList.length + ' 个。请只留一个 QQ 号。' }
      const qq = qqList[0]
      if (!/^\d{4,15}$/.test(qq)) return { ok: false, message: '「' + qq + '」不像 QQ 号（应为 4~15 位数字）。' }
      if (bound.length && bound[0] !== qq && !a.force) {
        return { ok: false, message: '已经锁定主人 ' + bound[0] + ' 了。要换人请明确要求覆盖并带 force=true。' }
      }
      if (!a.confirm) return { ok: false, message: '要保存请带上 confirm=true，避免误触。' }
      const g = Object.assign({}, c.group || {}, {
        groupId: a.groupId ? String(a.groupId).trim() : (c.group && c.group.groupId) || '',
        sessionIds: [
          ...new Set([
            ...(((c.group && c.group.sessionIds) || []).map(String)),
            ...String(a.groupSessionIds || '').split(/[,，\s]+/).filter(Boolean),
          ]),
        ],
      })
      if (a.baseUrl) g.baseUrl = String(a.baseUrl).trim()
      if (!g.groupId) g.enabled = false
      else if (g.enabled === undefined) g.enabled = true
      const next = Object.assign({}, c, {
        ownerQq: [qq],
        ownerName: String(a.ownerName || c.ownerName || '主人').trim() || '主人',
        ownerSessions: [...new Set([...(c.ownerSessions || []).map(String), String(sid)])],
        onboardedAt: new Date().toISOString(),
        group: g,
      })
      const saved = saveCfg(next)
      log('主人已锁定：' + qq + '（from ' + sid + '）' + (g.groupId ? ' 群=' + g.groupId : ' 未设群'))
      return {
        ok: saved,
        message: saved
          ? '已经锁定主人：' + qq + '，称呼「' + next.ownerName + '」。' +
            (g.groupId ? '群 ' + g.groupId + '（群增强' + (g.enabled ? '已开' : '关') + '）。' : '群号还没设，不影响认主，之后想加再说。') +
            '现在还是试运行，确认效果后到设置页关掉试运行、打开总开关。'
          : '保存失败，检查数据目录是否在 E 盘。',
      }
    },
  }
}

export function makeSetupTool(deps) {
  const def = build(deps)
  if (defineTool) {
    try {
      // defineTool 的 parameters 吃的是「属性表」，由它自己转成 JSON Schema
      return defineTool({ ...def, parameters: PROPS, output: { schema: OUTPUT_VALUE_SCHEMA, render: renderOutput } })
    } catch (error) {
      log('defineTool 包装失败，退回普通定义：' + (error && error.message))
    }
  }
  // 普通定义：parameters 必须是完整 JSON Schema，output 带 schema + render（render 必须是函数）
  return { ...def, parameters: RAW_PARAMS, output: { schema: OUTPUT_VALUE_SCHEMA, render: renderOutput } }
}

export const hasDefineTool = () => !!defineTool
