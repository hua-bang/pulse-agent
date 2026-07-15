# Pulse Canvas 大画布与 WebView 生命周期优化报告

日期：2026-07-14
结论：缩放主问题已解决；大量 URL WebView 的内存驻留已从“只增不减”改为 Chrome-style 可见性优先、LRU 深度休眠和按需恢复。当前代表性 100 节点压力夹具中，缩放慢帧中位数为 0%，29 个真实 guest 可收敛到 16 个，总 RSS 释放约 1.00 GB。

## 1. 验收结论

| 项目 | 优化前 / 基线 | 当前结果 | 结论 |
|---|---:|---:|---|
| 86 节点 / 40 网页 / 25 live WebView 首次缩放 | 超过 15,000 ms 仍未完成 | 17.3 ms presented-frame 代理（上一轮同夹具） | 主卡顿已消除，保守改善下界 >867× |
| 100 节点 / 47 网页 / 29 live WebView 首次缩放 | — | 19.3 ms，中位数；transform 14.2 ms | 扩容后无回退 |
| 同夹具持续 Pan/Zoom 慢帧 | — | 中位数 0%；单轮最差 1.9%（4 帧） | 连续缩放稳定 |
| 同夹具缩放 settle 慢帧 | — | 中位数 0%；结束时延 366.5 ms | 包含既有 idle debounce 与 transition，不是主线程阻塞 |
| 真实 WebView guest 数 | 29 | 16 | 减少 13 个，-44.8% |
| 全进程 RSS | 3,463.0 MB | 2,463.2 MB | 释放 999.8 MB，-28.9% |
| 已休眠 guest 恢复 | 不支持 | 269 ms | 新 WebContents / document 均已验证 |
| 启动 entry raw / gzip | 基线 614 / 179 KB | 585 / 171 KB | 分别低于基线 4.7% / 4.5% |
| 发布性能 Gate | 22 项 | 22/22 通过 | 无 high 回归 |
| 自动化回归 | — | 178 files / 1,312 tests | 全绿 |

这里的 17.3 / 19.3 ms 是跨过 transform 写入和下一次渲染机会的 presented-frame boundary 代理，不是 GPU `SwapBuffers` 时间。RSS 是同一台机器、同一 Electron 会话中的全进程总和；它适合比较本次回收前后，不应跨机器比较。

## 2. Chrome-style 策略如何落到 Canvas

参考 Chrome 的 [Page Lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api) 与 [Memory Saver](https://developer.chrome.com/blog/memory-and-energy-saver-mode) 思路，本轮没有只做 `visibility:hidden`。真实 Electron guest 只有删除 `<webview>` 才能稳定释放进程级内存，因此实现分为五层：

1. **持续可见性管理**：IntersectionObserver 使用 200 px 预热边界；节点在 `window ∩ canvas-container` 真实裁剪区内的可见面积至少 12,000 px² 才视为活跃，避免 fit-all、小缩放或左右抽屉遮挡时把几十个 WebView 一次性唤醒。
2. **全局 live cap**：Canvas 节点、Reference 预览和 Right Dock 链接标签共享同一个 window 级协调器。默认最多保留 16 个未受保护的 live guest，按最近使用时间淘汰。
3. **离屏宽限与运动冻结**：离屏 60 秒后才进入候选；拖动、平移、缩放和动画期间不创建或销毁 guest，运动结束后延迟 250 ms 重新测量。额外监听 Canvas motion 属性，修复“缩放前后都相交、IntersectionObserver 不回调”的边界；异步回收探测返回后还会再次检查 motion 和最新几何，避免探测途中开始缩放的竞态。
4. **安全保护**：可见、选中、全屏、正在调整尺寸/编辑、加载中、播放音频、打开 DevTools、宿主或文档有焦点、检测到表单/contenteditable 修改、以及 Agent/DOM Picker 正在操作的 guest 不回收。同源子 iframe 也递归安装 dirty tracker，并使用跨 realm 安全的表单判断。`blob:` 和已有运行时 DOM 的 `about:blank` 无法从 URL 重放，会直接 fail closed。所有脚本探测、窗口激活和滚动恢复都有有界超时；慢探测每轮最多处理 2 个，并按 5→10→20→60 秒退避，避免失联 SPA 形成持续后台探测。
5. **深度休眠与恢复**：候选 guest 保存最新 runtime URL 与滚动位置，删除真实 `<webview>`，显示静态“内存节省”占位。重新可见、被选中或被工具访问时创建新 WebContents，等待 `dom-ready` 后同步恢复滚动。

Electron 自带的 [`backgroundThrottling`](https://www.electronjs.org/docs/latest/api/web-contents) 默认策略继续保留；本轮没有把它关闭。原生节流负责降低后台执行频率，本轮 LRU 深度休眠负责真正降低 guest 数与 RSS，两者用途不同。

## 3. 状态与安全合同

已验证恢复成功的状态：

- 最新主 frame URL；
- `scrollX` / `scrollY`；
- 同一 Electron session partition 下的 Cookie 与持久 Web Storage；
- Agent/DOM Picker 对已休眠节点的按 nodeId 唤醒、重新注册与操作；
- 旧 guest 的延迟 unregister 不会删除新 generation 的 registry 记录。

`blob:` URL，以及包含运行时 DOM / constructable stylesheet 的 `about:blank`（含 fragment/query）不会进入深度休眠，因为仅凭 URL 无法可靠重建这些页面。纯空 `about:blank` 可以安全回收。

有意不承诺序列化的状态：

- JavaScript heap、未持久化 SPA 内存状态；
- WebSocket / 轮询连接；
- 媒体播放位置；
- 完整浏览历史栈；
- 跨域子 iframe 内无法观测的未保存编辑状态。

因此，正在交互、聚焦、播放音频或可检测到未保存输入的页面会被保护；真正进入深度休眠的页面语义是“重新加载式恢复”，不是 Chrome BFCache 式的完整进程快照。如果所有页面都受保护，系统允许暂时超过 16，而不会为了硬凑上限破坏用户状态。

## 4. 最终实测证据

压力夹具为 `100 nodes / 47 webpage / 29 URL WebView`，每个 URL 都是真实 Electron `<webview>`，由随机端口 loopback 服务提供确定性页面。实测同时核对 DOM guest 数和 CDP `type=webview` target 数：

```text
before:        29 DOM guests / 29 CDP targets / 3463.0 MB RSS
after discard: 16 DOM guests / 16 CDP targets / 2463.2 MB RSS
released:      999.8 MB
restore:       269 ms
identity:      WebContents 3 → 32; document instance changed
state:         URL preserved; scrollY 240 → 240
```

同一会话中的缩放结果：

```text
cold zoom presented-frame proxy: 19.3 ms median (19.3 / 17.0 / 23.0)
transform observed:              14.2 ms median
pan/zoom frames >20 ms:          0% median; 1.9% worst run
zoom-settle frames >20 ms:       0% median
main event-loop delay:           p99 22.9 ms; max 51.0 ms
```

显式 Electron 诊断为了让测试保持在秒级，会调用 `forceReconcile()` 跳过 60 秒生产宽限；自然宽限定时器、缩放结束重测、LRU 顺序、保护规则与超时退避分别由单元测试覆盖。

## 5. 是否还会卡顿

在已测的 86/40/25 和更重的 100/47/29 确定性夹具上，原来“第一下缩放像冻结”的问题已不再出现，持续缩放慢帧中位数也是 0%。所以对当前这份 86 节点画布，预期会从“明显且频繁卡顿”变成“正常可用”。

不能承诺任何机器、任何远程 SPA 都绝不卡：16 个 live guest 后的总 RSS 仍约 2.46 GB；真实业务页面如果包含视频、WebGL、大表格、跨域 iframe 或高频轮询，会比 loopback 页面更重。当前策略会显著降低这种压力的上限和持续时间，但低内存机器仍可能出现系统级换页抖动。

## 6. 剩余工作与边界

- 用脱敏的真实远程业务 SPA 做 canary，重点检查登录态、跨域子 iframe、WebSocket 和媒体恢复；确定性发布基准仍应保留 loopback，避免网络噪声污染回归判断。
- 目前是静态内存节省占位，不是页面截图。后续可增加低分辨率缩略图，但要控制截图本身的 GPU/内存成本。
- 16 是当前桌面 profile 的固定上限。积累 8/16/24 guest 分档数据后，可以按设备内存与系统 memory pressure 动态调节。
- 200 普通节点已有独立容量基准，但 `200 nodes / 58 live WebViews` 尚未建立可接受的内存预算，不应据此宣称无限扩容。
- 跨域子 iframe 内的未保存表单无法由宿主页脚本完整审计；这类页面在活跃/聚焦时受保护，离屏深度休眠前仍需真实业务 canary。

## 7. 复现命令

```bash
# 完整 release 门禁（包含 perf 分析构建）
pnpm --filter canvas-workspace perf:report

# WebView 深度休眠 + 缩放联合压力场景
PULSE_CANVAS_PERF=1 pnpm --filter canvas-workspace harness start --profile temp --headless --force
pnpm --filter canvas-workspace perf:scenarios \
  --seed-nodes 100 --seed-webpages 47 --seed-url-webviews 29 \
  --scenario zoom-cold,panzoom,zoom-settle,webview-discard-restore --repeat 3
pnpm --filter canvas-workspace harness close --cleanup
```

结构化原始结果位于 `perf/out/scenarios-report.json`，发布门禁契约位于 `perf/out/report.json`；指标定义与口径分别由 `perf/metrics.json` 和 `perf/program.md` 管理。
