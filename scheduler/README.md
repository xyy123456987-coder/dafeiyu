# qq-bot-scheduler

按 **DeepSeek 峰谷时段** 自动调节 QQ 机器人的「上班 / 摸鱼」节奏，并在上下文膨胀时自动换会话，帮机器人省 token 钱。

配套 qq-bridge / DSH 使用（通过桥接的本地控制台 API 改配置，不改源码）。

---

## 它解决什么问题

1. **峰谷价差**：DeepSeek 高峰时段（北京时间工作日 09:00–12:00、14:00–18:00）价格是闲时的 **2 倍**。白天聊得多最贵。
2. **上下文膨胀**：DSH 会话会把整段历史反复送进模型。实测 800 次调用里，**缓存命中 3.03 亿 tokens**（命中率 99.5%），单次上下文一度到 **54 万 tokens** —— 这才是账单大头。
3. **半夜刷 token**：没人说话的时段它还在定时醒。

---

## 四种模式

| 模式 | 触发时间 | 主动看群 | 群消息随机唤醒 |
|---|---|---|---|
| 🐟 `peak` 上班摸鱼 | 工作日 09:00–12:00、14:00–18:00 | **60~120 分钟**一次 | 1% |
| 😴 `lunch` 午休 | 工作日 12:00–14:00 | **90~180 分钟**一次 | 0.5% |
| 🐠 `offpeak` 下班正常 | 其余时间、周末、法定节假日 | **3~15 分钟**随机 | 3% |
| 🌙 `night` 夜间 | 默认 23:00–08:00 | **60~120 分钟**一次 | 1% |

节假日、调休上班日可通过两个文件覆盖（见下）。

## 人设也跟着时段走

节奏只是“多久看一次群”，口气由人设决定。配套的 `qq-bot-scheduler` 假定
`qq-chat-v2` 人设里已经写了这三段（本仓库不含人设文件，它属于 qq-bridge 的 agent preset）：

- **上班（9-12、14-18）**：摸鱼 + 脾气大。能不回就不回，回也敷衍、短、不耐烦（“在忙”“等会儿”），被催更烦；不解释、不道歉。
- **午休（12-14）**：基本不理，真被叫到就一句“困死了”。
- **下班（18 点后、周末）**：正常放松，愿意接梗、话多一点。

外加一组「更像人」的约束：短句口语、偶尔错字、别用敬语和总结腔、允许已读不回/答非所问、有情绪、可以用“草/绷不住”和表情包。


## 自动换会话

每轮都会读最近一次调用的缓存输入量：

- 单次 **缓存输入 > 20 万 tokens**（可配）→ 换新会话
- 或会话已持续 **> 12 小时**（可配）→ 换新会话

换会话 = 停桥接 → 清 `state/sessions.json` 映射 → 起桥接。上下文归零，代价是它忘掉之前的聊天（但每次唤醒本来只读最近 5 条，影响很小）。

---

## 安装

```bash
# 1. 把本目录放到服务器上，例如 /opt/qq-bot-scheduler
sudo ./install.sh
```

`install.sh` 会做四件事：

1. 拷贝主脚本到 `/opt/bin/qq-bot-scheduler`
2. 首次安装时生成 `/etc/qq-bot/schedule.conf`
3. 装 `qq-schedule.service` + `qq-schedule.timer`（每分钟跑一次）
4. 建空的 `holidays.txt` / `workdays.txt`

依赖：`systemd`、`node`（读 JSON）、`curl`，以及本机可用的桥接控制台（默认 `127.0.0.1:3100`，令牌取 `state/console-token`）。

## 命令

```bash
qq-bot-scheduler            # 自动判定并应用（timer 调的就是它）
qq-bot-scheduler status     # 现在什么模式、桥上实际参数、当前上下文大小
qq-bot-scheduler report     # 今日发言/唤醒次数 + token 明细（缓存命中率）
qq-bot-scheduler force peak # 手动强制 peak / offpeak / night / auto
qq-bot-scheduler rotate     # 立刻换会话（上下文清零）
```

## 配置（`/etc/qq-bot/schedule.conf`）

```bash
QQ_GROUPS="1045372529"                 # 要调度的群，逗号分隔
PEAK_WINDOWS="0900-1200,1400-1800"     # 高峰窗口
PEAK_MIN_MS=3600000                    # 摸鱼：1 小时
PEAK_MAX_MS=7200000                    # 摸鱼：2 小时
PEAK_PROB=0.01
OFF_MIN_MS=60000                       # 闲时：1 分钟
OFF_MAX_MS=600000                      # 闲时：10 分钟
OFF_PROB=0.05
NIGHT_WINDOWS="2300-0800"
NIGHT_MIN_MS=1800000
NIGHT_MAX_MS=5400000
NIGHT_PROB=0.01
ROTATE_AT_CACHE_TOKENS=200000          # 单次缓存输入超过就换会话
ROTATE_HOURS=12                        # 会话最长存活小时数
HOLIDAYS=/etc/qq-bot/holidays.txt      # 每行 YYYY-MM-DD
MAKEUP_WORKDAYS=/etc/qq-bot/workdays.txt
```

节假日/调休：

```bash
echo 2026-10-01 | sudo tee -a /etc/qq-bot/holidays.txt      # 这天按闲时
echo 2026-10-11 | sudo tee -a /etc/qq-bot/workdays.txt      # 这周日按工作日（调休）
```

---

## 实现要点

- **不动桥接源码**：全部通过 `http://127.0.0.1:3100/api/socialV2/*` 改运行时配置。
- **改完立刻生效**：改主动检查间隔后，用 `activity paused:true→false` 重排每个会话的定时器。
- **绕过闸门**：写群的随机概率会被「沉睡前观察」拦截，脚本临时关掉 `preSleepWaitEnabled`、写完立刻恢复。
- **不受限频影响**：脚本自己不做唤醒，只调参数；真正唤醒仍由桥接按新参数执行。
- **幂等**：当前模式没变就直接退出，不会每分钟重复打 API。

## 实测（2026-10-28）

```
发言成功：222 次
被唤醒：1270 次（繁忙排队 892 次）
近期 800 次调用：输入未命中 1,618,578 / 命中缓存 303,551,488 tokens（99.5%）
输出 118,730 tokens
单次缓存输入峰值：546,048 tokens  → 触发换会话
```

也就是说：**真正贵的是“每轮都把几十万 token 的上下文重发一遍”**，换会话是这里最有效的一刀。

## 已知限制

- 依赖桥接的控制台 API 与 `state/console-token`，换桥接版本时接口可能变。
- 换会话会丢对话记忆（只影响“记得之前聊过什么”，不影响读最近 5 条）。
- 节假日需要手工维护（法定节假日安排每年不同）。
