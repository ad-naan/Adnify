# 贡献指南 | Contributing Guide

感谢你对 Adnify 的关注！我们欢迎任何形式的贡献。

## 如何贡献

### 报告 Bug

1. 先搜索 [Issues](https://github.com/ad-naan/adnify/issues) 确认问题未被报告
2. 使用 Bug 报告模板创建新 Issue
3. 提供详细的复现步骤、环境信息和截图（含 Node / pnpm / OS 版本）

### 提交功能建议

1. 在 Issues 中搜索是否已有类似建议
2. 使用功能请求模板描述你的想法
3. 说明使用场景和预期效果

### 提交代码

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/your-feature`
3. 提交更改：`git commit -m 'feat: add some feature'`
4. 推送分支：`git push origin feature/your-feature`
5. 创建 Pull Request

## 开发环境

CI 使用 **Node.js 24.19.0** 和 **pnpm 11.22.0**。本地 Node 版本须满足 `^24.19.0`，pnpm 版本须与 `packageManager` 一致。

| 配置来源 | 文件 |
|----------|------|
| Node 精确版本 | `.nvmrc` / `.node-version` / `mise.toml` → **24.19.0** |
| 引擎约束 | `package.json` → `engines`（`node`: `^24.19.0`，`pnpm`: `11.22.0`） |
| 强制校验 | `pnpm-workspace.yaml` → `engineStrict` / `packageManagerStrictVersion` |
| 包管理器门禁 | `preinstall` → `scripts/ensure-pnpm.js`（拒绝 npm/yarn） |
| pnpm 精确版本 | `package.json` → `packageManager` |

```bash
# 克隆项目
git clone https://github.com/ad-naan/adnify.git
cd adnify

# 切换到仓库指定的 Node（任选其一）
nvm use        # 或 fnm use / mise install

# 启用 Corepack，自动使用 packageManager 声明的 pnpm
corepack enable

# 安装依赖（不要用 npm / yarn）
pnpm install

# 启动开发服务器
pnpm dev
```

常见问题：

- **`Unsupported engine` / install 被拒绝**：检查 Node 是否满足 `^24.19.0`，以及 pnpm 是否为 11.22.0。
- **`This repository requires pnpm`**：用了 npm/yarn。改用 `pnpm install`。
- **`Electron failed to install correctly`**：确认 Node **24.19.0+** 后执行：

```bash
rm -rf node_modules/electron
pnpm install
```

## 代码规范

- 使用 TypeScript 编写代码
- 遵循现有代码风格
- 提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/)：
  - `feat:` 新功能
  - `fix:` Bug 修复
  - `docs:` 文档更新
  - `style:` 代码格式
  - `refactor:` 重构
  - `test:` 测试相关
  - `chore:` 构建/工具

## 测试

```bash
# 运行测试
pnpm test

# 运行测试并生成覆盖率报告
pnpm test:coverage
```

## Pull Request 要求

- 确保所有测试通过
- 更新相关文档
- 添加必要的测试用例
- PR 描述清晰说明改动内容
- 本地 Node / pnpm 版本与仓库要求一致（见上方开发环境）

## CNB CI 和正式发布

`.cnb.yml` 在推送 `main` 或 `master` 时运行 Linux 和 Windows 检查，PR 在 CNB 的 Linux 节点上运行。两者都执行类型检查、单元测试、Chromium 回归和生产构建。

正式发布使用 CNB 的 Linux x64 和 arm64 节点，以及四个组织自托管节点。接入后，在 Runner 服务账户的 PATH 中配置 Git、Node.js 24.19.0 和 pnpm 11.22.0。

| Runner 标签 | 额外环境 |
| --- | --- |
| `windows, x64` 和 `windows, arm64` | Python 与对应架构的 Visual Studio C++ Build Tools |
| `macos, x64` 和 `macos, arm64` | Xcode Command Line Tools、Python 3 和 setuptools |

在根组织的「组织设置 → 构建节点」接入 Runner。桌面启动检查需要 Runner 账户能够启动应用。发布流水线使用 CNB 注入的临时 `CNB_TOKEN` 写入草稿与附件。仓库需公开，以便客户端匿名更新。[CNB 构建节点文档](https://docs.cnb.cool/zh/build/build-node.html)

从已准备好的发布分支运行 `node scripts/release.js patch`。脚本会更新版本、创建 tag，并将分支和该 tag 推送到 `cnb` 远程。若版本与 tag 已经准备好，只需把对应分支和新 tag 推送到 CNB。流水线要求 tag 与 `package.json` 中的正式版本一致，六组安装包和更新清单齐全后才发布。构建失败时，从 CNB 重跑该 tag 的整个构建，继续使用原草稿。安装包与更新文件都在 [CNB Releases](https://cnb.cool/aadnaan/Adnify/-/releases)。

首次切换时，可把桥接工作流同步到 GitHub 默认分支，再把同一个发布 tag 推到 GitHub，并手动运行 `Legacy updater bridge`，让仍在查询 GitHub 的旧客户端取得迁移版。也可以从 CNB 手动安装一次迁移版。当前 macOS 构建沿用无签名配置，内置安装失败时客户端会提供 CNB 下载入口。

## 许可协议

提交贡献即表示你同意将代码版权授予项目作者，详见 [LICENSE](LICENSE)。

## 联系方式

- 微信：adnaan_worker
- QQ群：1076926858
- Email：adnaan.worker@gmail.com
