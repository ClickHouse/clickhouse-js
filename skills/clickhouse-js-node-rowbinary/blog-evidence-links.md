# RowBinary blog — evidence links (for the article-authoring agent)

All links are permanent: source permalinks are pinned to the merge commit of
PR #933 on `main` (`8c51d9a12e67e82ef431e8158d5b77ce26e40e3a`), and the CI run +
log-line anchors point at a completed, immutable Actions run.

## Source permalinks (pinned to main @ 8c51d9a)

- **Benchmark CI workflow** (runs `npm run bench` against a live ClickHouse, uploads a JSON artifact):
  https://github.com/ClickHouse/clickhouse-js/blob/8c51d9a12e67e82ef431e8158d5b77ce26e40e3a/.github/workflows/bench-skill-rowbinary.yml

- **The ledger benchmark file** (`tests/ledger.bench.ts`) — the source behind the headline 2.5–3.3x:
  https://github.com/ClickHouse/clickhouse-js/blob/8c51d9a12e67e82ef431e8158d5b77ce26e40e3a/skills/clickhouse-js-node-rowbinary/tests/ledger.bench.ts
  - Schema + how each JSON variant is produced (the `output_format_json_quote_64bit_integers` / `..._quote_decimals` settings that make the "correct" JSON path correct) — **L29–L52**:
    https://github.com/ClickHouse/clickhouse-js/blob/8c51d9a12e67e82ef431e8158d5b77ce26e40e3a/skills/clickhouse-js-node-rowbinary/tests/ledger.bench.ts#L29-L52
  - The four benchmark definitions — RowBinary API vs _JSONEachRow quoted (correct)_ vs _JSONEachRow bare (fast but wrong)_ — **L182–L198**:
    https://github.com/ClickHouse/clickhouse-js/blob/8c51d9a12e67e82ef431e8158d5b77ce26e40e3a/skills/clickhouse-js-node-rowbinary/tests/ledger.bench.ts#L182-L198

## CI run — timestamped, reproducible evidence

- **Run page** (2026-06-30, status: success; downloadable artifact `rowbinary-bench-results` = per-bench `hz` as JSON):
  https://github.com/ClickHouse/clickhouse-js/actions/runs/28439460847
- **Job log** (`benchmarks`):
  https://github.com/ClickHouse/clickhouse-js/actions/runs/28439460847/job/84273435913

### Deep links to the exact log lines

- **Environment** (so readers see what it ran on) — Node v24.17.0, AMD EPYC 7763 (4 vCPU), ClickHouse 26.6.1.1193:
  https://github.com/ClickHouse/clickhouse-js/actions/runs/28439460847/job/84273435913#step:5:19

- **Ledger throughput** (RowBinary-API `26.72 hz` vs _correct_ JSONEachRow `10.81 hz` → **2.47x**):
  https://github.com/ClickHouse/clickhouse-js/actions/runs/28439460847/job/84273435913#step:9:40

- **Ledger summary line** ("4.09x faster than JSONEachRow quoted … (correct)" for the _optimized_ reader; the API-reader vs correct-JSON ratio is 2.47x from the hz above):
  https://github.com/ClickHouse/clickhouse-js/actions/runs/28439460847/job/84273435913#step:9:167

- **IoT throughput** (RowBinary-API `63.36 hz` vs JSONEachRow `30.56 hz` → **2.07x**):
  https://github.com/ClickHouse/clickhouse-js/actions/runs/28439460847/job/84273435913#step:9:68

> The `#step:N:LINE` anchors are stable for this completed run. The line text is
> also quoted above so it can be verified with ctrl-F if GitHub ever re-renders.

## ⚠️ Remark for the author: M4 Max vs cloud-CPU difference (read before publishing)

The headline **ledger RowBinary-vs-JSON ratio is hardware-dependent**, and the two
numbers in this post come from two different machines — be precise about which is which:

- **3.3x** was measured locally on an **Apple M4 Max** (the run that produced `results.json`).
- **2.5x** (specifically 2.47x) is the **CI** number on a **GitHub-hosted AMD EPYC 7763**
  (4 vCPU) runner — the link above.

Two things to get right:

1. **It is AMD, not Intel.** GitHub's `ubuntu-latest` runners are AMD EPYC 7763. If a
   draft says "Intel," correct it to "AMD EPYC" — anyone clicking the CI log sees the
   `model name` line and will catch a mismatch.
2. **Cite the range, not one number.** Frame it as "**~2.5–3.3x** depending on hardware
   (≈2.5x on a commodity 4-core cloud CPU, ≈3.3x on Apple Silicon)." Don't present 3.3x
   as _the_ number with the CI log as its proof — the log says 2.5x. The IoT schema
   (~2.1x) is stable across both machines and is the safer single figure if you want one.

Also note the CI runner is noisier than the laptop (rme ±10–18%, 10–23 samples vs the
laptop's ±0.5–6.5%), so the CI figure is the conservative end, not a tie-breaker on
precision. For a tight published number, lean on the local M4 Max measurement and use
the CI run as the "independently reproducible, here's the log" backstop.
