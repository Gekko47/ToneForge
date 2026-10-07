import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { renderBenchmarkReport, runBenchmark } from "@/analysis/consistency/benchmark/benchmark";

const REPORT_PATH = resolve(process.cwd(), "docs/consistency-benchmark.md");

describe("the checked-in benchmark report", () => {
  it("matches a fresh run of the benchmark", async () => {
    const generated = renderBenchmarkReport(await runBenchmark());
    if (process.env.WRITE_BENCHMARK === "1") {
      writeFileSync(REPORT_PATH, generated, "utf8");
    }
    const checkedIn = readFileSync(REPORT_PATH, "utf8");
    expect(checkedIn).toBe(generated);
  });
});
