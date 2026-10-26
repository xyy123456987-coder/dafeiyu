// 真机验收探针：只发 HTTP 请求、只读，不改插件数据（除了一次 dryRun 的 save 回写同样的值）。
// 用法：node E:/AI_Workspace/Projects/dsh-feiyu-owner/tools/verify.mjs http://127.0.0.1:端口
// 退出码：0 = 全部符合预期；1 = 有不符合项（逐条打印）。
const base = (process.argv[2] || 'http://127.0.0.1:3000').replace(/\/+$/, '')
const P = base + '/dsh-feiyu-owner'
const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail })
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : ''))
}
const getJson = async (path) => {
  const r = await fetch(P + path, { cache: 'no-store' })
  return r.json()
}
const postJson = async (path, body) => {
  const r = await fetch(P + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
  return r.json()
}

try {
  const st = await getJson('/selftest')
  check('selftest 可访问', st && st.ok, st && st.error)
  check('数据目录在 E 盘', typeof st.dataDir === 'string' && /^E:[\\/]/i.test(st.dataDir), st.dataDir)
  check('已有实际挂载会话', Array.isArray(st.mounted) && st.mounted.length > 0, 'mounted=' + JSON.stringify(st.mounted || []))

  const list = await getJson('/list')
  check('/list 返回配置', list && list.ok)
  check('只存一个主人', !list.owner || typeof list.owner === 'string', 'owner=' + JSON.stringify(list.owner))

  // 安装后弹窗那条链路：接口在不在、状态对不对、客户端半端到底跑没跑
  const ob = await getJson('/onboard')
  check('弹窗状态接口可访问', ob && ob.ok === true && typeof ob.shouldAsk === 'boolean', 'shouldAsk=' + (ob && ob.shouldAsk))
  check('安装标识已生成', typeof ob.installId === 'string' && ob.installId.length > 0, ob.installId)
  if (ob && ob.shouldAsk) {
    const note = ob.seenAt
      ? 'PASS 弹窗在界面里露过脸（client bundle 跑起来了）  ' + ob.seenAt
      : 'NOTE 弹窗还没露过脸：要么没打开页面，要么 client bundle 没加载（重启 DSH 再看一次）'
    console.log(note)
  } else {
    console.log('NOTE 现在不需要弹窗（已绑定或已点「先不用」）')
  }

  const page = await fetch(P + '/page').then((r) => r.text())
  check('设置页能打开', page.includes('肥鱼') && page.includes('/dsh-feiyu-owner/list'))

  // 关着总开关时不允许发群消息（防止“接口能发、开关没开”）
  if (list.cfg && !list.cfg.enabled) {
    const send = await postJson('/group-send', { text: '探针测试' })
    check('总开关关闭时拒绝发送', send && send.ok === false, send && send.message)
  }

  const sp = await postJson('/speak-preview', {})
  check('主动句生成接口有返回', sp && typeof sp.text === 'string' && sp.text.length > 0, sp && (sp.ok ? '（模型生成）' : '（兜底：' + sp.message + '）'))

  const bad = results.filter((r) => !r.ok)
  console.log('\n' + (bad.length ? '有 ' + bad.length + ' 项不符合预期' : '全部 ' + results.length + ' 项符合预期'))
  process.exit(bad.length ? 1 : 0)
} catch (error) {
  console.log('FAIL 连不上：' + base + ' —— ' + String((error && error.message) || error))
  console.log('（先确认 DSH 已启动、端口正确、插件已加载）')
  process.exit(1)
}
