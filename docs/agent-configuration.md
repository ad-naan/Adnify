# Agent 配置入口

`configuration_discover`、`configuration_prepare`、`configuration_apply` 共用配置事务流程，支持 `kind: "mcp" | "skill" | "settings"`。

## 软件设置

先列出本版本已接入的设置键（本地查询，不访问在线目录）：

```json
{"kind":"settings"}
```

再查询具体设置的当前值、默认值、字段 schema、枚举和数值范围：

```json
{"kind":"settings","query":"editorConfig"}
```

准备修改字体和自动保存：

```json
{"kind":"settings","source":"editorConfig","scope":"user","value":{"fontSize":18,"autoSave":"afterDelay","autoSaveDelay":1000}}
```

修改语言或代理：

```json
{"kind":"settings","source":"language","scope":"user","value":"zh"}
```

```json
{"kind":"settings","source":"proxySettings","scope":"user","value":{"enabled":true,"rules":"http://127.0.0.1:7890","bypassRules":"localhost;127.0.0.1"}}
```

`prepare` 不保存配置；返回带有变更摘要的不可变事务。获批后，调用 `configuration_apply`，仅传回返回的 ID：

```json
{"change_set_id":"<prepare 返回的 UUID>"}
```

对象按字段递归合并，数组整体替换；软件设置使用 `user` 作用域。同一设置在预览后发生变化时拒绝应用，需要重新查询和准备。其他设置的并发修改会保留。保存后读取核验，失败时尝试恢复原值；回滚遇到更新的修改会报告冲突，不覆盖它。

部分模型路由会把 `value` 编码成 JSON 字符串。主进程先用目标设置的 schema 校验原值；校验失败且原值为字符串时，只解码一层 JSON 后重新校验。因此原生对象和它的 JSON 字符串形式均可使用，`aiInstructions` 等合法字符串设置不会被改写。`source` 仍须是 `editorConfig` 这样的完整注册键，不能写 `editorConfig.fontFamily`；`value` 内也不需要再套一层 `editorConfig`。无效字段、错误类型或多重编码会被拒绝，错误路径从 `value` 开始，并提示修正后再试。

目录覆盖应用设置、模型和服务商参数、编辑器/终端/Git/LSP/性能、Agent、安全和命令审批、网络、主题、快捷键、片段、索引、预览、情绪面板、个人资料、后台任务、资源能力及通知。以运行时发现结果为准，不能凭空写入未注册的键。

服务商 API 密钥和 OAuth 登录仍使用现有专用凭据入口；`providerConfigs` 不接受 `apiKey`。查询与变更摘要会隐藏已有密钥和认证头，不应将 `[REDACTED]` 写回配置。日志开关等标明重启生效的配置仍需重启。

## Skills 与 MCP 目录

- 无参数查询将 Adnify 中的 `installed` 与其他软件目录中可导入的 `external` 分开。`installed: []` 只说明未发现 Adnify 配置，不代表电脑上没有 Skills。
- `{"kind":"skill","query":"anthropics/skills"}` 直接读取 GitHub 仓库中的技能路径；返回的 `owner/repository@skill-id` 可用于准备安装。该路径不依赖 skills.sh。
- 普通能力词使用在线目录。请求有 30 秒上限，错误包含端点、HTTP 状态或超时原因及代理检查提示；MCP 网络失败不再转换为空列表。
- 多目录查询保留成功来源的结果，同时通过 `partial`、`warnings` 报告失败来源；所有来源失败时返回失败。Skill 成功搜索缓存 5 分钟，失败不缓存。
- 已知准确 Skill 来源时可以直接调用 `prepare`，不必先成功访问目录。仓库解析和安装仍需要网络。

## 扩展方式与验收

普通设置在 `src/shared/config/agentSettings.ts` 注册 schema、默认值和持久化位置。需要独立服务的配置使用 `settingsAdapter.register` 注册读写适配器（通知设置是示例），从而复用预览、审批、核验和回滚，不另造工具链。

手工验收：查询设置目录；修改字体/语言/主题并观察其他窗口；查询并修改代理后搜索 Skills；让 skills.sh 请求失败而另一个目录成功，确认仍返回结果和警告；准备修改后从设置页改同一项，确认旧事务被拒绝。真实目录可用性和界面同步需要在启动的 Electron 应用中验证，单元测试不替代此步骤。
