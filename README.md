# Citely Reader

一个通过 **x402 微支付协议**阅读 x402write 付费专家报告的 AI 代理。它用 **Cobo Agentic Wallet** 按需支付小额 USDC，读取报告正文与配套资料（companion），再用中文给出带引用的风险教育回答。聚焦 Web3 法律 / 合规 / 安全风险，**不构成法律意见**。

> 技术栈：Next.js 15（App Router）· React 19 · TypeScript（strict）· Vercel AI SDK · Cobo Agentic Wallet（`caw` CLI）

---

## 1. 整体设计

```
用户提问
  │
  ▼
Next.js 应用（app/api/agent，NDJSON 流式）
  │  readPaidReport()  ── 注入 pay 回调
  ▼
x402write 报告 API ──402──► 校验付费要求 ──► Cobo 钱包付费 ──► 重试取正文
  │                                              （caw fetch，pact 授权）
  ▼
Vercel AI SDK 生成回答（仅基于已购内容）── 落盘 content/companion/citation
```

核心理念：**支付授权的硬边界在 Cobo pact，而不是在应用代码里。** 应用侧的本地校验只是纵深防御，真正能不能花钱、花多少、花在哪条链，由 Cobo 服务端按 pact 策略强制执行。

### 阅读流程（`lib/x402write.ts#readPaidReport`）

```
解析输入（slug / URL / 自然语言）
  → 命中缓存？直接返回，不付费
  → GET 报告 read 路径
      → 200：免费内容，直接读
      → 402：解析 Payment-Required 头
  → 本地校验付费要求（网络/资产白名单、单篇上限、禁止自付、scheme=exact）
  → pay()：通过 Cobo 付费拿到 PAYMENT-SIGNATURE
  → 解析付费正文，或带签名重试 GET
  → 写缓存 + 落盘（content.md / companion.md / citation.json）
```

一个有意的设计点：当自然语言查询匹配到**多篇**报告时，`resolveReport` 会在**付费之前**抛出 `MultipleReportsMatchError`，让用户先选，避免误付费。

### 为什么 `pay` 是注入的回调

`readPaidReport` 不直接 import Cobo，而是把付费函数作为参数传入。好处：
- 读取 / 校验逻辑与具体钱包实现解耦，易测试；
- 可以按部署环境替换支付后端（本地用 `caw` CLI，未来可换 HTTP 网关）。

---

## 2. 关键设计决策

| 决策 | 说明 |
|---|---|
| **pact 是授权边界** | 预算、单篇上限、链/资产范围、24h 滚动限额都写在 Cobo pact 里，服务端强制。本地 `validatePaymentRequirement` 只是提前拦截明显不合规的请求。 |
| **金额用 BigInt 基础单位** | USDC 6 位小数，金额比较一律用整数基础单位（`lib/money.ts`），不碰浮点。 |
| **回答只基于已购内容** | `generateRiskAnswer` 的 system prompt 硬约束模型只能引用 `content`/`companion`，并强制附上引用行和免责声明；无 `OPENAI_API_KEY` 时回退到确定性模板。 |
| **存储抽象（双模式）** | `lib/storage.ts`：本地用文件系统（`downloads/`），设了 `BLOB_READ_WRITE_TOKEN` 则用 Vercel Blob。见下方部署。 |
| **付费可优雅禁用** | `PAYMENTS_ENABLED=false` 时不调用 `caw`，配对状态返回 `disabled`，付费报告给出友好提示，免费内容仍可读。用于 serverless 部署。 |

---

## 3. 部署设计

### 为什么不能"纯 serverless"

支付路径依赖 **`caw` CLI 二进制**（`lib/cobo.ts` 用 `execFile` 调用它做付费和查 pact 状态）。Vercel 等 serverless 平台**无法运行任意 CLI**，且文件系统只读、跨实例不持久。因此本工程对部署做了分层设计：

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│ Vercel（前端 + 免费路由）    │        │ 常驻主机（有 caw）            │
│ - 目录搜索 / 历史展示        │  HTTP  │ - 付费 sidecar / caw 网关     │
│ - 存储走 Vercel Blob         │ ─────► │ - 公网 x402write 服务         │
│ - PAYMENTS_ENABLED=false     │        │   （付费真正发生的地方）       │
└─────────────────────────────┘        └──────────────────────────────┘
```

- **当前已实现**：前端 + 存储（Blob）+ 付费优雅禁用 —— 可直接部署到 Vercel 做展示，免费内容可读，付费报告明示"未上线"。
- **后续要真正在线付费**：在常驻主机上跑 `caw payment gateway`（官方 x402/MPP 代理）或一个内部调 `caw` 的小 sidecar，把应用的 `pay` 回调指向它。

### 存储抽象

| 环境 | 后端 | 触发条件 |
|---|---|---|
| 本地开发 | 文件系统 `downloads/<slug>/` | `BLOB_READ_WRITE_TOKEN` 未设 |
| Vercel | Vercel Blob | `BLOB_READ_WRITE_TOKEN` 已设 |

`saveReportFiles`、history/activity、下载路由全部经由 `lib/storage.ts`，对调用方透明。

---

## 4. 本地运行

```bash
cp .env.example .env.local   # 填入密钥；.env.local 已被 gitignore，勿提交
npm install
npm run dev                  # 开发服务器
npm run build                # 同时是类型检查门禁（tsconfig noEmit）
npm test                     # node --test，跑 tests/*.test.mjs
```

付费功能需要：`COBO_API_KEY` / `COBO_WALLET_UUID` / 已审批的 `COBO_PACT_ID`，以及本机安装 `caw` CLI。Cobo 钱包的付款地址不能与文章作者的 `payTo` 相同（否则 x402write 拒绝自付）。

## 5. 环境变量要点

完整清单见 `.env.example`。部署到 Vercel 时需特别注意：

- **密钥在 Vercel 面板配置**（Settings → Environment Variables），不要提交。
- `PAYMENTS_ENABLED=false` —— serverless 上必须，否则 `caw` 调用会报错。
- `BLOB_READ_WRITE_TOKEN` —— 启用 Vercel Blob 存储。
- `X402WRITE_BASE_URL` —— 必须是**公网**地址，不能是 `localhost`。
- `X402_ARTICLE_PATH_PREFIX` —— Solana 报告走 `/api/v1/sol/articles`，Base 走 `/api/v1/articles`，需与目标服务一致。

---

## 6. 更详细的架构说明

面向后续开发者的深入文档见 [`CLAUDE.md`](./CLAUDE.md)，包含两条 Cobo 支付路径、目录搜索与阅读路径的一致性约束、计划文档与实现的已知差异等。
