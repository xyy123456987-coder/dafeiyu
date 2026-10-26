// 主动开口那句话的纯逻辑测试（不联网、不碰 ctx）
import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeLine, buildSpeakPrompt } from '../lib/speak.mjs'

test('清洗模型输出：去引号、去换行、去「我：」前缀', () => {
  assert.equal(sanitizeLine('「在吗？今天想你了。」'), '在吗？今天想你了。')
  assert.equal(sanitizeLine('我：想你了\n你在干嘛'), '想你了 你在干嘛')
  assert.equal(sanitizeLine('   '), '')
  assert.equal(sanitizeLine(null), '')
})

test('超长截断到上限', () => {
  const s = sanitizeLine('啊'.repeat(200), 20)
  assert.equal(s.length, 20)
  assert.equal(sanitizeLine('短句', 20), '短句')
})

test('提示词里禁掉系统味、要求短句', () => {
  const p = buildSpeakPrompt({ items: [] }, { ownerName: '阿肥' })
  assert.match(p.system, /阿肥/)
  assert.match(p.system, /不要提系统、插件、记忆、模型/)
  assert.match(p.system, /不超过60字/)
  assert.equal(p.user, '（暂时没有具体可提的事，就随便关心一句。）')
})

test('群里的提示词必须要求不出现私聊细节', () => {
  const p = buildSpeakPrompt({ items: [] }, { ownerName: '阿肥', group: true })
  assert.match(p.system, /不能出现私聊细节/)
})

test('档案素材只取 public 给群、不超量', () => {
  const items = [
    { id: 'a', text: '我胃不好只能喝温水', scope: 'private', pinned: false, disabled: false, supersededBy: null },
    { id: 'b', text: '我喜欢蓝色', scope: 'public', pinned: false, disabled: false, supersededBy: null },
    { id: 'c', text: '我最近在学吉他', scope: 'public', pinned: false, disabled: false, supersededBy: null },
  ]
  const g = buildSpeakPrompt({ items }, { group: true })
  assert.doesNotMatch(g.user, /温水/)
  assert.match(g.user, /我喜欢蓝色|我最近在学吉他/)
  const priv = buildSpeakPrompt({ items }, { group: false })
  assert.match(priv.user, /你记得的事/)
})
