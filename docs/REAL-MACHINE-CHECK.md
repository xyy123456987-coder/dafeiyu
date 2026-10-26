# 真机验收清单（dsh-feiyu-owner）

两条纪律：**所有运行期数据只落 E 盘**；**没实际看到结果的不算通过**。
测试运行环境建议隔离在 `E:/AI_Workspace/Temp/feiyu-dsh-runtime/`（Codex 已在建）。

## 0. 前置

- 独立 DSH 运行环境（不要用你日常那个 profile），`DSH_HOME` 指到 E 盘临时目录。
- 插件目录：`E:/AI_Workspace/Projects/dsh-feiyu-owner/`（挂载方式按你的 DSH 版本，**我这边没核实过入口**）。
- 数据目录：插件只写 `E:/AI_Workspace/Data/feiyu-owner/`；也可设 `FEIYU_OWNER_DATA_DIR`（必须 E 盘）。

## 1. 加载与启动

| 检查 | 怎么看 | 期望 |
|---|---|---|
| 插件被加载 | 控制台/日志里有 `apply 启动` | 有一行，含 dataDir 路径 |
| 数据目录正确 | 打开 `E:/AI_Workspace/Data/feiyu-owner/log.jsonl` | 文件存在，第一行 `apply 启动` |
| 没写别处 | 看 `%USERPROFILE%\.dsh\` 下有没有 `feiyu-owner*` | **不应出现**任何本插件文件 |
| agent 挂载 | `GET /dsh-feiyu-owner/selftest` | `mounted` 里有当前会话 id 与 mode |

## 1.5 安装后弹窗（0.2.0 的新东西，必须先过这条）

1. **重启 DSH**（界面那半是启动时扫进模块图的，不重启不会出现）。
2. 打开界面、什么都别点。期望：约 1 秒内浮出一张卡片，问「咦，我是不是被装了一个「主人插件」？」。
3. 填自己的 QQ → 点「就是我，绑定」。期望：卡片变成「好，记住啦」，两秒后自己收起；
   `GET /dsh-feiyu-owner/list` 里 `owner` 是那个号。
4. 再开一次界面：**不再弹**。
5. 若第 2 步没弹，按顺序查：
   - `log.jsonl` 有 `界面来问首次绑定状态：该弹窗` → 前端跑到了，问题在渲染（开开发者工具看 `slot entry crashed` / `[feiyu-owner]` 报错）；
   - 一行都没有 → client bundle 没被扫到：确认重启过、`package.json` 里 `dsh.client.platform === 'web'`、
     `node -e "console.log(require.resolve('dsh-feiyu-owner/client'))"`（在 profile 目录里跑）能解析到 `lib/client.js`。
6. 想重来一遍：把 `config.json` 里的 `onboardDismissedAt` / `onboardSeenAt` 删掉（或整个 config 挪走），再重开界面。

## 2. 首次绑定（核心流程）

1. 新建一个普通对话（非群会话），发一句「你好」。
2. 期望：agent 主动问「你的 QQ 号是多少？我记下来，以后只认你」——**只问一次**。
3. 回「12345678」。期望：agent 调 `feiyu_owner_setup` 并存下；`GET /list` 里 `owner=12345678`。
4. 再说「我 QQ 是 87654321」→ 期望被拒绝或被要求确认（不能悄悄换）。
5. 重启 DSH → `GET /list` 里 `owner` **仍是 12345678**（重启后保留）。
6. 群里（`group.sessionIds` 里的会话）发消息 → **不应**出现认主询问。

## 3. 自动探针（一条命令看 HTTP 面）

```
node E:/AI_Workspace/Projects/dsh-feiyu-owner/tools/verify.mjs http://127.0.0.1:<端口>
```

覆盖：selftest 可达、数据目录在 E 盘、/list 可用、设置页能打开、总开关关闭时拒绝发群消息、主动句接口有返回。
**退出码 0 才算这一层通过**；脚本本身是我写的、还没跑过。

## 4. 每日整理

- 手动触发：`POST /dsh-feiyu-owner/digest` → 期望 `{ok:true, day:"昨天", added:n}`，并在 `digests/` 下生成文件。
- 前提：绑定的主人会话里，前一天要有真实对话；没有就应返回 `skipped:"no-messages"` 而不是报错。
- 看 `profile.json`：条目应有 `source`（出处）、`scope`（private/public）。

## 5. 群链路（需要 OneBot）

1. 设置页填群号、OneBot 地址（默认 `http://127.0.0.1:3000`），`logOnly` 保持开。
2. `POST /group-check` → 期望返回机器人账号信息；带 `{text:"某条刚发的原文"}` 时看 `resolve`：
   能唯一匹配 → `{ok:true,qq:...}`；匹配不到或多人同文 → `{ok:false,reason:...}`。
3. 关掉 `logOnly` 后再 `POST /group-send` → 期望群里收到一条只在开头 @ 主人、其余纯文字的消息。
4. 群消息隐私：群里问「他私聊跟你说过什么」→ 期望不复述 private 条目。

## 6. 已知会被判为「不通过」的情形

- 群里消息量大、撤回、或两个人发了同样的话 → 反查会失败，此时**不认主人**（这是设计，不是 bug，但要在验收记录里写明）。
- 没有 E 盘、或 `FEIYU_OWNER_DATA_DIR` 指到别的盘 → 插件整体拒写（设计如此）。
- 真实 DSH 若不接受普通 JSON Schema 工具定义 → `defineTool` 字段会显示“无”，绑定工具可能不出现，这是已知风险点。
