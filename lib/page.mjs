// 设置页（纯前端，静态字符串；数据走 /dsh-feiyu-owner/* 接口）
// 认主规则：只锁一个 QQ；群号可空；换主人要走绑定工具（force），页面不提供换人入口。
export const PAGE = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>肥鱼 · 专属主人</title><style>
body{background:#14161a;color:#dcdcdc;font:13px/1.7 "Microsoft YaHei",system-ui,sans-serif;margin:0;padding:18px 24px}
h1{font-size:17px;margin:0 0 2px}h2{font-size:14px;margin:20px 0 8px;border-bottom:1px solid #2a2d33;padding-bottom:4px}
.sub{color:#8a8a8a;font-size:12px;margin-bottom:14px}
button{background:#2a2d33;color:#dcdcdc;border:1px solid #3a3d44;border-radius:5px;padding:4px 10px;cursor:pointer;font-size:12px}
input{background:#1b1e23;color:#dcdcdc;border:1px solid #33373d;border-radius:5px;padding:3px 7px;font-size:12px}
table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;padding:5px 8px;border-bottom:1px solid #23262b;vertical-align:top}
th{color:#8a8a8a;font-weight:normal}.muted{color:#6f7681;font-size:11px}.tag{color:#8fd0a0}.warn{color:#d0a080}
</style></head><body>
<h1>🐟 肥鱼 · 专属主人</h1>
<div class="sub">只锁一个主人；认不出主人时，群里不会把任何人当主人。档案只写 E 盘。</div>
<div id="cfg"></div><div id="items"></div>
<script>
const $=id=>document.getElementById(id)
window.onerror=(m,s,l)=>{$('items').innerHTML='<div style="color:#c98080">JS 出错：'+m+'（第'+l+'行）</div>'}
async function api(p,body){
  const r=await fetch(p,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'})
  return r.json()
}
const ck=on=>on?' checked':''
let D=null
async function load(){
  D=await api('/dsh-feiyu-owner/list')
  const c=D.cfg||{}, g=D.group||{}
  $('cfg').innerHTML='<h2>绑定</h2>'+
    '<div>主人 QQ：<b>'+(D.owner||'（还没绑定）')+'</b> <span class="muted">换主人请在对话里让 Agent 覆盖绑定，页面不提供</span></div>'+
    '<div>称呼 <input id="ownerName" value="'+(c.ownerName||'主人')+'">　整理时间 <input id="digestAt" style="width:70px" value="'+(c.digestAt||'04:30')+'"></div>'+
    '<div>群号（可不填）<input id="groupId" style="width:140px" value="'+(g.groupId||'')+'">　群增强 <input type="checkbox" id="gEnabled"'+ck(g.enabled)+'>　只记日志 <input type="checkbox" id="gLogOnly"'+ck(g.logOnly)+'></div>'+
    '<div>OneBot 地址 <input id="baseUrl" style="width:220px" value="'+(g.baseUrl||'http://127.0.0.1:3000')+'">　群会话 id <input id="gSessions" style="width:240px" value="'+(g.sessionIds||[]).join(',')+'"></div>'+
    '<h2>开关</h2>'+
    '<div>总开关 <input type="checkbox" id="enabled"'+ck(c.enabled)+'>　试运行（不真发消息）<input type="checkbox" id="dryRun"'+ck(c.dryRun)+'></div>'+
    '<div>注入条数 <input id="maxItems" style="width:60px" value="'+(c.maxItems||6)+'">　字数上限 <input id="maxChars" style="width:70px" value="'+(c.maxChars||600)+'">'+
    '　主动搭话 <input type="checkbox" id="spEnabled"'+ck(c.speakUp&&c.speakUp.enabled)+'> 冷却分钟 <input id="spCd" style="width:70px" value="'+((c.speakUp&&c.speakUp.cooldownMinutes)||180)+'"></div>'+
    '<div style="margin-top:8px"><button onclick="save()">保存</button> <button onclick="digest()">立刻整理昨天</button> <button onclick="preview()">试写一句</button> <span id="msg" class="muted"></span></div>'+
    '<div class="muted">数据目录 '+(D.dataDir||'（未启用）')+'　defineTool '+(D.defineTool?'有':'无（标准 Schema）')+'</div>'
  const rows=(D.items||[]).map(x=>'<tr><td>'+x.kind+'</td><td class="muted">'+(x.key||'—')+'</td><td>'+x.text+'</td>'+
    '<td class="tag">'+(x.scope==='public'?'可公开':'私聊')+'</td><td>'+(x.supersededBy?'已作废':(x.pinned?'钉住':''))+'</td>'+
    '<td><button onclick="pin(\\''+x.id+'\\')">'+ (x.pinned?'取消钉':'钉住') +'</button> <button onclick="del(\\''+x.id+'\\')">删</button></td></tr>')
  $('items').innerHTML='<h2>专属档案（'+(D.items||[]).length+' 条）</h2>'+
    ((D.items||[]).length?'<table><tr><th>类型</th><th>键</th><th>内容</th><th>范围</th><th>状态</th><th></th></tr>'+rows.join('')+'</table>':
    '<div class="muted">还没有档案。绑好主人后，等第二天自动整理，或点「立刻整理昨天」。</div>')
}
async function save(){
  const body={enabled:$('enabled').checked,dryRun:$('dryRun').checked,ownerName:$('ownerName').value,
    digestAt:$('digestAt').value,maxItems:Number($('maxItems').value),maxChars:Number($('maxChars').value),
    speakUp:{enabled:$('spEnabled').checked,cooldownMinutes:Number($('spCd').value)},
    group:{groupId:$('groupId').value.trim(),enabled:$('gEnabled').checked,logOnly:$('gLogOnly').checked,
      baseUrl:$('baseUrl').value.trim(),sessionIds:$('gSessions').value.split(/[,，\\s]+/).filter(Boolean)}}
  const r=await api('/dsh-feiyu-owner/save',body)
  $('msg').textContent=r.ok?'已保存':'保存失败'; if(r.ok) load()
}
async function digest(){$('msg').textContent='整理中…';const r=await api('/dsh-feiyu-owner/digest',{});$('msg').textContent=r.ok?('整理完：新增 '+(r.added||0)+' 条'+(r.skipped?'（'+r.skipped+'）':'')):('失败：'+(r.message||''));load()}
async function preview(){$('msg').textContent='生成中…';const r=await api('/dsh-feiyu-owner/speak-preview',{});$('msg').textContent=r.ok?('它会说：'+r.text):('没生成出来：'+(r.message||''))}
async function del(id){if(!confirm('删掉这条？它的键会进黑名单，以后不再自动复活。'))return;await api('/dsh-feiyu-owner/delete',{id});load()}
async function pin(id){await api('/dsh-feiyu-owner/pin',{id});load()}
load()
</script></body></html>`
