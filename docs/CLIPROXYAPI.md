# CueWeave 连接 CLIProxyAPI

CLIProxyAPI 是第三方开源本机代理。它可以通过 Codex OAuth 登录，将支持的模型暴露为 OpenAI 兼容接口；CueWeave 只把它当作用户自行运行的 Provider，不安装代理、不发起 OAuth，也不读取代理保存的 ChatGPT 凭据。

## 额度边界

使用 ChatGPT 账号登录 Codex 时，消耗的是该账号可用的 Codex / agentic usage。它不是 OpenAI Platform API 额度。OpenAI 官方说明 ChatGPT 与 API 分开计费，ChatGPT 的灵活用量 credits 也不是 API credits：

- [OpenAI：ChatGPT 与 API 分开计费](https://help.openai.com/en/articles/9039756)
- [OpenAI：Codex 可使用 ChatGPT 方案内用量](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan)
- [OpenAI：ChatGPT credits 不是 API credits](https://help.openai.com/en/articles/12642688)

CLIProxyAPI 的兼容转发能力由该第三方项目实现，不等于 OpenAI 对通用 API 用途的官方承诺。其兼容性、账号风险、限额变化和升级行为应以项目最新文档及 OpenAI 适用条款为准。

## 安全边界

- 只从[官方 CLIProxyAPI 仓库](https://github.com/router-for-me/CLIProxyAPI)或其文档指向的发行渠道安装。
- 服务绑定 `127.0.0.1`，不要直接暴露到局域网或公网。
- 在 CLIProxyAPI 中配置独立的本机访问 Key；CueWeave 设置页填写的是这个 Key，不是 ChatGPT 密码、Cookie、OAuth token 或 Codex 的认证文件。
- OAuth 登录和认证文件始终由 CLIProxyAPI 自己管理。CueWeave 不接触、复制或上传这些材料。
- CLIProxyAPI 更新后重新测试连接；第三方代理的兼容转换可能随版本变化。

## CueWeave 设置

1. 先在本机独立安装并启动 CLIProxyAPI，完成 Codex OAuth 登录。
2. 确认代理只监听回环地址，并为客户端配置访问 Key。
3. 在 CLIProxyAPI 的 `/v1/models` 结果中确认准备使用的模型名。
4. 打开 CueWeave 设置，点击“填入本机预设”。
5. Base URL 保持 `http://127.0.0.1:8317/v1`，请求格式选择 `Responses`。
6. 填入 CLIProxyAPI 的本机访问 Key 和实际模型名，点击“保存并测试连接”。

如果端口、路径或模型名经过自定义，以本机 CLIProxyAPI 配置为准。CueWeave 也支持 `Chat Completions`；Codex OAuth 路由优先使用 `Responses`，避免依赖额外的协议转换。
