# CueWeave 技术栈

本文档是 CueWeave 工程选型的规范入口。具体依赖版本由 `package.json` 和锁文件维护，本文只记录稳定的技术边界与选择理由。

## 结论

CueWeave 采用 WXT + TypeScript 构建 Manifest V3 扩展；Popup 与设置页使用 React；字幕处理、调度、校验和导出保持为无界面的纯 TypeScript 模块。数据使用 `chrome.storage.local` 与 IndexedDB 分层保存，自动化测试由 Vitest 和 Playwright 承担。

## 核心栈

| 层级           | 选择                                 | 用途                                                                                  |
| -------------- | ------------------------------------ | ------------------------------------------------------------------------------------- |
| 扩展框架       | WXT                                  | 生成 Chromium Manifest V3、管理 content script、service worker、popup 和 options 入口 |
| 语言           | TypeScript（strict）                 | 统一字幕数据结构、Provider 契约和跨上下文消息类型                                     |
| UI             | React                                | Popup、设置页和需要状态管理的播放器控制界面                                           |
| 图标           | Phosphor Icons                       | 统一 React SVG 图标、状态字重和可访问属性                                             |
| 样式           | 原生 CSS + CSS Custom Properties     | 控制扩展体积，并让播放器覆盖层不依赖运行时样式框架                                    |
| 浏览器 API     | WebExtension / Chrome Extension APIs | 存储、运行时权限、消息传递、下载和扩展生命周期                                        |
| 小型持久化     | `chrome.storage.local`               | 用户设置、Provider 配置、非敏感索引和小型状态                                         |
| 大型持久化     | IndexedDB（通过轻量封装）            | 完整字幕、语义分段、翻译结果和 LRU 元数据                                             |
| Schema 校验    | JSON Schema + Ajv                    | 校验模型结构化输出，并生成可复现的失败信息                                            |
| 单元与集成测试 | Vitest                               | 字幕管线、Provider、缓存键、导出与错误降级                                            |
| 浏览器端测试   | Playwright                           | 生成后的真实扩展、YouTube 页面行为和设置流程                                          |
| 静态质量       | ESLint + Prettier + TypeScript       | 代码规则、格式和类型检查                                                              |
| 包管理         | npm                                  | 与 Node 工具链保持一致，使用锁文件保证可复现安装                                      |
| CI             | GitHub Actions                       | 类型检查、单元测试、构建、端到端测试和安装包产出                                      |

Node 运行时的有效版本以仓库根目录的版本文件和 `package.json#engines` 为准，不在本文重复记录。

## 为什么不直接延续上游原生 JavaScript 结构

`youtube-dual-subtitles` 已验证字幕抓取、页面注入、覆盖层渲染和高频时间同步，但主要逻辑集中在 `content.js`、`background.js` 与 `inject.js`。CueWeave 还需要结构化 AI 输出校验、任务优先级、缓存失效、导出和大量故障测试，继续在大文件中增加分支会放大跨上下文消息和状态生命周期的风险。

采用 WXT 和 TypeScript 后，仍可按 MIT 许可证移植经过审计的上游模块，同时获得可构建入口、类型安全消息、测试隔离与可打包产物。详细采用规则见[上游审计](UPSTREAM_AUDIT.md)。

## 工程边界

### 保持纯 TypeScript 的模块

以下模块不得直接访问 DOM 或 Chrome API：

- 字幕标准化与噪声识别；
- 滚动字幕去重；
- 本地规则断句；
- 上下文窗口构造；
- AI 输出解析和 cue ID 完整性校验；
- 时间轴映射；
- 缓存键生成；
- SRT 与 WebVTT 导出。

这样可以用固定样本完成大部分测试，而不依赖真实 YouTube 或真实模型服务。

### 扩展上下文

- `background`：Provider 请求、密钥读取、运行时域名授权、队列与持久缓存协调。
- `content`：YouTube 单页导航、播放器状态、字幕获取、覆盖层和播放位置事件。
- `main-world bridge`：只负责必须在页面主世界完成的网络或播放器拦截，不接触 API Key。
- `popup`：常用开关、当前视频状态、显示模式和任务入口。
- `options`：Provider、字幕行为、样式、断句、提示词、术语表、缓存与许可证。

## Provider 实现原则

- 直接使用标准 `fetch`，不绑定单一厂商 SDK。
- 用同一契约适配 Chat Completions 与 Responses API。
- Base URL、模型名、超时和重试策略均由设置提供。
- 自定义远程域名必须通过运行时权限申请，不预先请求所有网站权限。
- `localhost` Provider 与远程 Provider 使用同一接口和错误分类。
- 测试使用本地确定性模拟服务，不需要真实 API Key。

## 暂不采用

- 服务端后端：违背本地优先和自带 API 的产品边界。
- 全局状态框架：初期状态规模不足以证明额外抽象成本。
- Tailwind 等运行时无关但配置较重的样式体系：播放器覆盖层更适合小型、可审计的原生 CSS。
- OpenAI 专用 SDK：会增加跨 Provider URL 和响应格式适配成本。
- Whisper 或媒体处理工具链：音频转录不在首个版本范围内。
