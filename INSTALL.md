# 安装与分发说明（dsh-feiyu-owner）

> 这一版**没有在真实 DSH 里装过**，下面写「该怎么做」和「哪一步没核实」。别把本文当成已验证的安装手册。

## 一、包是什么

一个 DSH 插件文件夹，结构和 `dsh-fish-memory`、`dsh-speak-up` 同类：

```
dsh-feiyu-owner/
  package.json        main=lib/index.js，dsh.bundle.patch=cordis.patch.yml
  cordis.patch.yml    加载声明
  lib/                core / store / host / digest / speak / onebot / tool / page / index
  tests/              core.test.mjs、speak.test.mjs
  README.md  INSTALL.md
```

## 二、接收者怎么装

1. 解压到固定位置（**建议 E 盘**，例如 `E:/AI_Workspace/Plugins/dsh-feiyu-owner/`），
   `package.json` 必须就在这一层。
2. 用 DSH 挂载本地插件目录（`plugin_manager` 的 install_bundle，或按你 DSH 版本的方式）。
3. **重启一次 DSH**。界面那半（`lib/client.js`）是启动时扫进模块图的：
   装完不重启，弹窗不会出现 —— 2026-10-26 那次"我装的时候你没弹窗问我"，原因之一就是这一层还没被扫到。
4. 打开界面：应该自动弹一张卡片问「我是不是被装了一个「主人插件」？」。
   没弹就看 `E:/AI_Workspace/Data/feiyu-owner/log.jsonl`：
   - 有 `界面来问首次绑定状态：该弹窗` → 前端跑到了、但可能被别的层挡住（开开发者工具看报错）；
   - 一行都没有 → client bundle 没加载（确认重启过、`package.json` 里有 `dsh.client`）。
5. 打开设置页：`http://127.0.0.1:<DSH 端口>/dsh-feiyu-owner/page`（端口是 DSH 的 webServer 端口）。
6. 数据只写 `E:/AI_Workspace/Data/feiyu-owner/`；没有 E 盘会整体拒写。换位置设
   `FEIYU_OWNER_DATA_DIR`，同样必须 E 盘。

## 三、首次绑定（两条路，结果一样）

**A. 界面弹窗（推荐）**：装完重启 → 打开 DSH → 卡片里填 QQ 号 → 点「就是我，绑定」。
卡片上的「先不用」= 以后不再自动问，只能在设置页手动绑；右上角 × 和 Esc = 这次先关掉，下次打开还会问。

**B. 对话里说**（界面那半没起来时兜底，只问一次）：
装好后未绑定时，agent 会主动问一句「你的 QQ 号是多少？我记下来，以后只认你」，
对方回答后 agent 调 `feiyu_owner_setup` 保存。等价的手动说法：

> 帮我把主人绑定成 12345678，confirm=true

只锁一个 QQ；给多个会被拒绝；要换人得加 `force=true`，且只能在本地非群会话里做；
群会话里调用一律被拒——群里谁自称主人都改不了绑定。
群号可以不填：`groupId` 空着就自动关群增强，之后在设置页或对话里补。

> 绑定接口（`POST /dsh-feiyu-owner/bind`）只接受**本机回环地址**的请求；已绑定时想换另一个号会被拒。

## 四、验收清单（接收者自查）

| 场景 | 期望 |
|---|---|
| 装完重启、打开界面（还没绑） | **自动弹卡片**，问「我是不是被装了一个「主人插件」」 |
| 卡片里填对的 QQ → 绑定 | 卡片变成「好，记住啦」；`/list` 里 `owner` 是它 |
| 卡片里点「先不用」→ 再打开 | 不再自动弹；`config.json` 有 `onboardDismissedAt` |
| 已绑好后再打开 | 不弹 |
| 把 `FEIYU_OWNER_DATA_DIR` 指到 C 盘 | 不写任何文件，控制台一行拒绝 |
| 界面那半没起来时首次对话 | agent 主动问 QQ，且只问一次、群里不问 |
| 说「我 QQ 是 A，也是 B」 | 被拒绝，要求只留一个 |
| 试运行开着、等主动开口 | `log.jsonl` 有「本来要说什么」，QQ 里没消息 |
| 第二天看设置页 | 出现带出处的主人/近况条目 |
| 群里问「他私聊跟你说啥」 | 不复述 private 条目 |
| 群里发一条看不出是谁的消息 | 不把任何人当主人 |
| 设置页点「试写一句」 | 出现一句像它自己说的话（不发送） |

## 五、交付前检查状态

- 语法：10 个代码文件（含 `lib/client.js`）`node --check` 全过。
- 测试：26 项通过 —— 纯逻辑（含弹窗判定、QQ 校验）+ 假 ctx 把 `apply()` 跑起来打 `/onboard`、`/bind` 的真实路由 + 假 React 渲染卡片文案。
- 已核实：包在 profile 里能解析到 `lib/client.js`（`require.resolve('dsh-feiyu-owner/client')`），
  `__ModuleLoader__.load` 的 id 与包名一致；宿主 `dsh-tools` 源码里 `output.presentationMeta` 必须是函数（旧版传对象 → 整条工具被拒，已改）。
- **未验证**：真实浏览器里那张卡片的样子与点击（要重启后由使用者确认）、真实 OneBot 收/发、模型现写主动句的实际语气。
- 压缩包：旧 `0.1.0-preview.zip` 不代表本次修改。
