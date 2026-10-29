#!/usr/bin/env bash
# ============================================================================
# qq-bot-scheduler —— 按 DeepSeek 峰谷时段调节 QQ 机器人节奏，并控制上下文大小
#
#   · 高峰（工作日 09:00-12:00、14:00-18:00，2 倍价）：上班摸鱼，1~2 小时看一次群
#   · 午休（工作日 12:00-14:00）：更安静，1.5~3 小时
#   · 闲时（其余时间、周末、节假日）：3~15 分钟随机
#   · 夜间（默认 23:00-08:00）：1~2 小时
#   · 自动换会话：只认本次会话的新调用，带冷却，防死循环
#
# 用法：qq-bot-scheduler [auto|status|report|force <mode>|rotate]
# ============================================================================
export PATH=/opt/node22/bin:/usr/local/bin:/usr/bin:/bin
export TZ=Asia/Shanghai

CONF=${QQ_SCHED_CONF:-/etc/qq-bot/schedule.conf}
STATE=/opt/qq-bridge/state/schedule-mode
LOG=/var/log/qq-schedule.log
TOKENS=/opt/qq-bridge/state/token-usage.jsonl
SESSION_MARK=/opt/qq-bridge/state/.session-started
ROTATE_MARK=/opt/qq-bridge/state/.last-rotate
API=http://127.0.0.1:3100
CT=$(cat /opt/qq-bridge/state/console-token 2>/dev/null)

log() { echo "$(date '+%F %T') $*" >> "$LOG"; }

[[ -f "$CONF" ]] || { echo "缺少配置 $CONF" >&2; exit 1; }
# shellcheck disable=SC1090
source "$CONF"

QQ_GROUPS=${QQ_GROUPS:-1045372529}
PEAK_WINDOWS=${PEAK_WINDOWS:-0900-1200,1400-1800}
LUNCH_WINDOWS=${LUNCH_WINDOWS:-1200-1400}
NIGHT_WINDOWS=${NIGHT_WINDOWS:-2300-0800}
HOLIDAYS=${HOLIDAYS:-/etc/qq-bot/holidays.txt}
MAKEUP_WORKDAYS=${MAKEUP_WORKDAYS:-/etc/qq-bot/workdays.txt}
ROTATE_AT_CACHE_TOKENS=${ROTATE_AT_CACHE_TOKENS:-80000}
ROTATE_HOURS=${ROTATE_HOURS:-8}
ROTATE_COOLDOWN_SEC=${ROTATE_COOLDOWN_SEC:-1800}

in_window() {
  local now=$1 range=$2 from to
  from=${range%-*}; to=${range#*-}
  if [[ ! "$from" > "$to" ]]; then
    [[ ! "$now" < "$from" && "$now" < "$to" ]]
  else
    [[ ! "$now" < "$from" || "$now" < "$to" ]]
  fi
}

resolve_mode() {
  local dow hhmm today workday=0 w n
  dow=$(date +%u); hhmm=$(date +%H%M); today=$(date +%F)
  if [[ -f "$MAKEUP_WORKDAYS" ]] && grep -qx "$today" "$MAKEUP_WORKDAYS"; then
    workday=1
  elif [[ "$dow" -le 5 ]]; then
    workday=1
  fi
  if [[ -f "$HOLIDAYS" ]] && grep -qx "$today" "$HOLIDAYS"; then workday=0; fi

  if [[ "$workday" == "1" ]]; then
    for w in ${LUNCH_WINDOWS//,/ }; do
      if in_window "$hhmm" "$w"; then echo lunch; return; fi
    done
    for w in ${PEAK_WINDOWS//,/ }; do
      if in_window "$hhmm" "$w"; then echo peak; return; fi
    done
  fi
  for n in ${NIGHT_WINDOWS//,/ }; do
    if in_window "$hhmm" "$n"; then echo night; return; fi
  done
  echo offpeak
}

apply_mode() {
  local mode=$1 g min max prob
  case "$mode" in
    peak)    min=$PEAK_MIN_MS;  max=$PEAK_MAX_MS;  prob=$PEAK_PROB ;;
    lunch)   min=$LUNCH_MIN_MS; max=$LUNCH_MAX_MS; prob=$LUNCH_PROB ;;
    night)   min=$NIGHT_MIN_MS; max=$NIGHT_MAX_MS; prob=$NIGHT_PROB ;;
    offpeak) min=$OFF_MIN_MS;   max=$OFF_MAX_MS;   prob=$OFF_PROB ;;
    *) echo "未知模式 $mode" >&2; return 1 ;;
  esac
  echo "$mode" > "$STATE"
  log "切换到 $mode（主动检查 $((min/60000))~$((max/60000)) 分钟，群随机概率 $prob）"

  curl -s -m 10 -X POST -H "x-console-token: $CT" -H 'content-type: application/json' \
    -d "{\"proactive\":{\"enabled\":true,\"checkIntervalMinMs\":$min,\"checkIntervalMaxMs\":$max,\"idleThresholdMs\":0,\"probability\":1}}" \
    "$API/api/socialV2/config" > /dev/null

  curl -s -m 10 -X POST -H "x-console-token: $CT" -H 'content-type: application/json' \
    -d '{"wake":{"preSleepWaitEnabled":false}}' "$API/api/socialV2/config" > /dev/null
  for g in ${QQ_GROUPS//,/ }; do
    curl -s -m 10 -X POST -H "x-console-token: $CT" -H 'content-type: application/json' \
      -d "{\"key\":\"group:$g\",\"config\":{\"triggers\":{\"probability\":$prob}}}" \
      "$API/api/socialV2/wake-config" > /dev/null
  done
  curl -s -m 10 -X POST -H "x-console-token: $CT" -H 'content-type: application/json' \
    -d '{"wake":{"preSleepWaitEnabled":true}}' "$API/api/socialV2/config" > /dev/null

  curl -s -m 10 -X POST -H "x-console-token: $CT" -H 'content-type: application/json' -d '{"paused":true}'  "$API/api/socialV2/activity" > /dev/null
  sleep 1
  curl -s -m 10 -X POST -H "x-console-token: $CT" -H 'content-type: application/json' -d '{"paused":false}' "$API/api/socialV2/activity" > /dev/null
}

latest_cache_hit_since_session() {
  local mark=0
  [[ -f "$SESSION_MARK" ]] && mark=$(cat "$SESSION_MARK" 2>/dev/null || echo 0)
  [[ -f "$TOKENS" ]] || { echo 0; return; }
  tail -40 "$TOKENS" | MARK="${mark:-0}" node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const mark=Number(process.env.MARK||0);
      let max=0;
      for(const l of s.trim().split("\n")){
        if(!l) continue;
        try{const j=JSON.parse(l);
          if(j.k !== "turn") continue;
          if(Number(j.t||0) <= mark*1000) continue;
          const h=Number((j.b&&j.b.cacheHit)||0);
          if(h>max) max=h;
        }catch(e){}
      }
      console.log(max);
    })'
}

rotate_session() {
  log "换会话：停止桥接 -> 清映射 -> 重启"
  systemctl stop qq-bridge.service
  sleep 2
  node -e '
    const fs=require("fs");
    const p="/opt/qq-bridge/state/sessions.json";
    const j=JSON.parse(fs.readFileSync(p,"utf8"));
    for (const k of Object.keys(j.sessions)) delete j.sessions[k];
    for (const k of Object.keys(j.sessionPolicies)) delete j.sessionPolicies[k];
    fs.writeFileSync(p,JSON.stringify(j,null,2));
  ' 2>/dev/null
  systemctl start qq-bridge.service
  date +%s > "$SESSION_MARK"
  date +%s > "$ROTATE_MARK"
}

maybe_rotate() {
  [[ -z "$CT" ]] && return
  local hit age_h since_rot=999999
  hit=$(latest_cache_hit_since_session)
  if [[ -f "$ROTATE_MARK" ]]; then
    since_rot=$(( $(date +%s) - $(cat "$ROTATE_MARK" 2>/dev/null || echo 0) ))
  fi
  age_h=0
  if [[ -f "$SESSION_MARK" ]]; then
    age_h=$(( ( $(date +%s) - $(cat "$SESSION_MARK" 2>/dev/null || echo 0) ) / 3600 ))
  fi
  if [[ "$since_rot" -lt "$ROTATE_COOLDOWN_SEC" ]]; then return; fi
  if [[ "${hit:-0}" -gt "$ROTATE_AT_CACHE_TOKENS" ]]; then
    log "本会话上下文 ${hit} tokens 超过 ${ROTATE_AT_CACHE_TOKENS}，换会话"
    rotate_session
  elif [[ "$age_h" -ge "$ROTATE_HOURS" ]]; then
    log "会话已持续 ${age_h} 小时（阈值 ${ROTATE_HOURS}），换会话"
    rotate_session
  fi
}

cmd=${1:-auto}

case "$cmd" in
  status)
    mode=$(cat "$STATE" 2>/dev/null || echo "未应用")
    echo "时间：$(date '+%F %T')（周$(date +%u)）"
    echo "判定：$(resolve_mode)    当前生效：$mode"
    echo "高峰：$PEAK_WINDOWS   午休：$LUNCH_WINDOWS   夜间：$NIGHT_WINDOWS"
    echo "群：$QQ_GROUPS"
    echo "本会话上下文：$(latest_cache_hit_since_session) tokens（>${ROTATE_AT_CACHE_TOKENS} 换会话）"
    if [[ -n "$CT" ]]; then
      curl -s -m 8 -H "x-console-token: $CT" "$API/api/socialV2/config" | node -e '
        let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
          try{const j=JSON.parse(s).config;
            console.log("桥上主动检查："+(j.proactive.checkIntervalMinMs/60000)+"~"+(j.proactive.checkIntervalMaxMs/60000)+" 分钟");
          }catch(e){console.log("桥上配置读取失败")}
        })' 2>/dev/null
    fi
    exit 0 ;;

  force)
    m=${2:-auto}
    [[ "$m" == "auto" ]] && m=$(resolve_mode)
    apply_mode "$m"
    echo "已切换到 $m"
    exit 0 ;;

  rotate)
    rotate_session
    echo "已换会话"
    exit 0 ;;

  report)
    echo "=== $(date +%F) 用量简报 ==="
    echo "发言成功：$(grep -c '工具统一发送' /opt/qq-bridge/bridge.out 2>/dev/null || echo 0) 次"
    echo "被唤醒：$(grep -c '唤醒 group' /opt/qq-bridge/bridge.out 2>/dev/null || echo 0) 次"
    echo "当前模式：$(cat "$STATE" 2>/dev/null || echo 未应用)"
    if [[ -f "$TOKENS" ]]; then
      node -e '
        const fs=require("fs");
        const lines=fs.readFileSync("/opt/qq-bridge/state/token-usage.jsonl","utf8").trim().split("\n").filter(Boolean);
        let sum={};
        for(const l of lines){
          try{const j=JSON.parse(l); if(j.k!=="turn") continue;
            const h=new Date(j.t).getHours(); const b=j.b||{};
            const s=sum[h]||(sum[h]={calls:0,miss:0,hit:0,out:0});
            s.calls++; s.miss+=Number(b.cacheMiss||0); s.hit+=Number(b.cacheHit||0); s.out+=Number(b.output||0);
          }catch(e){}
        }
        for(const h of Object.keys(sum).map(Number).sort((a,b)=>a-b))
          console.log(String(h).padStart(2,"0")+"时", "调用"+sum[h].calls, "缓存"+sum[h].hit, "输出"+sum[h].out);
      ' 2>/dev/null
    fi
    exit 0 ;;
esac

desired=$(resolve_mode)
current=$(cat "$STATE" 2>/dev/null || echo "")
[[ "$desired" != "$current" ]] && apply_mode "$desired"

maybe_rotate

if [[ -f "$LOG" ]] && [[ "$(stat -c %s "$LOG")" -gt 1048576 ]]; then
  tail -1000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi
