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

## GitHub Actions CI 和正式发布

`.github/workflows/ci.yml` 在推送 `master`、创建或更新面向 `master` 的 PR 时，在 GitHub 托管的 Linux 和 Windows 节点上运行类型检查、单元测试、Chromium 回归和生产构建，也支持手动触发。

`.github/workflows/release.yml` 在推送 `v*` tag 时，使用 GitHub 托管节点分别构建 Windows、macOS、Linux 的 x64 和 arm64 安装包，汇总安装包、更新清单和 blockmap 后创建 GitHub Release。

从已准备好的发布分支运行 `node scripts/release.js patch`。脚本会更新版本、创建 tag，并将分支和该 tag 推送到 `origin` 的 `master` 分支。若版本与 tag 已准备好，将对应提交及 tag 推送到 GitHub 即可触发发布。安装包发布到 [GitHub Releases](https://github.com/ad-naan/adnify/releases)。

发布工作流还会同步代码和版本说明到 Gitee，需要配置 `GITEE_USERNAME` 和 `GITEE_TOKEN` 仓库密钥。内测发布使用 `internal-release.yml` 手动触发。

## 许可协议

提交贡献即表示你同意将代码版权授予项目作者，详见 [LICENSE](LICENSE)。

## 联系方式

- 微信：adnaan_worker
- QQ群：1076926858
- Email：adnaan.worker@gmail.com
