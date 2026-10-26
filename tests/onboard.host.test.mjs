// 宿主半端的「安装后弹窗」验收：不启动 DSH，用假 ctx 把 apply() 跑起来，
// 再像浏览器那样打它自己挂的两条路由（/onboard、/bind）。
//
// 跑法：node --test E:/AI_Workspace/Projects/dsh-feiyu-owner/tests/onboard.host.test.mjs
//
// 覆盖：该弹的时候该弹 / 露脸后仍该弹 / 绑上之后不再弹 / 点「先不用」不再弹 /
//       重复绑别人的号被拒 / 格式不对被拒 / 非本机请求被拒 / 真的写进 E 盘临时目录。
//
// ⚠ 数据目录用 E:/AI_Workspace/Temp/feiyu-owner-test，**不碰**使用者真实的那份配置。

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs'

const DATA_DIR = 'E:/AI_Workspace/Temp/feiyu-owner-test'
process.env.FEIYU_OWNER_DATA_DIR = DATA_DIR

rmSync(DATA_DIR, { recursive: true, force: true })
mkdirSync(DATA_DIR, { recursive: true })

/** 一轮完整的假宿主：只实现插件真正用到的那几个方法。 */
function makeHost() {
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
  return { ctx, routes }
}

function makeReq(method, body, remoteAddress) {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const req = {
    method,
    url: '/',
    socket: { remoteAddress: remoteAddress === undefined ? '127.0.0.1' : remoteAddress },
  }
  req[Symbol.asyncIterator] = async function* () {
    if (payload) yield Buffer.from(payload, 'utf8')
  }
  return req
}

function makeRes() {
  const res = {
    status: 0,
    headers: null,
    body: '',
    writeHead(status, headers) {
      res.status = status
      res.headers = headers
    },
    end(chunk) {
      if (chunk !== undefined) res.body += String(chunk)
    },
  }
  return res
}

async function call(routes, path, method = 'GET', body, remoteAddress) {
  const handler = routes.get(path)
  assert.ok(handler, '路由没挂上：' + path)
  const res = makeRes()
  await handler(makeReq(method, body, remoteAddress), res)
  let parsed = null
  try {
    parsed = JSON.parse(res.body)
  } catch (error) {
    parsed = null
  }
  return { status: res.status, json: parsed }
}

const readCfg = () => JSON.parse(readFileSync(DATA_DIR + '/config.json', 'utf8'))

const { ctx, routes } = makeHost()
const plugin = await import('../lib/index.js')
plugin.apply(ctx)

test('apply 之后路由都在', () => {
  for (const p of ['/dsh-feiyu-owner/page', '/dsh-feiyu-owner/list', '/dsh-feiyu-owner/onboard', '/dsh-feiyu-owner/bind']) {
    assert.ok(routes.has(p), '缺路由 ' + p)
  }
  assert.ok(existsSync(DATA_DIR + '/config.json'), '配置没落盘')
})

test('刚装好没绑 → 界面该弹窗', async () => {
  const r = await call(routes, '/dsh-feiyu-owner/onboard')
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
  assert.equal(r.json.shouldAsk, true)
  assert.equal(r.json.owner, '')
  assert.ok(r.json.installId, '没有安装标识')
  assert.match(String(r.json.installId), /^i[a-z0-9]+$/)
})

test('弹窗露过脸之后：还是该弹，但对话兜底不再问', async () => {
  const seen = await call(routes, '/dsh-feiyu-owner/onboard', 'POST', { action: 'seen' })
  assert.equal(seen.json.ok, true)
  assert.ok(readCfg().onboardSeenAt, '没记到 onboardSeenAt')

  const again = await call(routes, '/dsh-feiyu-owner/onboard')
  assert.equal(again.json.shouldAsk, true)

  const self = await call(routes, '/dsh-feiyu-owner/selftest')
  assert.equal(self.json.onboard.shouldAskInChat, false)
})

test('填对了 QQ → 真的绑上，之后不再弹', async () => {
  const bad = await call(routes, '/dsh-feiyu-owner/bind', 'POST', { ownerQq: '12', confirm: true })
  assert.equal(bad.json.ok, false)

  const noConfirm = await call(routes, '/dsh-feiyu-owner/bind', 'POST', { ownerQq: '12345678' })
  assert.equal(noConfirm.json.ok, false)

  const ok = await call(routes, '/dsh-feiyu-owner/bind', 'POST', { ownerQq: '12345678', ownerName: '阿肥', confirm: true })
  assert.equal(ok.json.ok, true)
  assert.equal(ok.json.owner, '12345678')

  const cfg = readCfg()
  assert.deepEqual(cfg.ownerQq, ['12345678'])
  assert.equal(cfg.ownerName, '阿肥')
  assert.equal(cfg.onboardBoundFrom, 'dialog')

  const after = await call(routes, '/dsh-feiyu-owner/onboard')
  assert.equal(after.json.shouldAsk, false)
  assert.equal(after.json.owner, '12345678')
})

test('已绑定时想换别人的号 → 拒绝，绑定不动', async () => {
  const r = await call(routes, '/dsh-feiyu-owner/bind', 'POST', { ownerQq: '87654321', confirm: true })
  assert.equal(r.json.ok, false)
  assert.match(String(r.json.message), /已经锁定主人/)
  assert.deepEqual(readCfg().ownerQq, ['12345678'])
})

test('不是本机发来的绑定请求 → 拒绝', async () => {
  const r = await call(routes, '/dsh-feiyu-owner/bind', 'POST', { ownerQq: '87654321', confirm: true }, '10.1.2.3')
  assert.equal(r.json.ok, false)
  assert.match(String(r.json.message), /本机/)
})

// 「点先不用」那条走 tests/onboard.dismiss.test.mjs：
// store.mjs 的配置是**进程内缓存**，同一个进程里没法把绑定清干净再重来。

