/**
 * dsh-feiyu-owner · 浏览器半端 —— 装好之后**自动弹一次**「我是不是被装了一个主人插件」
 * ============================================================================
 * 为什么要有它（2026-10-26 使用者原话）：
 *   「安装完自动弹窗问我……但是我安装的时候你没有弹窗问我」
 *   ⇒ 只在对话里写一句「你的 QQ 是多少」是不够的：使用者可能根本没打开那个会话。
 *     界面自己开口，才叫"安装完就知道了"。
 *
 * 约定（照官方 client bundle 的写法，和 dsh-bili-scroll / blue-fat-fish 一致）：
 *   window.__ModuleLoader__.load({ id: '<包名>', factory(require) { ... } })
 *   · id 必须等于 package.json 的 name
 *   · 只 require('react')，别去 require 宿主的 UI 包
 *   · 渲染进 slot；**不往 document.body 挂第二个应用**
 *
 * 它只做三件事：问状态 → 弹卡片 → 提交绑定 / 点「先不用」。
 * 真正的判定与落盘全在宿主半端（lib/index.js 的 /onboard、/bind 两条路由），
 * 这样界面和对话兜底读的是同一份状态，不会两边各说各话。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-feiyu-owner',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const API = '/dsh-feiyu-owner'
    const SLOT = 'shell.overlay'

    const asJson = async (res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return res.json()
    }
    const jget = async (p) => asJson(await fetch(API + p, { credentials: 'same-origin' }))
    const jpost = async (p, body) =>
      asJson(
        await fetch(API + p, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body || {}),
        }),
      )

    const CSS = `
[data-fy-scrim]{position:fixed;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--dsw-alias-bg-mask-2,rgba(15,23,42,.45));backdrop-filter:blur(2px);}
[data-fy-card]{position:relative;width:min(440px,100%);box-sizing:border-box;padding:22px 22px 18px;border-radius:16px;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08));box-shadow:0 24px 64px rgba(0,0,0,.28);color:var(--dsw-alias-label-primary,#111);font-size:13px;line-height:20px;}
[data-fy-badge]{display:inline-flex;align-items:center;gap:6px;margin-bottom:10px;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-brand-primary,#4d6bfe);background:var(--dsw-alias-onboarding-card-fill,rgba(77,107,254,.10));}
[data-fy-title]{margin:0 0 10px;font-size:16px;line-height:24px;font-weight:600;color:var(--dsw-alias-label-primary,#111);}
[data-fy-body]{margin:0 0 12px;color:var(--dsw-alias-label-secondary,#525252);}
[data-fy-card] b{color:var(--dsw-alias-label-primary,#111);font-weight:600;}
[data-fy-input]{width:100%;box-sizing:border-box;margin:2px 0 6px;padding:9px 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#111);font-size:14px;line-height:20px;outline:none;font-family:inherit;}
[data-fy-input]:focus{border-color:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 0 0 2px rgba(77,107,254,.18);}
[data-fy-hint]{margin:0 0 14px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8a8a8a);}
[data-fy-err]{margin:0 0 12px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#d92d20);}
[data-fy-actions]{display:flex;align-items:center;gap:8px;justify-content:flex-end;}
[data-fy-primary]{padding:9px 16px;border:0;border-radius:10px;background:var(--dsw-alias-button-primary-fill,#4d6bfe);color:var(--dsw-alias-label-primary-inverted,#fff);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;}
[data-fy-primary]:disabled{opacity:.55;cursor:default;}
[data-fy-ghost]{padding:9px 14px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-radius:10px;background:transparent;color:var(--dsw-alias-label-secondary,#525252);font-size:13px;cursor:pointer;font-family:inherit;}
[data-fy-ghost]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.04));}
[data-fy-x]{position:absolute;top:10px;right:10px;width:26px;height:26px;display:flex;align-items:center;justify-content:center;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:16px;line-height:1;cursor:pointer;font-family:inherit;}
[data-fy-x]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));}
[data-fy-foot]{margin-top:12px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8a8a8a);}
`

    const QQ_RE = /^\d{4,15}$/

    /**
     * 卡片本体。phase：
     *   idle  → 什么都不渲染（没到该问的时候 / 已经关掉 / 已经绑好）
     *   ask   → 问「我是不是被装了主人插件」，收 QQ
     *   bound → 绑定成功，停两秒自己收回去
     */
    function Onboard() {
      const [phase, setPhase] = React.useState('idle')
      const [info, setInfo] = React.useState(null)
      const [qq, setQq] = React.useState('')
      const [name, setName] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const inputRef = React.useRef(null)
      const closeTimer = React.useRef(null)

      // 页面一进来问一次宿主状态。慢 600ms 是故意的：别跟首屏抢渲染。
      React.useEffect(() => {
        let alive = true
        const timer = setTimeout(() => {
          jget('/onboard')
            .then((r) => {
              if (!alive || !r || !r.shouldAsk) return
              setInfo(r)
              setName(String(r.ownerName || '主人'))
              setPhase('ask')
              // 只回报「露过脸」，不改是否再弹的判定
              jpost('/onboard', { action: 'seen' }).catch(() => {})
            })
            .catch(() => {})
        }, 600)
        return () => {
          alive = false
          clearTimeout(timer)
          if (closeTimer.current) clearTimeout(closeTimer.current)
        }
      }, [])

      // Esc = 这次先关掉（不写「先不用」，下次打开还会问）
      React.useEffect(() => {
        if (phase !== 'ask') return undefined
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          event.stopPropagation()
          setPhase('idle')
        }
        document.addEventListener('keydown', onKey, true)
        return () => document.removeEventListener('keydown', onKey, true)
      }, [phase])

      React.useEffect(() => {
        if (phase !== 'ask' || !inputRef.current) return
        try {
          inputRef.current.focus()
        } catch (e) {
          void e
        }
      }, [phase])

      if (phase === 'idle') return null

      const submit = async () => {
        const v = String(qq || '').trim()
        if (!QQ_RE.test(v)) {
          setError('QQ 号是 4~15 位数字，就一个。')
          return
        }
        setBusy(true)
        setError('')
        try {
          const r = await jpost('/bind', { ownerQq: v, ownerName: String(name || '').trim(), confirm: true })
          if (r && r.ok) {
            setInfo(Object.assign({}, info, { owner: r.owner, ownerName: r.ownerName || name, message: r.message }))
            setPhase('bound')
            closeTimer.current = setTimeout(() => setPhase('idle'), 2800)
          } else {
            setError(String((r && r.message) || '没绑上，再试一次。'))
          }
        } catch (e) {
          setError('连不上插件：' + ((e && e.message) || e))
        } finally {
          setBusy(false)
        }
      }

      const dismiss = async () => {
        setPhase('idle')
        try {
          await jpost('/onboard', { action: 'dismiss' })
        } catch (e) {
          void e
        }
      }

      const bound = phase === 'bound'
      return h(
        'div',
        { 'data-fy-scrim': '', role: 'presentation' },
        h('style', null, CSS),
        h(
          'div',
          {
            'data-fy-card': '',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': 'fy-owner-title',
          },
          h(
            'button',
            {
              'data-fy-x': '',
              type: 'button',
              title: '这次先关掉（下次打开还会问）',
              'aria-label': '这次先关掉',
              onClick: () => setPhase('idle'),
            },
            '×',
          ),
          h('div', { 'data-fy-badge': '' }, '肥鱼 · 专属主人'),
          h('h2', { 'data-fy-title': '', id: 'fy-owner-title' }, bound ? '好，记住啦。' : '咦，我是不是被装了一个「主人插件」？'),
          bound
            ? h(
                'p',
                { 'data-fy-body': '' },
                '以后我只认 ',
                h('b', null, String((info && info.owner) || '')),
                '，叫你「',
                h('b', null, String((info && info.ownerName) || '主人')),
                '」。别人照常聊，但你的事我记在心里。',
              )
            : h(
                'p',
                { 'data-fy-body': '' },
                '装好之后我会开始认主人：只认 ',
                h('b', null, '一个 QQ 号'),
                '，记得你说过的话；群里也先回你，别人照常回。',
              ),
          bound
            ? h('p', { 'data-fy-foot': '' }, '现在还是试运行：到 设置 →「肥鱼 · 专属主人」打开总开关，我才会真的记事、开口。')
            : h(
                'p',
                { 'data-fy-body': '' },
                '如果你是装它的人，把你的 QQ 号留给我 —— 只存在这台机器上，只认这一个。',
              ),
          bound
            ? null
            : h('input', {
                'data-fy-input': '',
                ref: inputRef,
                type: 'text',
                inputMode: 'numeric',
                autoComplete: 'off',
                maxLength: 15,
                placeholder: '你的 QQ 号，例如 12345678',
                value: qq,
                disabled: busy,
                onChange: (event) => {
                  setQq(String(event.target.value || '').replace(/[^\d]/g, ''))
                  setError('')
                },
                onKeyDown: (event) => {
                  if (event.key === 'Enter') submit()
                },
              }),
          bound
            ? null
            : h('input', {
                'data-fy-input': '',
                type: 'text',
                maxLength: 12,
                placeholder: '想让我怎么叫你？不填就叫「主人」',
                value: name,
                disabled: busy,
                onChange: (event) => setName(String(event.target.value || '').slice(0, 12)),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') submit()
                },
              }),
          bound ? null : h('p', { 'data-fy-hint': '' }, '只填数字；只锁一个号。群号不用在这里填。'),
          error ? h('p', { 'data-fy-err': '' }, error) : null,
          h(
            'div',
            { 'data-fy-actions': '' },
            bound
              ? null
              : h(
                  'button',
                  { 'data-fy-ghost': '', type: 'button', disabled: busy, onClick: dismiss },
                  '先不用',
                ),
            bound
              ? h(
                  'button',
                  { 'data-fy-primary': '', type: 'button', onClick: () => setPhase('idle') },
                  '知道了',
                )
              : h(
                  'button',
                  { 'data-fy-primary': '', type: 'button', disabled: busy, onClick: submit },
                  busy ? '记一下…' : '就是我，绑定',
                ),
          ),
          bound ? null : h('p', { 'data-fy-foot': '' }, '点了「先不用」我就不再自动问；以后想绑，去 设置 →「肥鱼 · 专属主人」。'),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots || typeof slots.inject !== 'function') {
          console.error('[feiyu-owner] slots 服务不可用，弹窗没挂上')
          return
        }
        slots.inject(SLOT, () =>
          slots.register({ name: SLOT, id: 'feiyu-owner-onboard', order: 60 }, Onboard),
        )
      },
    }
  },
})
