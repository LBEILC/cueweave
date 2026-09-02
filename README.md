# CueWeave（句织）

> Weave fragmented captions into fluent subtitles.
> 把碎片字幕编织成完整语义。

CueWeave 是面向 Chromium 浏览器的 YouTube 双语字幕扩展。它读取视频已有字幕，在本地清洗和预断句，再使用用户配置的 OpenAI 兼容模型完成语义重组与上下文翻译，最后将时间同步的原文、译文或双语字幕显示在播放器中。

## 设计边界

- 只处理视频已有的人工字幕或自动字幕，不转录音频。
- 不提供官方翻译服务器；字幕只发送给用户主动配置的模型服务。
- API Key、设置和缓存保存在浏览器本地，不使用 Chrome Sync。
- 不收集观看记录、字幕内容或分析数据。
- 不绕过其他产品的付费、会员或授权机制。

## 项目文档

- [产品需求](docs/PRODUCT_SPEC.md)：产品范围、功能需求和验收标准。
- [技术栈](docs/TECH_STACK.md)：工程选型、工具链和选择依据。
- [系统架构](docs/ARCHITECTURE.md)：模块边界、数据流、安全和降级策略。
- [本地开发](docs/DEVELOPMENT.md)：安装依赖、验证、构建和加载扩展。
- [开发路线图](docs/ROADMAP.md)：分阶段交付顺序与完成条件。
- [上游审计](docs/UPSTREAM_AUDIT.md)：开源基础的许可证、结构和采用决策。
- [贡献指南](CONTRIBUTING.md)：本地开发约定和变更要求。
- [安全说明](SECURITY.md)：密钥处理、数据边界和漏洞报告方式。

## 本地验证

```bash
npm install
npm run check
npm run zip
```

构建完成后，在 Chromium 的扩展管理页选择“加载已解压的扩展程序”，打开 `.output/chrome-mv3`。完整步骤与故障定位见[本地开发](docs/DEVELOPMENT.md)。

## 许可证

CueWeave 采用 [MIT License](LICENSE)。从第三方项目移植代码时，必须同时保留对应版权声明和许可证文本；具体要求见[上游审计](docs/UPSTREAM_AUDIT.md)与[第三方声明](THIRD_PARTY_NOTICES.md)。
