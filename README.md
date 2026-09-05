# CueWeave（句织）

> Weave fragmented captions into fluent subtitles.
> 把碎片字幕编织成完整语义。

CueWeave 是由浏览器扩展、桌面应用与共享翻译核心组成的字幕项目。共享核心负责字幕算法、提示词、模型调用和通用校验；扩展服务 YouTube 跟播，桌面端服务媒体、字幕项目与编辑工作流。两端的能力和接入进度分别验收，算法与质量演进统一归入核心。

浏览器扩展读取视频已有字幕，在本地清洗和预断句，再使用用户配置的 OpenAI 兼容模型修复高置信度转录错误、完成语义重组与上下文翻译，最后将时间同步的原文、译文或双语字幕显示在播放器中。

扩展当前版本还提供独立的“字幕工作台”：可以检查原始转录与 AI 修正记录、为当前视频确认 `Soul → Sol` 一类术语、翻译完整视频，并导出原文、修复原文、中文或双语 SRT / WebVTT。AI 修正不会覆盖原始转录，低置信度建议只记录、不自动应用。

桌面客户端支持[在线边看边译](docs/DESKTOP_ONLINE_TRANSLATION.md)：英文视频优先自动读取英文原文字幕，在字幕侧栏开启翻译即可随播放预取并显示双语字幕，无需先下载视频。已完成结果缓存到本机；本地项目仍提供整片翻译、人工校对和字幕导出。

## 浏览器扩展的设计边界

- 只处理视频已有的人工字幕或自动字幕，不转录音频。
- 不提供官方翻译服务器；字幕只发送给用户主动配置的模型服务。
- API Key、设置和缓存保存在浏览器本地，不使用 Chrome Sync。
- 不自动上传观看记录、字幕内容或分析数据；需要反馈问题时可主动开启[本地调试并导出日志](docs/DEVELOPMENT.md#导出问题日志)。
- 不绕过其他产品的付费、会员或授权机制。

## 项目文档

- [共享翻译核心](docs/TRANSLATION-CORE.md)：两端共用基础设施的职责、接入现状、目标契约和迁移验收。
- [仓库结构](docs/WORKSPACE.md)：应用、共享核心与开发工具的职责和依赖边界。
- [产品需求](docs/PRODUCT_SPEC.md)：产品范围、功能需求和验收标准。
- [技术栈](docs/TECH_STACK.md)：工程选型、工具链和选择依据。
- [系统架构](docs/ARCHITECTURE.md)：模块边界、数据流、安全和降级策略。
- [本地开发](docs/DEVELOPMENT.md)：安装依赖、验证、构建和加载扩展。
- [桌面端开发规格](docs/DESKTOP.md)：Electron 播放器、ASR、项目保存与字幕工作流的实现要求。
- [翻译质量评分](docs/TRANSLATION-SCORING.md)：统一评分标准、证据、严重错误门槛与匿名评审工具。
- [字幕评测](docs/EVALUATION.md)：脱离播放器运行翻译、保存诊断记录、比较模型与提示词。
- [开发路线图](docs/ROADMAP.md)：分阶段交付顺序与完成条件。
- [上游审计](docs/UPSTREAM_AUDIT.md)：开源基础的许可证、结构和采用决策。
- [贡献指南](CONTRIBUTING.md)：本地开发约定和变更要求。
- [安全说明](SECURITY.md)：密钥处理、数据边界和漏洞报告方式。

## 本地验证

仓库使用 npm workspaces。浏览器扩展位于 `apps/extension`，共享字幕引擎位于 `packages/core`；Electron 桌面端的入口与开发状态见 [桌面工作区](apps/desktop/README.md)。以下命令均在仓库根目录执行。

```bash
npm install
npm run check
npm run zip
```

构建完成后，在 Chromium 的扩展管理页选择“加载已解压的扩展程序”，打开 `.output/chrome-mv3`。完整步骤与故障定位见[本地开发](docs/DEVELOPMENT.md)。

加载后打开带字幕的 YouTube 视频，点击扩展 Popup 中的“打开字幕工作台”即可进入当前视频的字幕工作台。中文、双语和修复原文导出会先要求完成整个视频的翻译，避免下载到只有部分窗口的文件；原始转录可直接导出。

## 许可证

CueWeave 采用 [MIT License](LICENSE)。从第三方项目移植代码时，必须同时保留对应版权声明和许可证文本；具体要求见[上游审计](docs/UPSTREAM_AUDIT.md)与[第三方声明](THIRD_PARTY_NOTICES.md)。
