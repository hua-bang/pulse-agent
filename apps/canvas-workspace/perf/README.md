# Performance evaluation (`perf/`)

One-command performance snapshot for Canvas Workspace. Produces a single
`perf/out/perf-snapshot.md` covering bundle composition, hot-function
microbenchmarks, and (when wired) startup + runtime profiling.

Design rationale and the full four-layer plan: [`../docs/perf-infra-design.md`](../docs/perf-infra-design.md).
Findings these numbers validate: [`../docs/performance-analysis-consolidated.md`](../docs/performance-analysis-consolidated.md).

## Quick start

```bash
pnpm install                                   # deps must be installed
pnpm --filter canvas-workspace perf:report     # build + bench → perf/out/perf-snapshot.md
pnpm --filter canvas-workspace perf:report --no-build   # reuse existing dist/
```

Individual layers:

```bash
pnpm --filter canvas-workspace bench           # L2 only — pure-TS microbenchmarks
pnpm --filter canvas-workspace perf:bundle     # L1 only — build + chunk sizes
pnpm --filter canvas-workspace perf:bundle --check    # assert against budgets.json
pnpm --filter canvas-workspace perf:bundle --update   # refresh baselines/bundle.json
```

## What each layer measures

| 层 | 命令 | 输出 | 验证发现 | 需要 Electron |
|---|---|---|---|---|
| **L1 bundle** | `perf:bundle` | `out/bundle.json` | C1–C9, D3/D4 | 构建,非运行 |
| **L2 bench** | `bench` | `out/bench.json` | A3 等算法类 | 否(纯 TS) |
| **L3 startup** | `perf:report --with-runtime` | `out/startup.json` | D1/D2, E1 | 是(harness) |
| **L4 runtime** | `perf:report --with-runtime` | `out/runtime.json` | A1/A2, H1/H2 等 | 是(harness) |

> L1/L2 已实现且 CI 友好。L3/L4 的 harness 打点与场景脚本见设计文档,尚未接线——`--with-runtime` 当前会优雅跳过/标记失败,不影响快照产出。

## Files

```
perf/
  budgets.json          # 提交。bundle 预算门禁(perf:bundle --check 读取)
  baselines/bundle.json # 提交。最近一次 --update 的基线快照,供 diff
  out/                  # 忽略(.gitignore)。每次运行的原始结果 + perf-snapshot.md
  README.md
```

## 收紧 bundle 预算

1. 首次:`perf:bundle --update` 记录当前真实体积。
2. 把 `budgets.json` 的 `entryChunkGzipBytes.max` 设到略高于当前值。
3. P1 的 `React.lazy`/`manualChunks` 落地后,逐个把 `heavyDepInEntry` 里的依赖从 `null` 改为 `false`(如 `"react-force-graph-2d": false`),让 CI 阻止它再被打回启动 chunk。

## 微基准的读法

绝对 ms 受机器影响,**价值在同机 before/after 比值与随 N 的增长曲线**。若某函数在 n 从 500→2000(×4)时 mean 增长远超 4×,即暴露了超线性(O(n²))成本——正是修复目标。

## CI

建议(见设计文档):`bench` + `perf:bundle --check` 进 PR 门禁;`--with-runtime` 的启动/运行时跑夜间任务上传 artifact,避免真机噪声误杀 PR。
