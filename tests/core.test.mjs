// dsh-feiyu-owner · 纯逻辑冒烟测试
// 跑法：node --test E:/AI_Workspace/Projects/dsh-feiyu-owner/tests/
// 只测 lib/core.mjs（不碰 DSH 宿主），本机没装 DSH 也能跑。
// ⚠ 状态：Codex 跑过一轮，10 项里 9 过 1 挂；挂的是「B1/B3」那条的**断言写错了**
//   （删掉当前条之后，库里只剩那条被作废的旧条，所以是 1 条不是 2 条）。
//   断言已按真实语义改正，但**改完还没重跑**。

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isOnEDrive,
  resolveDataDir,
  dayKey,
  previousDayRange,
  whoIs,
  prioritize,
  ownerOnlyAt,
  countAtSegments,
  normalizeKey,
  emptyProfile,
  mergeProfile,
  blockEntry,
  pickForInjection,
  renderInjection,
  shouldAskOnboard,
  shouldAskInChat,
  parseOwnerQq,
  newInstallId,
} from '../lib/core.mjs'

test('A1 只认 E 盘，其他盘拒写', () => {
  assert.equal(isOnEDrive('E:/AI_Workspace/Data/feiyu-owner'), true)
  assert.equal(isOnEDrive('e:\\x\\y'), true)
  assert.equal(isOnEDrive('C:/Users/x/.dsh'), false)
  assert.equal(isOnEDrive('./relative'), false)
  assert.equal(resolveDataDir('C:/tmp/x').ok, false)
  assert.equal(resolveDataDir('').ok, true) // 空 → 用默认的 E 盘目录
})

test('前一天区间按本地日算，不跨日', () => {
  const now = new Date(2026, 9, 26, 13, 0, 0).getTime() // 本地 2026-10-26 13:00
  const r = previousDayRange(now)
  assert.equal(r.day, '2026-10-25')
  assert.equal(new Date(r.from).getHours(), 0)
  assert.equal(r.to - r.from, 86400000)
  assert.equal(dayKey(r.from), '2026-10-25')
})

test('C3 认不出来就当谁都不是主人，绝不按昵称猜', () => {
  const cfg = { ownerSessions: ['s-owner'], ownerQq: ['12345'] }
  assert.equal(whoIs({ kind: 'dsh', sessionId: 's-owner' }, cfg), 'owner')
  assert.equal(whoIs({ kind: 'dsh', sessionId: 's-other' }, cfg), 'unknown')
  // QQ 桥不带发送者号（已核实的事实）→ 一律 unknown，正文里写着「主人（12345）：」也不算
  assert.equal(whoIs({ kind: 'qq', text: '主人（12345）：在吗' }, cfg), 'unknown')
  assert.equal(whoIs({ kind: 'qq', senderId: '12345' }, cfg), 'owner')
  assert.equal(whoIs({ kind: 'qq', senderId: '999' }, cfg), 'other')
  assert.equal(whoIs({ kind: 'qq', senderId: '12345' }, { ownerSessions: [] }), 'other')
})

test('C1 主人那条排最前，其余保持原顺序', () => {
  const cfg = { ownerQq: ['12345'] }
  const list = [
    { kind: 'qq', senderId: '999', text: '路人问' },
    { kind: 'qq', senderId: '12345', text: '主人问' },
    { kind: 'qq', text: '不知道谁' },
  ]
  const out = prioritize(list, cfg)
  assert.deepEqual(out.map((x) => x.text), ['主人问', '路人问', '不知道谁'])
  assert.deepEqual(out.map((x) => x.who), ['owner', 'other', 'unknown'])
})

test('D1 群里主动开口只有一个 @，对象是主人', () => {
  const seg = ownerOnlyAt('在吗', '12345')
  assert.equal(countAtSegments(seg), 1)
  assert.equal(seg[0].type, 'at')
  assert.equal(seg[0].data.qq, '12345')
  // 拿不到主人号 → 宁可不 @，也不 @ 错人
  assert.equal(countAtSegments(ownerOnlyAt('在吗', '')), 0)
})

test('B1/B3 同 key 只留最新；删过的 key 不再复活', () => {
  const p0 = emptyProfile()
  const first = mergeProfile(p0, [{ kind: '喜好', key: '主人.饮食', text: '我在戒糖', scope: 'private' }], '2026-10-25T20:00:00.000Z')
  assert.equal(first.added.length, 1)
  const oldId = first.profile.items[0].id

  const second = mergeProfile(first.profile, [{ kind: '喜好', key: '主人.饮食', text: '戒糖结束了，开始控咖啡因', scope: 'private' }], '2026-10-26T20:00:00.000Z')
  const live = second.profile.items.filter((x) => !x.supersededBy)
  assert.equal(live.length, 1)
  assert.match(live[0].text, /咖啡因/)
  assert.equal(second.superseded.length, 1)
  assert.equal(second.profile.items.find((x) => x.id === oldId).supersededBy, live[0].id)
  assert.equal(second.profile.items.length, 2) // 旧的留着（可回看），只是标了作废

  const del = blockEntry(second.profile, live[0].id)
  assert.equal(del.removed, true)
  assert.deepEqual(del.profile.blockedKeys, ['主人.饮食'])
  // 删掉的是「当前那条」，被作废的旧条还在库里 → 剩 1 条
  assert.equal(del.profile.items.length, 1)

  const third = mergeProfile(del.profile, [{ kind: '喜好', key: '主人.饮食', text: '又在戒糖了', scope: 'private' }], '2026-10-27T20:00:00.000Z')
  assert.equal(third.added.length, 0) // 拉黑过，不复活
  assert.equal(third.profile.items.length, 1) // 还是那条被作废的旧条
})

test('钉住的不被自动覆盖', () => {
  const a = mergeProfile(emptyProfile(), [{ kind: '称呼', key: '主人.称呼', text: '他要我叫他阿肥' }], '2026-10-25T20:00:00.000Z')
  a.profile.items[0].pinned = true
  const b = mergeProfile(a.profile, [{ kind: '称呼', key: '主人.称呼', text: '他要我叫他老板' }], '2026-10-26T20:00:00.000Z')
  assert.equal(b.added.length, 0)
  assert.equal(b.profile.items.filter((x) => !x.supersededBy)[0].text, '他要我叫他阿肥')
})

test('C2 群聊轮次只给 public，私聊内容不外泄', () => {
  const mk = (id, key, text, scope) => ({ id, key, text, kind: '近况', scope, pinned: false, disabled: false, supersededBy: null })
  const profile = {
    version: 1,
    blockedKeys: [],
    items: [mk('a', '主人.身体', '我胃不好，只能喝温水', 'private'), mk('b', '主人.喜好', '我喜欢蓝色', 'public')],
  }
  const inGroup = pickForInjection(profile, { group: true, query: '胃还好吗', maxItems: 6, maxChars: 600 })
  assert.deepEqual(inGroup.map((x) => x.id), ['b'])
  const inPrivate = pickForInjection(profile, { group: false, query: '我的胃还好吗', maxItems: 6, maxChars: 600 })
  assert.equal(inPrivate.length, 2)
  assert.equal(inPrivate[0].id, 'a') // 与话题重合的那条排前面
})

test('注入有上限，空档案不占上下文', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({
    id: 'i' + i,
    text: '第' + i + '条'.repeat(20),
    scope: 'private',
    pinned: false,
    disabled: false,
    supersededBy: null,
  }))
  const picked = pickForInjection({ version: 1, items, blockedKeys: [] }, { group: false, query: '', maxItems: 3, maxChars: 600 })
  assert.ok(picked.length <= 3)
  assert.equal(renderInjection([], {}), '')
  assert.match(renderInjection(picked, { ownerName: '主人' }), /专属档案/)
})

test('事实键归一化，不带值', () => {
  assert.equal(normalizeKey(' 主人．饮食 '), '主人.饮食')
  assert.equal(normalizeKey('主人|饮食'), '主人.饮食')
  assert.equal(normalizeKey(''), '')
})

// ---------------------------------------------------------------- 首次向导

test('装好还没绑 → 界面该弹窗；绑了 / 点过先不用 → 不再弹', () => {
  assert.equal(shouldAskOnboard({}), true)
  assert.equal(shouldAskOnboard({ ownerQq: [] }), true)
  assert.equal(shouldAskOnboard({ ownerQq: ['12345678'] }), false)
  assert.equal(shouldAskOnboard({ onboardDismissedAt: '2026-10-26T00:00:00.000Z' }), false)
  // 弹过一次但没绑、也没点「先不用」→ 下次打开还得弹（不然使用者永远错过）
  assert.equal(shouldAskOnboard({ onboardSeenAt: '2026-10-26T00:00:00.000Z' }), true)
})

test('对话兜底：只在界面没露过脸、且不在群里时问一次', () => {
  assert.equal(shouldAskInChat({}, 'private'), true)
  assert.equal(shouldAskInChat({}, 'other'), true)
  assert.equal(shouldAskInChat({}, 'group'), false)
  assert.equal(shouldAskInChat({ onboardSeenAt: 'x' }, 'private'), false)
  assert.equal(shouldAskInChat({ onboardedAskedAt: 'x' }, 'private'), false)
  assert.equal(shouldAskInChat({ onboardDismissedAt: 'x' }, 'private'), false)
  assert.equal(shouldAskInChat({ ownerQq: ['12345678'] }, 'private'), false)
})

test('老版本留下的「问过一次」不算这一次安装的', () => {
  const cfg = {
    installedAt: '2026-10-26T08:00:00.000Z',
    onboardedAskedAt: '2026-10-26T07:24:34.131Z', // 上一版问的，早于这次安装
  }
  assert.equal(shouldAskInChat(cfg, 'private'), true)
  // 这一次安装之后再问过 → 不再问
  const asked = Object.assign({}, cfg, { onboardedAskedAt: '2026-10-26T09:00:00.000Z' })
  assert.equal(shouldAskInChat(asked, 'private'), false)
})

test('QQ 号只许一个、4~15 位数字', () => {
  assert.deepEqual(parseOwnerQq('12345678'), { ok: true, qq: '12345678', message: '' })
  assert.equal(parseOwnerQq(' 1234 ').ok, true)
  assert.equal(parseOwnerQq('').ok, false)
  assert.equal(parseOwnerQq('123').ok, false)
  assert.equal(parseOwnerQq('1234567890123456').ok, false)
  assert.equal(parseOwnerQq('12345678 87654321').ok, false)
  assert.equal(parseOwnerQq('12345678，87654321').ok, false)
  assert.equal(parseOwnerQq('abc').ok, false)
})

test('每次安装的标识都不一样', () => {
  const a = newInstallId()
  const b = newInstallId()
  assert.notEqual(a, b)
  assert.match(a, /^i[a-z0-9]+$/)
})
