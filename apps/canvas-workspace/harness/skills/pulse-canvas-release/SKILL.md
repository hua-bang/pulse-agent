---
name: pulse-canvas-release
description: 使用本地脚本发布 Pulse Canvas 的 macOS arm64 版本，并同步更新 R2 的 latest.json 与下载页站点。适用于“本地发版流程、发布新版本、更新下载页”请求。
---

# Pulse Canvas Release

这个 Skill 用于本地统一发布 Pulse Canvas。

### 前置条件与验证
- 从仓库根目录执行命令；其他目录使用 `--repo` 指定仓库根目录。
- 读取 Canvas AGENTS 与 `../validate-canvas-change/SKILL.md`，按仓库规则完成对应发布提交的验证。脚本不替代测试、Harness 验收或 CI。
- 本机需要 pnpm、Git、Wrangler；创建 PR 使用 GitHub CLI。认证使用本机登录状态或环境变量，不把凭据写入 skill、参数示例或仓库。
- 仅执行用户授权的发布操作；迁移、检查或修改 skill 本身不表示授权发布应用。

脚本：[scripts/release-pulse-canvas.mjs](scripts/release-pulse-canvas.mjs)。

核心执行链路：
- 更新 `apps/canvas-workspace/package.json` 的版本号（仅本地文件）
- 打包 macOS arm64 DMG
- 直接上传 R2，并生成/更新 `latest.json`
- 部署下载页到 Cloudflare Pages
- 提交版本号变更，推送分支并创建 PR
- PR 合并后，在合入目标分支的提交上创建 `pulse-canvas-vX.Y.Z` tag 并推送

网络约定：
- 脚本内所有 `wrangler` 上传和 Pages 部署默认绕过代理环境变量，避免大文件上传卡在本机代理链路。
- 默认会清理 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 以及对应小写变量；如确实需要代理，可显式加 `--use-proxy`。
- R2 大文件上传必须观察进度：脚本会为 5MB 以上的 R2 上传定期打印 elapsed 与 macOS `nettop` 观测到的流量。若 2-3 个采样周期内没有增长，停止当前上传并用相反网络模式重试（默认直连卡住则加 `--use-proxy`，代理卡住则去掉 `--use-proxy`）。
- 上传完成前不要请求不带查询参数的最终下载 URL：CDN 可能缓存 404，时长取决于部署配置。上传后先用 `?release=<version>` 核验对象；若基础 URL 已被探测并缓存 404，更新 manifest 中的产物链接以携带该版本查询参数，或定向清理 CDN 缓存后再发布下载页。

脚本随仓库维护；它调用应用现有打包命令，并使用 `apps/canvas-workspace/download-site` 生成下载页。

建议触发参数：
- 先准备新版本号：`0.1.1`
- 先基于最近 release tag 到当前发布提交的 diff 生成发布说明：只写用户可感知变化，不写内部 harness、测试、重构、脚本等开发者才感知的内容
- 运行脚本更新本地 `package.json` 版本、打包 arm64、上传 R2、发布 Pages
- 发布说明可用 `--notes`，也可用 `--notes-zh` / `--notes-en` 写双语 release note
- 发布说明不能为空；如果必须先发产物再生成最终说明，显式使用 `--notes-pending`，随后必须用 `--manifest-only --no-build --notes-zh ... --notes-en ...` 修复 `latest.json` 并重新部署下载页
- 稳定发布默认走 PR：发布产物完成后提交 `release(canvas): <version>`，推送当前分支，创建 PR；PR 合并后再从目标分支创建并推送 `pulse-canvas-v<version>` tag
- 只有在明确不需要 PR 的情况下，才使用 `--push-git` 让脚本直接提交、打 tag、推送分支和 tag

### 本地部署配置
仓库不提供真实部署目标。通过环境变量或同名用途的参数配置；参数优先。

| 环境变量 | 参数 | 用途 |
|---|---|---|
| `PULSE_CANVAS_REPO_DIR` | `--repo` | 仓库路径，默认当前目录 |
| `PULSE_CANVAS_R2_BUCKET` | `--bucket` | R2 桶，上传时必填 |
| `PULSE_CANVAS_RELEASE_BASE_URL` | `--release-base-url` | 对象公开 URL 前缀，包含产品和通道目录，上传时必填 |
| `PULSE_CANVAS_DOWNLOAD_URL` | `--download-url` | 下载页公开 URL，生成 manifest 时必填 |
| `PULSE_CANVAS_PAGES_PROJECT` | `--project-name` | Pages 项目，部署时必填 |

例如，仅在本机设置以下变量；这里的目标都是示例：

```bash
export PULSE_CANVAS_R2_BUCKET='your-release-bucket'
export PULSE_CANVAS_RELEASE_BASE_URL='https://downloads.example.com/pulse-canvas/stable'
export PULSE_CANVAS_DOWNLOAD_URL='https://download.example.com'
export PULSE_CANVAS_PAGES_PROJECT='your-download-project'
```

部署域名只接受不含用户名、密码、查询参数或片段的公开 HTTP(S) URL。凭据通过 Wrangler 本机认证或环境变量注入；不要放进 URL。脚本不自动加载 `.env`。如用本地 `.env.release`，先确认它被 Git 忽略，不要强制加入版本控制。

产品目录默认 `pulse-canvas`，通道默认 `stable`，Git 合并目标默认 `master`，Pages 部署分支默认 `main`。改变产品或通道时，同步修改对象 URL 前缀。缺少所需配置会在版本修改和打包前退出；只打包时可使用 `--no-publish --no-deploy`。

### 快速运行
```bash
node apps/canvas-workspace/harness/skills/pulse-canvas-release/scripts/release-pulse-canvas.mjs \
  --version 0.1.1 \
  --notes-zh "新增下载页发布和应用内更新提示。" \
  --notes-en "Added the download page flow and in-app update notice."
```

发布脚本成功后，提交版本号并创建 PR：

```bash
git add apps/canvas-workspace/package.json
git commit -m "release(canvas): 0.1.1"
git push -u origin "$(git branch --show-current)"
gh pr create --fill
```

PR 合并后，从目标分支打 tag；这一步不能省略，完成前不要宣称 release 流程结束：

```bash
git fetch origin master --tags
git tag -a pulse-canvas-v0.1.1 origin/master -m "Pulse Canvas 0.1.1"
git push origin pulse-canvas-v0.1.1
git ls-remote --tags origin "pulse-canvas-v0.1.1*"
```

### 常用参数
- `--version <semver>`：发布版本号（会写入应用 package.json）
- `--notes "<说明>"`：发布说明（写入 manifest）
- `--notes-zh "<中文说明>"`：中文发布说明（写入 manifest.notes.zh）
- `--notes-en "<English notes>"`：英文发布说明（写入 manifest.notes.en）
- `--repo "/path/to/repo"`：覆盖默认仓库路径
- `--release-base-url <url>`：覆盖 R2 对象目录 URL 前缀（无内置部署目标）
- `--download-url <url>`：覆盖下载页域名（无内置部署目标）
- `--project-name <name>`：覆盖 Pages 项目名（无内置部署目标）
- `--branch <name>`：覆盖部署分支（默认 `main`）
- `--no-build` / `--no-publish` / `--no-deploy`：按需跳过步骤
- `--use-proxy`：让 `wrangler` 继承当前代理环境变量；默认不使用代理
- `--upload-progress-interval <秒>`：R2 大文件上传进度采样间隔（默认 15 秒）
- `--no-upload-progress`：关闭上传进度观察（不推荐）
- `--manifest-only` / `--latest-only`：只写入并上传 `latest.json`，仍会部署下载页；用于补发/修正 release note，不会重传 DMG
- `--history-manifest-url <url>`：从指定的 Pages 历史部署或备份 manifest 恢复 release notes；正常发布会自动读取线上 `latest.json`，仅在历史已损坏时需要
- `--current-manifest-url <url>`：从指定部署恢复当前版本的文件列表与发布时间；仅用于线上 manifest 已把当前 DMG 元数据覆盖时
- `--skip-artifact-upload`：跳过 DMG/blockmap 等产物上传，只上传 `latest.json`
- `--notes-pending`：显式写入临时占位 release note。只能作为短暂过渡，随后必须用 `--manifest-only` 写入正式说明
- `--commit-tag`：发布成功后提交版本号变更并创建 tag，不推送
- `--push-git`：发布成功后提交版本号变更、创建 tag，并推送当前分支和 tag；仅用于明确不走 PR 的发布
- `--tag-prefix <prefix>`：覆盖 tag 前缀（默认 `pulse-canvas-v`）
- `--tag-name <name>`：覆盖完整 tag 名
- `--git-base <branch>`：PR 合并后打 tag 的目标分支提示（默认 `master`）
- `--release-commit-message "<msg>"`：覆盖版本提交信息（默认 `release(canvas): <version>`）
- `--allow-dirty-git`：允许 git 工作区不干净时继续执行 commit/tag 流程；默认会阻止
- `--dry-run`：只预览，不打包、上传、部署或写文件，也不请求远端 manifest；Git 模式仍执行本地只读检查。仍需提供配置和本地产物（或 manifest-only 所需的本地 manifest）

### Release note 生成与修复
- 默认发布前必须准备 release note。脚本在会写入/上传 `latest.json` 时，如果没有 `--notes` / `--notes-zh` / `--notes-en` / `--notes-pending` 会直接失败。
- 生成 release note 时，用最近 tag 作为基线，例如：
  `git log pulse-canvas-v0.1.9..HEAD -- apps/canvas-workspace packages/canvas-cli packages/canvas-nodes`
- 如果已经上传了产物但 note 还是占位，不要重传 DMG；使用：
```bash
node apps/canvas-workspace/harness/skills/pulse-canvas-release/scripts/release-pulse-canvas.mjs \
  --version 0.1.10 \
  --no-build \
  --manifest-only \
  --notes-zh "..." \
  --notes-en "..."
```
- `--manifest-only` 会重写并上传 `latest.json`，然后重新部署下载页，适合补发 release note。
- 脚本会合并线上、本地和可选历史 manifest 的 `releases`，按版本去重并保留最近 12 条；fresh worktree 发布也不会再清空历史。
- 修改历史合并逻辑后运行 `node apps/canvas-workspace/harness/skills/pulse-canvas-release/scripts/release-pulse-canvas.mjs --self-test-history`，确认当前版本文件优先级和 12 条历史窗口。

- 修改脚本后，运行仓库标准验收：
  `node scripts/harness/run-harness-check.mjs --level standard --path apps/canvas-workspace/harness/skills/pulse-canvas-release`。绑定检查包含离线配置、无副作用预览和历史合并验证；不证明真实打包或云端上传成功。

### Release note 原则
- 公开 release note 面向用户，只写用户能看到、感受到或直接使用的变化。
- 不写内部验证能力、harness、测试、重构、工程脚本、文档整理，除非它们改变了用户可见体验。
- 如果某次发布只包含内部开发能力，公开说明可以合并到更宽泛的“稳定性改进”，或者暂缓发用户版本。

### Git 版本记录建议
- monorepo 内 Pulse Canvas tag 使用 `pulse-canvas-vX.Y.Z`，避免和其他 package 的 `vX.Y.Z` 混淆。
- 从 `0.1.9` 开始，每次稳定发布都应推一个 release commit 和 annotated tag。
- 如果发布分支需要 PR，先合并 PR，再在合入后的目标分支提交上创建 tag；避免 tag 指向未合入或被 squash 掉的临时分支提交。
- 打 tag 后必须验证远端 tag：`git ls-remote --tags origin "pulse-canvas-vX.Y.Z*"`；如果没有输出，说明 GitHub tag 没有创建成功。
- 下一次生成 release note 时，以最近 tag 为基线，例如：`git log pulse-canvas-v0.1.9..HEAD -- apps/canvas-workspace packages/canvas-cli packages/canvas-nodes`。
