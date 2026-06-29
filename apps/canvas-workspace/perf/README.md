# Performance evaluation (`perf/`)

One-command performance snapshot for Canvas Workspace. Produces a single
`perf/out/perf-snapshot.md` covering bundle composition, hot-function
microbenchmarks, and (when wired) startup + runtime profiling.

Design rationale and the full four-layer plan: [`../docs/perf-infra-design.md`](../docs/perf-infra-design.md).
Findings these numbers validate: [`../docs/performance-analysis-consolidated.md`](../docs/performance-analysis-consolidated.md).

## Quick start

```bash
pnpm install                                   # deps must be installed
pnpm --filter canvas-workspace perf:report     # build + bench → perf/out/perf-snapshot.{md,html}
pnpm --filter canvas-workspace perf:report --no-build   # reuse existing dist/
```

`perf:report` writes three artifacts to `perf/out/`: `perf-snapshot.md`
(diff-friendly), `perf-snapshot.json` (machine-readable), and
**`perf-snapshot.html`** — a self-contained dashboard (chunk bars, bench growth
exponents, runtime tables) to open in a browser. All three are dev artifacts,
never shipped in the app.

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
| **L3 startup** | 应用内 Perf 面板(`PULSE_PERF=1`) | 核心打点 | D1/D2, E1 | 是 |
| **L4 runtime** | `harness perf-runtime` | `out/runtime.json` | A1/A2, H1/H2 等 | 是(harness) |

> L1/L2 已实现且 CI 友好。L3 启动相位由核心 `PULSE_PERF` 打点 + 可拆卸 Perf 面板展示(`src/main/app/perf-marks.ts`)。L4 经 harness 在真实窗口里采集运行时指标。

## L4 运行时 profiling(harness)

**一条命令**(自动起一个临时会话 → profile → 拆掉):

```bash
pnpm --filter canvas-workspace build          # 需要先有构建产物(dist/)
pnpm --filter canvas-workspace perf:runtime    # = harness perf-runtime --scenario all
```

或并入完整快照(`perf:report` 在 L1 已构建,L4 会自动起会话):

```bash
pnpm --filter canvas-workspace perf:report --with-runtime
```

`perf-runtime` 的会话管理:**有活会话就复用,没有就起一个临时的、跑完自动关**。相关 flag:

| flag | 作用 |
|---|---|
| (默认) | 无活会话时自动起临时会话,profile 后拆除 |
| `--start` | 即便有活会话也强制起一个新的(可复现) |
| `--keep` | 自起的会话跑完不关(留着继续看) |
| `--build` | 起会话前先 `pnpm build` |
| `--profile demo` | 临时会话用哪个 profile(默认 demo) |
| `--scenario all\|idle\|pan-zoom` · `--duration 4000` | 场景与时长 |

如果你想用自己已开的、装了特定节点的工作区,先 `harness start`,再 `perf:runtime` 就会复用它。

场景:`idle`(稳态帧时长+堆)、`pan-zoom`(合成 ctrl+wheel 缩放下的帧 jank)。每场景须在 CDP 超时(~15s)内完成,故 `--duration` 上限 10s。进程指标(含 guest webview 数,验证 D1/H2)经 Perf 插件 `metrics` 通道取得。

> 注:自动起的临时会话需要 perf 插件在构建里(dev 构建默认有;若用 production 构建跑 L4,需 `PULSE_PERF_TOOLS=1 pnpm build`)。

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
