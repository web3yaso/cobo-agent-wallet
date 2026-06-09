/**
 * 端到端冒烟测试 — 跑通一条最小主流程：
 *
 *   输入  →  AI / Agent 处理  →  Web3 机制 (x402 付费)  →  可验证结果
 *
 * 直接在进程内调用与 /api/agent 路由相同的代码路径（readPaidReport →
 * generateRiskAnswer），因此只依赖真正的 Web3 依赖：
 *   - Citely / x402write 服务可达（X402WRITE_BASE_URL，默认 localhost:3000）
 *   - caw CLI + 已审批的 Cobo pact（COBO_PACT_ID），PAYMENTS_ENABLED!=false
 *   - 命中缓存或免费内容时不会真的付费
 *
 * 运行：
 *   npm run smoke
 *   # 或自定义：
 *   SMOKE_SLUG=web3-illegal-employment node --import tsx --env-file-if-exists=.env.local scripts/smoke-e2e.mjs
 *
 * 退出码 0 = 全部通过；1 = 任一断言失败或前置条件不满足。
 */

const SLUG = process.env.SMOKE_SLUG || "web3-illegal-employment";
const QUESTION = process.env.SMOKE_QUESTION || "为 web3 公司工作有什么风险？";
const MESSAGE = process.env.SMOKE_MESSAGE || `请阅读 ${SLUG}，并回答：${QUESTION}`;
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || "120000");
const EAS_UID = /^0x[0-9a-fA-F]{64}$/;

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok: Boolean(ok) });
  const mark = ok ? "✓" : "✗";
  console.log(`   ${mark} ${name}${detail ? `  —  ${detail}` : ""}`);
  return Boolean(ok);
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function main() {
  const { readPaidReport, MultipleReportsMatchError, searchReports } = await import(
    "../lib/x402write.ts"
  );
  const { cawFetchX402, getCoboPairingStatus } = await import("../lib/cobo.ts");
  const { generateRiskAnswer } = await import("../lib/answer.ts");
  const { PAYMENTS_ENABLED, X402WRITE_BASE_URL } = await import("../lib/config.ts");

  // ---- 前置检查 -------------------------------------------------------------
  section("前置检查");
  console.log(`   x402write: ${X402WRITE_BASE_URL}  | payments: ${PAYMENTS_ENABLED ? "on" : "off"}`);

  let catalogOk = false;
  try {
    const catalog = await withTimeout(searchReports(), 15000, "目录探测");
    catalogOk = Array.isArray(catalog) && catalog.length > 0;
    check("Citely 目录可达且非空", catalogOk, `${catalog.length} 篇`);
  } catch (err) {
    check("Citely 目录可达且非空", false, err.message);
  }
  if (!catalogOk) {
    console.error(
      "\n前置条件不满足：x402write 目录不可达。请先启动 Citely 服务" +
        "（并确认 X402WRITE_BASE_URL / 路径前缀正确），再重试。",
    );
    process.exit(1);
  }

  let pactBefore = null;
  try {
    pactBefore = await withTimeout(getCoboPairingStatus(), 35000, "pact 状态");
    check(
      "Cobo pact 可用",
      pactBefore.paired || pactBefore.pactStatus === "disabled",
      `pactStatus=${pactBefore.pactStatus}, tx=${pactBefore.progressTxCount ?? "?"}`,
    );
  } catch (err) {
    check("Cobo pact 可用", false, err.message);
  }

  // ---- 阶段 1：输入 ---------------------------------------------------------
  section("阶段 1 · 输入");
  console.log(`   message: ${MESSAGE}`);
  check("输入非空", MESSAGE.trim().length > 0);

  // ---- 阶段 2：AI / Agent 处理 ----------------------------------------------
  section("阶段 2 · AI / Agent 处理");
  const stages = [];
  let result;
  try {
    result = await withTimeout(
      readPaidReport(
        MESSAGE,
        (requirement, readUrl) => cawFetchX402(readUrl, requirement),
        undefined,
        (stage) => {
          stages.push(stage);
          console.log(`   ↻ stage: ${stage}`);
        },
      ),
      TIMEOUT_MS,
      "readPaidReport",
    );
  } catch (err) {
    if (err instanceof MultipleReportsMatchError) {
      check("报告唯一解析（未触发多选）", false, `匹配到 ${err.candidates.length} 篇；请用更精确的 slug`);
    } else {
      check("readPaidReport 成功", false, err.message);
    }
    return finish();
  }

  const report = result.report;
  check("readPaidReport 成功返回报告", Boolean(report?.slug), `slug=${report?.slug}`);
  check(
    "经过了读取阶段",
    stages.includes("reading_report") || result.source === "cache",
    `source=${result.source}`,
  );

  let answer = "";
  try {
    answer = await withTimeout(
      generateRiskAnswer(report, QUESTION),
      TIMEOUT_MS,
      "generateRiskAnswer",
    );
    check("AI 生成回答非空", answer.trim().length > 50, `${answer.length} 字符`);
  } catch (err) {
    check("AI 生成回答非空", false, err.message);
  }

  // ---- 阶段 3：Web3 机制 (x402 付费) ----------------------------------------
  section("阶段 3 · Web3 机制 (x402 付费)");
  console.log(`   paymentStatus=${result.paymentStatus} | source=${result.source}`);
  check(
    "付费结果有效",
    ["paid", "cached", "not_required"].includes(result.paymentStatus),
    result.paymentStatus,
  );

  if (result.paymentStatus === "paid") {
    // 真实发生了一笔 Solana Devnet USDC 转账；用 pact tx 计数交叉验证
    try {
      const pactAfter = await withTimeout(getCoboPairingStatus(), 35000, "pact 复核");
      const before = pactBefore?.progressTxCount;
      const after = pactAfter?.progressTxCount;
      const increased = typeof before === "number" && typeof after === "number" && after > before;
      check(
        "Cobo pact 交易计数 +1（链上付费已记录）",
        increased,
        `${before} → ${after}`,
      );
    } catch (err) {
      check("Cobo pact 交易计数复核", false, `（best-effort）${err.message}`);
    }
  } else {
    console.log("   ℹ 命中缓存/免费内容，本次未发起付费（属正常路径）。");
  }

  // ---- 阶段 4：可验证结果 ---------------------------------------------------
  section("阶段 4 · 可验证结果");
  check("报告正文 content 非空", Boolean(report?.content && report.content.length > 0));
  check("配套 companion 非空", Boolean(report?.companion && report.companion.length > 0));
  const uid = report?.citation?.attestationUID || "";
  check(
    "引用含有效 EAS 链上存证 UID",
    EAS_UID.test(uid),
    uid ? `${uid.slice(0, 12)}…` : "(缺失)",
  );
  check("作者署名存在", Boolean(report?.citation?.author), report?.citation?.author);
  check(
    "回答包含免责声明 / 引用",
    /不构成法律意见|来源[:：]/.test(answer),
  );

  finish();
}

function finish() {
  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.length - passed;
  section("结果");
  console.log(`   ${passed}/${checks.length} 通过${failed ? `，${failed} 失败` : ""}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("\n脚本异常：", err?.stack || err);
  process.exit(1);
});
