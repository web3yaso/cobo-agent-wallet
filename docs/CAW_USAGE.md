# 使用 CAW(Cobo Agentic Wallet)的关键代码与配置

本文说明 Citely Reader 如何通过 **Cobo Agentic Wallet** 用 USDC 微支付付费阅读 x402write 报告。CAW 在本项目里通过 **`caw` CLI**(子进程)调用,核心代码在 `lib/cobo.ts`,配置在 `lib/config.ts`。

> 注:本地 `lib/payment-requirements.ts#validatePaymentRequirement` 的网络/资产/限额校验只是 defense-in-depth,**真正的授权边界是 Cobo pact**,由钱包侧执行。

## 一、入口:live 路径是 `cawFetchX402`

`lib/cobo.ts` 的 `cawFetchX402` 是真正接入 agent 路由的付费函数。它用 `execFile` 调起 `caw` 命令行,而不是直接打 Cobo API:

```ts
const args = [
  "fetch", COBO_PACT_ID, readUrl,   // pact 必填,CLI 强制校验
  "--protocol", "x402",
  "--network",  requirement.network || X402_NETWORK,
  "--asset",    requirement.asset,
  "--max-amount", String(MAX_REPORT_BASE_UNITS),  // 单位:USDC base units(6 位小数)
  "--output", "body",
  "--api-url", COBO_BASE_URL,
].filter(v => v !== "");

await execFileAsync(CAW_BIN, args, {
  timeout: 60_000,
  maxBuffer: 10 * 1024 * 1024,
  env: { ...process.env, AGENT_WALLET_API_URL: COBO_BASE_URL },  // CLI 读这个 env
});
```

要点:

- **pact 是硬授权边界**:`COBO_PACT_ID` 缺失直接抛错。本地校验只是 defense-in-depth,实际限额由 Cobo 钱包侧的 pact 执行。
- **金额单位**:`--max-amount` 用的是整数 base units(`MAX_REPORT_BASE_UNITS = MAX_REPORT_USDC × 10⁶`),金额比较走 `BigInt`,绝不用浮点。
- **错误脱敏**:`caw_*` token 在向外抛出前会被替换为 `caw_[REDACTED]`。
- **注入式设计**:`readPaidReport`(`lib/x402write.ts`)把 `pay` 作为参数传入,路由注入的就是 `cawFetchX402` —— 让读取/校验逻辑与 Cobo 解耦、可测试。

## 二、配对状态:`getCoboPairingStatus` → `caw pact status`

`getCoboPairingStatus` 调用:

```
caw pact status --pact-id <COBO_PACT_ID> --api-url <COBO_BASE_URL>
```

解析返回 JSON 得到 pact 的 `status / name / wallet_id / expires_at / progress_tx_count / progress_usd_spent`,当 `status === "active"` 时 `paired: true`。

- 若 `PAYMENTS_ENABLED=false`,直接返回 `pactStatus: "disabled"`,**不 shell out**。
- 若缺少 `COBO_API_KEY` / `COBO_WALLET_UUID` / `COBO_PACT_ID`,返回 `pactStatus: "missing_config"` 并在 `missing` 字段列出缺项。

## 三、备用路径:`payX402Requirement`(未接线)

`payX402Requirement` 是直接 `POST {COBO_BASE_URL}/v1/wallets/{uuid}/payment` 拿 `PAYMENT-SIGNATURE` 的参考实现,**当前没有任何路由调用它**。真实链路走的是 CLI。保留它作为不依赖 `caw` 的替代/参考路径。

## 四、关键配置(`lib/config.ts`)

| 配置项 | 默认值 | 作用 |
|---|---|---|
| `CAW_BIN` | `caw` | CLI 可执行名/路径,需在 PATH 上 |
| `COBO_PACT_ID` | 必填(无默认) | 授权 pact,付费时强制 |
| `COBO_API_KEY` | 必填(`requireEnv`) | Cobo API Bearer token,仅付费时读取 |
| `COBO_WALLET_UUID` | 必填(`requireEnv`) | 钱包 UUID |
| `COBO_BASE_URL` | `https://api.agenticwallet.cobo.com` | 同时作为 `--api-url` 和 `AGENT_WALLET_API_URL` |
| `PAYMENTS_ENABLED` | `true` | 设 `false` 时 `cawFetchX402` 直接抛中文提示、配对状态返回 `"disabled"`,免费读仍可用(serverless/Vercel 用) |
| `MAX_REPORT_USDC` | `0.50` | 单篇上限,转成 `MAX_REPORT_BASE_UNITS`(×10⁶)给 `--max-amount` |
| `DAILY_BUDGET_USDC` | `5.00` | 滚动 24h 预算,写进 pact draft |
| `DAILY_PAYMENT_LIMIT` | `50` | 滚动 24h 笔数上限,写进 pact draft |
| `X402_NETWORK` | `eip155:8453`(Base 主网) | 默认网络,requirement 未指定时用 |
| `COBO_X402_CHAIN_IDS` | `BASE_ETH,SOLDEV_SOL` | pact policy 允许的链 |
| `COBO_X402_TOKEN_REFS` | `BASE_ETH:BASE_USDC,SOLDEV_SOL:SOLDEV_SOL_USDC` | 解析成 `{chain_id, token_id}` 喂给 pact policy |

> USDC 为 6 位小数(`USDC_DECIMALS = 6`)。`MAX_REPORT_BASE_UNITS` / `DAILY_BUDGET_BASE_UNITS` 把人类可读的 USDC 转成整数 base units。

## 五、Pact 草稿:`buildCitelyReaderPactDraft`

`buildCitelyReaderPactDraft` 生成提交给 Cobo 的策略,包含:

- **intent / execution_plan**:意图与允许范围(仅付 x402 请求、仅 Base 主网 USDC 或 Solana Devnet USDC、仅付报价金额、不付自身地址)。
- **policies**:`transfer` 类型的 allow 规则,`when` 限定 `chain_in`/`token_in`,`deny_if` 限定单笔 `amount_gt` 与滚动 24h 的 `amount_gt`/`tx_count_gt`。
- **completion_conditions**:`amount_spent` / `tx_count` / `time_elapsed`(604800 秒 = 7 天)达阈值即停。

> ⚠️ **改限额时,pact draft 和 config 默认值必须同步**。只改本地 validator 不会改变钱包实际放行的额度——真正生效的是已审批的 pact。

## 六、运行前提

1. 安装 `caw` CLI,并确保它在 PATH 上(或用 `CAW_BIN` 指定路径)。
2. 在 `.env.local` 配置 `COBO_API_KEY`、`COBO_WALLET_UUID`、已**审批**的 `COBO_PACT_ID`。
3. 钱包付款地址必须 ≠ 文章作者的 `payTo`(x402write 拒绝自付)。
4. **serverless(如 Vercel)上 `caw` 跑不了**,需设 `PAYMENTS_ENABLED=false` 降级,付费交由持久化主机上的 `caw` 旁路服务(见 `README.md`)。

## 相关文件

- `lib/cobo.ts` —— `cawFetchX402` / `getCoboPairingStatus` / `payX402Requirement` / `buildCitelyReaderPactDraft`
- `lib/config.ts` —— 所有 env 配置与派生值
- `lib/x402write.ts` —— `readPaidReport`(注入 `pay`)
- `lib/payment-requirements.ts` —— 本地 defense-in-depth 校验
- `app/api/agent/route.ts` —— 注入 `cawFetchX402` 的流式入口
