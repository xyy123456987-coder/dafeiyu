# 更新记录（dsh-feiyu-owner）

## 0.2.0 · 2026-10-26

**这次的主题：安装完要自己开口。**
使用者原话：「安装完自动弹窗问我……但是我安装的时候你没有弹窗问我」。

### 新增

- **界面弹窗（浏览器半端 `lib/client.js`）**：装好、重启 DSH、打开界面后，`shell.overlay`
  里自动出现一张卡片，问「咦，我是不是被装了一个「主人插件」？」，填 QQ 号点「就是我，绑定」当场绑上。
  - 「先不用」= 以后不再自动问（`onboardDismissedAt` 落盘）；
  - 右上角 × / Esc = 这次先关掉，下次打开还会问。
- **宿主两条新路由**：`GET /dsh-feiyu-owner/onboard`（该不该弹）、
  `POST /dsh-feiyu-owner/onboard`（`seen` / `dismiss`）、`POST /dsh-feiyu-owner/bind`（本地绑定）。
  绑定接口只认**本机回环地址**；已绑定时换别人的号一律拒。
- **安装标识**：`installId` / `installedAt`，用来区分「这一次安装」和上一版留下的旧标记。
- **对话兜底**：界面那半没起来时，agent 在非群会话里仍会问一次；上一版留下的
  `onboardedAskedAt` 早于这次 `installedAt`，所以升级上来不会两条路都哑掉。

### 修

- **绑定工具此前根本没挂上**（真机日志实证：`tool "feiyu_owner_setup" must declare output { schema, render, presentationMeta? }`）。
  照宿主 `dsh-tools` 源码改了两处：
  - `output.presentationMeta` 传的是**对象**，宿主校验要求它是**函数** → 现在不声明它，用默认卡片；
  - `parameters` 在 `defineTool` 路径要吃「属性表」，在普通定义路径要吃**完整 JSON Schema** → 两条路各按各的形状给。
- 设置页 / 自检接口多带了 onboarding 状态（`/selftest` 的 `onboard` 字段）。
- `tools/verify.mjs` 增加 `/onboard` 探针，并明确打印「弹窗在界面里露过脸没有」。

### 验证到哪一步

- `node --check`：10 个代码文件全过。
- `node --test`：31 项全过（纯逻辑 + 假 ctx 跑真实路由 + 假 React 渲染卡片文案）。
- 包在 profile 里能解析到 `lib/client.js`；`__ModuleLoader__.load` 的 id 与包名一致。
- **没验证**：真实浏览器里那张卡片的样子与点击 —— 需要重启 DSH 后由使用者确认。
