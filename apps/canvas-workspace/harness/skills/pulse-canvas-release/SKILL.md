---
name: pulse-canvas-release
description: 发布 Pulse Canvas 的 macOS arm64 版本：默认触发 GitHub Actions 的 Canvas Release，也可在本机用脚本发布，并同步 R2 的 latest.json 与下载页。适用于“发版、发布新版本、更新下载页、修复 release note”请求。
---

# Pulse Canvas Release

发布流程只有一个脚本：[scripts/release-pulse-canvas.mjs](scripts/release-pulse-canvas.mjs)。它改版本号、打 DMG、上传 R2、更新 `latest.json`、部署下载页。发版没有 PR：版本号提交只留在 tag 上，master 的 `package.json` 版本号不跟着变。

## 默认：GitHub Actions

1. 取版本号：上一个 tag 的下一个版本。`latest.json` 里的版本才是用户已有的版本，不要复用。
2. 写发布说明：`git log pulse-canvas-v<上一版>..origin/master -- apps/canvas-workspace packages/canvas-cli packages/canvas-nodes`。只写用户能感知的变化，中英各一份。
3. 触发 `.github/workflows/canvas-release.yml`（Actions 页面 Run workflow，或 API），填 `version`、`notes_zh`、`notes_en`。
4. 它在 `macos-14` 上依次完成：打包、上传、部署，提交版本号并只推送 `pulse-canvas-v<version>` tag。
5. 核对：`<下载页>/latest.json?release=<version>` 的版本和文件，以及 DMG 的 `?release=<version>` 地址返回 200。

所需仓库 Secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 和下表四个 `PULSE_CANVAS_*`。workflow 在上传前检查 tag 是否已存在；失败在上传前停止，可直接重跑。

## 备选：本机发布

本机需要 pnpm、Git、Wrangler。认证用本机登录状态或环境变量，不把凭据写入仓库。从仓库根目录执行：

```bash
node apps/canvas-workspace/harness/skills/pulse-canvas-release/scripts/release-pulse-canvas.mjs \
  --version 0.1.1 --commit-tag \
  --notes-zh "新增下载页发布和应用内更新提示。" \
  --notes-en "Added the download page flow and in-app update notice."
git push origin pulse-canvas-v0.1.1
```

`--commit-tag` 提交版本号并创建 tag，不推送；工作区必须干净。不要用 `--push-git`：它还会推送当前分支。

本机发布配置（参数优先于环境变量；仓库不含真实部署目标）：

| 环境变量 | 参数 | 用途 |
|---|---|---|
| `PULSE_CANVAS_REPO_DIR` | `--repo` | 仓库路径，默认当前目录 |
| `PULSE_CANVAS_R2_BUCKET` | `--bucket` | R2 桶，上传时必填 |
| `PULSE_CANVAS_RELEASE_BASE_URL` | `--release-base-url` | 对象公开 URL 前缀，含产品和通道目录，上传时必填 |
| `PULSE_CANVAS_DOWNLOAD_URL` | `--download-url` | 下载页公开 URL，生成 manifest 时必填 |
| `PULSE_CANVAS_PAGES_PROJECT` | `--project-name` | Pages 项目，部署时必填 |

URL 只接受不含用户名、密码、查询参数或片段的公开 HTTP(S) 地址。脚本不自动加载 `.env`；用 `.env.release` 时先确认它被 Git 忽略。缺配置会在改版本和打包前退出；只打包用 `--no-publish --no-deploy`。产品默认 `pulse-canvas`，通道默认 `stable`，Pages 分支默认 `main`。

网络约定（本机）：
- `wrangler` 默认清除 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`（含小写）；需要代理时加 `--use-proxy`。
- 5MB 以上的 R2 上传会定期打印 elapsed 和 macOS `nettop` 流量。2-3 个采样周期没有增长就停止，换相反的网络模式重试。
- 上传完成前不要请求不带查询参数的最终下载 URL，CDN 可能缓存 404。先用 `?release=<version>` 核验；基线 URL 已被缓存 404 时，让 manifest 的链接带版本查询参数，或定向清理缓存。

## 常用参数

- `--version <semver>`、`--notes`、`--notes-zh`、`--notes-en`：版本和发布说明。会写入 manifest 时，说明不能为空。
- `--notes-pending`：先发产物、后补说明。随后必须用 `--manifest-only --no-build --notes-zh ... --notes-en ...` 修复，不会重传 DMG。
- `--no-build` / `--no-publish` / `--no-deploy` / `--skip-artifact-upload`：跳过对应步骤。
- `--history-manifest-url`、`--current-manifest-url`：只在线上历史或当前版本元数据已损坏时用于恢复。
- `--tag-prefix`、`--tag-name`、`--release-commit-message`、`--allow-dirty-git`：覆盖 tag 与提交默认值。
- `--dry-run`：只预览，不打包、上传、部署或写文件，不请求远端 manifest。

## 发布说明

- 面向用户，只写能看到、感受到或直接使用的变化。
- 不写 harness、测试、重构、工程脚本、文档整理，除非它们改变了用户可见体验。
- 只有内部变化时，合并为“稳定性改进”，或暂缓发用户版本。
- 脚本合并线上、本地和可选历史 manifest 的 `releases`，按版本去重，保留最近 12 条。

## 验证

- 脚本不替代测试、Harness 验收或 CI；发布提交的验证见 `../validate-canvas-change/SKILL.md`。
- 改脚本后运行 `node apps/canvas-workspace/harness/skills/pulse-canvas-release/scripts/release-pulse-canvas.mjs --self-test-history`，再运行 `node scripts/harness/run-harness-check.mjs --level standard --path apps/canvas-workspace/harness/skills/pulse-canvas-release`。这些检查覆盖离线配置、无副作用预览和历史合并，不证明真实打包或云端上传成功。
- 仅执行用户授权的发布操作。迁移、检查或修改 skill 本身不表示授权发布。
