import { tool } from "ai";
import { z } from "zod";
import { cawFetchX402 } from "./cobo";
import { readPaidReport, searchReports } from "./x402write";

export const citelyReaderTools = {
  searchReports: tool({
    description:
      "Search the free x402write catalog for Web3 legal, compliance, and security risk reports.",
    parameters: z.object({
      query: z.string().describe("Natural-language query, tag, author, or topic."),
    }),
    execute: async ({ query }) => {
      return searchReports(query);
    },
  }),

  readPaidReport: tool({
    description:
      "Read an x402write paid report by slug, URL, or natural-language request. Pays through Cobo x402 when required.",
    parameters: z.object({
      input: z.string().describe("Report slug, report URL, or natural-language request."),
      payerAddress: z
        .string()
        .optional()
        .describe("Optional payer address used for local self-send validation."),
    }),
    execute: async ({ input, payerAddress }) => {
      return readPaidReport(
        input,
        (requirement, readUrl) => cawFetchX402(readUrl, requirement),
        payerAddress,
      );
    },
  }),
};
