# 安全与隐私

## 数据边界

CueWeave 不提供官方翻译服务器。字幕只会发送给用户在设置中主动选择并授权的模型服务。该服务的计费、可用性、日志和数据保留政策由服务提供方负责。

设置、缓存和翻译结果默认保存在用户浏览器本地。项目不使用 Chrome Sync，不收集观看记录，不集成分析或跟踪 SDK。

## API Key

- 只保存在 `chrome.storage.local`。
- 只由 background service worker 读取。
- 不发送给 YouTube 页面或 content script。
- 不写入日志、错误报告、导出字幕、测试 fixture 或 Git 历史。
- 界面展示时默认遮蔽，诊断信息只描述认证状态，不回显值。

用户应使用权限受限、可轮换的密钥，并遵守所选 Provider 的安全建议。

## 域名权限

扩展只静态申请 YouTube 工作所需权限。自定义模型服务 origin 由用户在配置或连接测试时授权；移除 Provider 后应允许用户撤销不再使用的权限。

## 报告漏洞

请不要在公开 Issue 中提交密钥、字幕内容、请求头或其他敏感信息。仓库启用私密安全报告后，应优先使用 GitHub 的 Private vulnerability reporting；在此之前，请联系仓库所有者并只提供最小复现信息。
