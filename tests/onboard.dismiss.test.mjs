// 「点先不用」单独一个文件：store.mjs 的配置是进程内缓存，
// node --test 每个文件一个进程，正好能干净地模拟"刚装好、还没绑、点了一下先不用"。
//
// 跑法：node --test E:/AI_Workspace/Projects/dsh-feiyu-owner/tests/onboard.dismiss.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, readFileSync } from 'node:fs'

const DATA_DIR = 'E:/AI_Workspace/Temp/feiyu-owner-dismiss-test'
process.env.FEIYU_OWNER_DATA_DIR = DATA_DIR
rmSync(DATA_DIR, { recursive: true, force: true })
mkdirSync(DATA_DIR, { recursive: true })

const routes = new Map()
const ctx = {
  effect(fn) {
    fn()
    return () => {}
  },
  interval() {
    return () => {}
  },
  on() {
    return () => {}
  },
  get() {
    return undefined
  },
  sessions: { get: () => null },
  agents: { list: () => [] },
  llm: { async *stream() {} },
  systemPrompt: { context: () => () => {} },
  tools: { register: () => () => {} },
  webServer: {
    register(spec) {
      routes.set(spec.path, spec.handler)
      return () => {}
    },
  },
}

const { apply } = await import('../lib/index.js')
apply(ctx)

async function call(path, method = 'GET', body, remoteAddress = '127.0.0.1') {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const req = { method, url: '/', socket: { remoteAddress } }
  req[Symbol.asyncIterator] = async function* () {
    if (payload) yield Buffer.from(payload, 'utf8')
  }
  let body2 = ''
  const res = {
    writeHead() {},
    end(chunk) {
      if (chunk !== undefined) body2 += String(chunk)
    },
  }
  await routes.get(path)(req, res)
  return JSON.parse(body2)
}

test('还没绑 → 该弹 → 点先不用 → 不再弹，并留痕', async () => {
  const before = await call('/dsh-feiyu-owner/onboard')
  assert.equal(before.shouldAsk, true)
  assert.equal(before.dismissedAt, null)

  const dismissed = await call('/dsh-feiyu-owner/onboard', 'POST', { action: 'dismiss' })
  assert.equal(dismissed.ok, true)
  assert.ok(dismissed.dismissedAt)

  const after = await call('/dsh-feiyu-owner/onboard')
  assert.equal(after.shouldAsk, false)

  const cfg = JSON.parse(readFileSync(DATA_DIR + '/config.json', 'utf8'))
  assert.ok(cfg.onboardDismissedAt, '配置里没有留痕')
  assert.deepEqual(cfg.ownerQq, [])
})
