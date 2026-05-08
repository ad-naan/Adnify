# 贡献指南 | Contributing Guide

感谢你对 Adnify 的关注！我们欢迎任何形式的贡献。

## 如何贡献

### 报告 Bug

1. 先搜索 [Issues](https://github.com/ad-naan/adnify/issues) 确认问题未被报告
2. 使用 Bug 报告模板创建新 Issue
3. 提供详细的复现步骤、环境信息和截图

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

```bash
# 克隆项目
git clone https://github.com/ad-naan/adnify.git
cd adnify

# 安装依赖
npm install

# 启动开发服务器
npm run dev
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
npm run test

# 运行测试并生成覆盖率报告
npm run test:coverage
```

## Pull Request 要求

- 确保所有测试通过
- 更新相关文档
- 添加必要的测试用例
- PR 描述清晰说明改动内容

## 许可协议

提交贡献即表示你同意将代码版权授予项目作者，详见 [LICENSE](LICENSE)。

## 联系方式

- 微信：adnaan_worker
- QQ群：1076926858
- Email：adnaan.worker@gmail.com
