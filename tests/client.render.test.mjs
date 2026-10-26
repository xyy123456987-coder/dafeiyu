// 浏览器半端的冒烟测试：不启动浏览器、不装 React。
//
// 目的只有一个 —— 确认 client.js 是**能装进 DSH 的形状**，并且卡片真的能渲染出那句话：
//   · __ModuleLoader__.load({ id }) 的 id 必须等于包名
//   · factory(require) 只 require('react')
//   · apply() 往 shell.overlay 登记一个组件
//   · 组件在「该问」时渲染出「我是不是被装了一个主人插件」，绑好后渲染出主人的 QQ
//
// 跑法：node --test E:/AI_Workspace/Projects/dsh-feiyu-owner/tests/client.render.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      captured = spec
    },
  },
}

await import('../lib/client.js')

/** 极简 React 替身：createElement 出普通对象，hooks 从队列里取值。 */
function makeReact(queue) {
  let i = 0
  const next = (fallback) => (i < queue.length ? queue[i++] : fallback)
  return {
    createElement(type, props, ...children) {
      const merged = Object.assign({}, props)
      if (children.length === 1) merged.children = children[0]
      else if (children.length > 1) merged.children = children
      return { type, props: merged }
    },
    useState(initial) {
      const v = next(initial)
      return [v, () => {}]
    },
    useEffect() {},
    useRef(initial) {
      return { current: initial }
    },
  }
}

function textOf(node) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return textOf(node.props ? node.props.children : undefined)
}

/** 把组件跑一次，返回渲染出来的纯文本。 */
function renderPhase(phase, info) {
  const queue = [phase, info, '', (info && info.ownerName) || '主人', false, '']
  const mod = captured.factory((name) => {
    assert.equal(name, 'react', '只许 require(react)，实际：' + name)
    return makeReact(queue)
  })
  const registered = []
  const ctx = {
    get(name) {
      if (name !== 'slots') return undefined
      return {
        inject(key, fn) {
          fn()
        },
        register(options, component) {
          registered.push({ options, component })
          return () => {}
        },
      }
    },
  }
  mod.apply(ctx)
  assert.equal(registered.length, 1, '没往 shell.overlay 登记组件')
  assert.equal(registered[0].options.name, 'shell.overlay')
  return textOf(registered[0].component({}))
}

test('模块 id 等于包名，客户端清单存在', () => {
  assert.ok(captured, 'client.js 没有调用 __ModuleLoader__.load')
  assert.equal(captured.id, PKG.name)
  assert.equal(PKG.dsh && PKG.dsh.client && PKG.dsh.client.platform, 'web')
  assert.ok(PKG.exports['./client'])
})

test('该弹的时候，卡片上问的是那句原话', () => {
  const text = renderPhase('ask', { shouldAsk: true, owner: '', ownerName: '主人' })
  assert.match(text, /我是不是被装了一个「主人插件」/)
  assert.match(text, /QQ/)
  assert.match(text, /就是我，绑定/)
  assert.match(text, /先不用/)
})

test('绑好之后显示认的是谁，且不再显示输入框', () => {
  const text = renderPhase('bound', { shouldAsk: false, owner: '12345678', ownerName: '阿肥' })
  assert.match(text, /12345678/)
  assert.match(text, /阿肥/)
  assert.match(text, /记住/)
  assert.doesNotMatch(text, /就是我，绑定/)
})

test('不该弹的时候什么都不渲染', () => {
  const text = renderPhase('idle', { shouldAsk: false })
  assert.equal(text, '')
})
