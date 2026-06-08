# Citely Reader Agent Development Plan

## Goal

Build an MVP agent named **Citely Reader** that reads paid x402write expert
reports through the x402 protocol, pays small USDC amounts using Cobo Agentic
Wallet, and answers users with citations grounded in the paid report content.

Citely Reader focuses on Web3 legal, compliance, and security risk education.
It does not provide legal advice.

## Product Scope

- Bot name: `Citely Reader`
- Primary use case: paid reading of Web3 legal, compliance, and security risk
  reports.
- User input: report slug, report URL, or natural language request.
- Agent output: structured Chinese explanation, glossary, legal/risk map,
  misconception notes, source author, and EAS attestation reference.
- Out of scope for MVP: legal advice, mainnet real-money payments, membership
  system, author dashboard, dynamic pricing, revenue split logic.

## Architecture

```text
Next.js app on Vercel
  -> Vercel AI SDK agent endpoint
    -> readPaidReport tool
      -> x402write API
      -> Cobo Agentic Wallet x402 payment
      -> paid report content + companion data
```

Vercel AI SDK is used for agent orchestration and tool calling. It does not
enforce payment permissions. Cobo Agentic Wallet and Cobo pacts define the
wallet execution and authorization boundary.

## x402write Reading Flow

1. User asks Citely Reader to read a report, such as
   `yaoqian-crypto-liability`, or asks a natural-language question such as
   "为 Web3 公司工作有什么风险?".
2. If the user did not provide a slug, the agent searches the free catalog:

   ```text
   GET https://x402write.vercel.app/api/v1/articles?q=<query>
   ```

   The catalog response includes candidates, prices, tags/authors, and each
   article's `read` path. The agent selects the best candidate or asks the user
   to choose if the match is ambiguous.
3. Agent requests the selected article's `read` path, for example:

   ```text
   GET https://x402write.vercel.app/api/v1/articles/<slug>
   ```

4. x402write returns `HTTP 402 Payment Required` with payment requirements.
5. Agent validates the payment requirements locally.
6. Agent sends the Base64 `Payment-Required` header to Cobo Agentic Wallet:

   ```text
   POST /v1/wallets/{wallet_uuid}/payment
   protocol: "x402"
   ```

7. Cobo returns a `PAYMENT-SIGNATURE` retry header.
8. Agent retries the original GET with the payment signature.
9. x402write returns `HTTP 200` with:

   ```json
   {
     "slug": "...",
     "title": "...",
     "content": "<full article markdown>",
     "companion": "<glossary / legal-map / misconceptions>",
     "citation": {
       "author": "...",
       "attestationUID": "0x...",
       "publishedAt": "..."
     }
   }
   ```

10. Agent caches the paid report locally to avoid paying again for the same
    slug in future reads.
11. Agent answers only from `content` and `companion`.

## Cobo Pact Design

Agent development must follow the Cobo Agentic Wallet pact documentation:

```text
https://www.cobo.com/products/agentic-wallet/manual/developer/pacts
```

The pact is the hard authorization boundary. Prompt instructions and local
checks are helpful, but they are not sufficient.

Recommended MVP policy intent:

- Protocol: x402 only.
- Network: Base Sepolia only, `eip155:84532`. In Cobo pact policy fields, use
  the official Cobo chain id `TBASE_SETH`.
- Token: test USDC only.
- Payment amount: exact quoted amount only.
- Per-report limit: `0.50 USDC`.
- Daily budget: `5.00 USDC`.
- Daily payment count: `50`.
- Self-send: denied.
- Validity: 7 days for MVP, or 24 hours for a tighter demo.

Product-level pact shape:

```json
{
  "intent": "Read x402write paid reports with small USDC payments on Base Sepolia",
  "execution_plan": "# Summary\nUse the agent wallet to pay x402 payment requests for x402write reports, then retrieve and summarize the paid report content.\n\n# Allowed Scope\n- Pay x402 payment requests only\n- Use Base Sepolia only\n- Use test USDC only\n- Pay exact quoted amount only\n- Do not pay the wallet's own address\n\n# Budget\n- Maximum 0.50 USDC per report\n- Maximum 5.00 USDC per rolling 24 hours\n- Maximum 50 payments per rolling 24 hours\n\n# Completion\nStop when the daily budget, daily payment count, or pact expiration is reached.",
  "policies": [
    {
      "name": "x402write-daily-reading-budget",
      "type": "transfer",
      "rules": {
        "effect": "allow",
        "when": {
          "chain": "TBASE_SETH",
          "asset": "USDC",
          "protocol": "x402"
        },
        "limits": {
          "max_amount_per_payment": "0.50",
          "rolling_24h_amount": "5.00",
          "rolling_24h_count": 50
        },
        "deny": {
          "self_send": true,
          "overpay": true
        }
      }
    }
  ],
  "completion_conditions": [
    {
      "type": "amount_spent",
      "window": "24h",
      "threshold": "5.00"
    },
    {
      "type": "tx_count",
      "window": "24h",
      "threshold": 50
    },
    {
      "type": "time_elapsed",
      "threshold": "7d"
    }
  ]
}
```

The JSON above is a product design sketch. The final implementation must use
the exact Cobo API schema, supported chain identifiers, token identifiers, and
policy fields from the official documentation. Current known Cobo chain id for
Base Sepolia is `TBASE_SETH`; the test USDC token identifier still needs to be
confirmed against Cobo's supported assets before implementation.

Before the demo, fund the Cobo wallet with Base Sepolia test USDC from a Base
faucet, such as the Coinbase Developer Platform faucet linked from the Base
network faucet documentation. The payer address must not be the same as any
article author `payTo` address, otherwise x402write rejects the payment as
`self_send_not_allowed`.

Cobo's x402 payment endpoint returns a `PAYMENT-SIGNATURE` retry header for the
agent to replay. The x402 facilitator handles settlement. In implementation,
confirm whether the Cobo wallet also needs Base Sepolia ETH for any submitted
transaction path; the expected MVP path should primarily require test USDC.

## Agent Tools

### `searchReports(query)`

- Calls the free x402write catalog endpoint:

  ```text
  GET https://x402write.vercel.app/api/v1/articles
  GET https://x402write.vercel.app/api/v1/articles?q=<query>
  GET https://x402write.vercel.app/api/v1/articles?tag=<tag>
  GET https://x402write.vercel.app/api/v1/articles?author=<author>
  ```

- Returns candidate reports with slug, title, price, tags/authors, and `read`
  path.
- Resolves natural-language requests to a slug when there is a clear match.
- Asks the user to choose if multiple reports are plausible.

### `getReportPaymentRequirements(slug)`

- Fetches the x402write article endpoint, preferably using the catalog item's
  `read` path instead of hand-building the URL.
- Detects `HTTP 402`.
- Extracts the `Payment-Required` header.
- Parses scheme, network, asset, amount, and `payTo`.

### `validatePaymentRequirement(requirement)`

- Rejects non-Base-Sepolia payment requests.
- Rejects non-USDC assets.
- Rejects payments above `0.50 USDC`.
- Rejects self-send.
- Rejects malformed or missing payment requirements.

### `payX402Requirement(paymentRequired)`

- Calls Cobo Agentic Wallet payment API with `protocol: "x402"`.
- Receives the `PAYMENT-SIGNATURE` retry header.
- Relies on the active Cobo pact for hard authorization.

### `readPaidReport(slug)`

- Executes the full GET -> 402 -> validate -> pay -> retry flow.
- Checks the local paid-content cache before paying.
- Returns the paid report JSON.
- Surfaces settlement failures and re-issued 402 reasons.

### `formatRiskAnswer(report, userQuestion)`

- Uses only the report `content` and `companion`.
- Produces a structured Chinese answer.
- Includes source and EAS attestation reference.
- Includes risk education and legal advice disclaimer.

## Agent Behavior Rules

- Never invent legal conclusions.
- Ground every claim in the paid report `content`.
- Use `companion` for glossary, legal map, and misconception structure.
- Always cite:

  ```text
  来源:<author>，链上存证 EAS <attestationUID first 10 chars>
  ```

- Always include:

  ```text
  这是风险教育，不构成法律意见；具体情况请咨询有资质的专业人士。
  ```

- Refuse payment if:
  - network is not `eip155:84532`;
  - asset is not expected test USDC;
  - amount exceeds `0.50 USDC`;
  - daily budget or count is exhausted;
  - `payTo` equals the paying wallet address;
  - `Payment-Required` is missing or malformed.
- For natural-language requests, search the free catalog first and use the
  selected catalog item's `read` path.
- Cache successfully purchased report content by slug so repeated reads do not
  create unnecessary additional payments. Cobo request idempotency should still
  be used for retry safety, but it does not replace paid-content caching for
  future reads.

## Frontend MVP

- Simple chat interface.
- Input supports slug, URL, or natural language request.
- Status panel shows:
  - active pact status;
  - daily budget used;
  - current report price;
  - payment status;
  - error reason if settlement fails.
- Answer panel shows:
  - summary;
  - risk points;
  - glossary;
  - legal/compliance map;
  - common misconceptions;
  - source and EAS attestation.

## Backend API

```text
POST /api/agent
  User message -> Vercel AI SDK streamText

POST /api/pacts
  Create or check Citely Reader pact

GET /api/pacts/status
  Return current pact status, budget, and expiration

GET /api/reports/:slug
  Optional server-side wrapper around x402write
```

## Environment Variables

```text
COBO_API_KEY=
COBO_WALLET_UUID=
COBO_BASE_URL=
X402WRITE_BASE_URL=https://x402write.vercel.app
MAX_REPORT_USDC=0.50
DAILY_BUDGET_USDC=5.00
DAILY_PAYMENT_LIMIT=50
```

Do not commit secrets to Git.

## Testing Plan

- Unknown or invalid slug is handled clearly.
- Natural-language query maps to a report slug through the free catalog.
- Ambiguous search results ask the user to choose before paying.
- 402 response without `Payment-Required` is rejected.
- Non-Base-Sepolia network is rejected.
- Non-USDC asset is rejected.
- Amount above `0.50 USDC` is rejected.
- Self-send is rejected.
- Cobo returns `PAYMENT-SIGNATURE` and retry succeeds.
- Payment retry still returns 402 and the settlement failure reason is surfaced.
- Re-reading a cached paid report does not trigger a second payment.
- Successful paid report answer only uses `content` and `companion`.
- Answer always includes author, EAS attestation prefix, and legal disclaimer.
- Daily budget and payment count are enforced by local checks and Cobo pact.

## Development Sequence

1. Scaffold Next.js and Vercel AI SDK.
2. Implement x402write free catalog search and natural-language to slug flow.
3. Implement x402write fetch and 402 parser.
4. Implement local payment requirement validation.
5. Confirm Cobo supported chain/token ids and pact schema.
6. Fund the Cobo wallet with Base Sepolia test USDC.
7. Integrate Cobo Agentic Wallet x402 payment endpoint.
8. Implement Cobo pact creation and status checks.
9. Add local paid-content caching by slug.
10. Wrap the flow as the `readPaidReport` AI SDK tool.
11. Build Citely Reader chat UI.
12. Add budget, pact, and payment status display.
13. Deploy to Vercel.
14. Run end-to-end test on Base Sepolia test USDC.

## MVP Success Criteria

Given the report slug `yaoqian-crypto-liability`, or a natural-language query
that maps to it, Citely Reader can:

1. Search the catalog and resolve the intended report when needed.
2. Detect the x402 paywall.
3. Validate the payment requirement.
4. Pay through Cobo Agentic Wallet within the active pact.
5. Retry and retrieve the full paid report.
6. Cache the paid report to avoid repeat payments.
7. Produce a Chinese answer grounded in the report content.
8. Include source author, EAS attestation prefix, and legal disclaimer.
