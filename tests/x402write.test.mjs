import assert from "node:assert/strict";
import test from "node:test";

const { extractSlug, rankReports } = await import("../lib/x402write.ts");

test("extracts slug from x402write API URL", () => {
  assert.equal(
    extractSlug("https://x402write.vercel.app/api/v1/articles/yaoqian-crypto-liability"),
    "yaoqian-crypto-liability",
  );
});

test("extracts slug from natural text when present", () => {
  assert.equal(
    extractSlug("请阅读 yaoqian-crypto-liability 并总结"),
    "yaoqian-crypto-liability",
  );
});

test("returns undefined for pure natural language", () => {
  assert.equal(extractSlug("为 Web3 公司工作有什么风险?"), undefined);
});

test("ranks Web3 company work risk query to employment report", () => {
  const ranked = rankReports("我想了解Web3 公司工作风险", [
    {
      slug: "web3-illegal-employment",
      title: "你以为在降本增效，法院认为你在违法用工",
      summary: "USDT 发薪 + 远程 + 改合作协议不能自动绕开劳动法",
      author: "Lawson Riskman",
      tags: ["Labor / 劳动法", "中国大陆"],
    },
    {
      slug: "yaoqian-crypto-liability",
      title: "从姚前案说起",
      summary: "虚拟货币执法与刑事责任",
      author: "Lawson Riskman",
      tags: ["Enforcement / 刑事"],
    },
  ]);

  assert.equal(ranked[0].slug, "web3-illegal-employment");
});
