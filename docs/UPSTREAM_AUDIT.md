# 上游项目审计

本文档记录 2026-09-02 的一次性开源采用调查。它是决策记录，不是上游项目当前状态的长期镜像；实施前应再次核对目标文件和许可证。

## 审计对象

### YouTube Dual Subtitles

- 仓库：https://github.com/21317389/youtube-dual-subtitles
- 角色：优先评估的字幕获取、时间同步和播放器覆盖层来源。
- 许可证：MIT；许可证声明为 `Copyright (c) 2026 YouTube Dual Subtitles & Quick Translate Contributors`。
- 观察到的结构：原生 Manifest V3，主要由 `inject.js`、`content.js`、`background.js`、`popup.html`、`popup.js` 和 `styles.css` 组成，没有包构建步骤。
- 观察到的权限：`storage`，YouTube 域名以及 Google 翻译相关域名。

适合复用或参考的部分：

- YouTube 字幕轨道拦截；
- 普通视频与 Shorts 的页面状态处理；
- 播放器时间同步与进度跳转；
- 字幕覆盖层布局；
- 滚动字幕和噪声清理的现有行为。

需要重构后才能进入 CueWeave 的部分：

- 集中在 `content.js` 中的字幕处理、渲染和交互逻辑；
- 面向 Google 翻译端点的固定 Provider 实现；
- 使用 `chrome.storage.local` 保存大量翻译条目的缓存；
- 缺少 TypeScript 契约的跨上下文消息；
- 与 CueWeave 结构化 AI 重组不匹配的逐句翻译流程。

### Transly

- 仓库：https://github.com/1MoreBuild/transly
- 角色：OpenAI 兼容 Provider、上下文翻译、WXT 工程和测试策略的设计参考。
- 许可证：MIT。
- 观察到的技术方向：WXT、React、TypeScript、Playwright，以及 Chat Completions / Responses 兼容 Provider。

Transly 只作为独立设计参考。除非逐文件完成许可证和来源记录，不直接复制实现。

## 采用决策

CueWeave 建立独立的 WXT + TypeScript 仓库，不直接把新功能堆叠到上游原生 JavaScript 文件中。实施字幕抓取与播放器同步时，优先进行小范围、可测试的移植；每个移植文件都要在提交中注明来源，并保留 MIT 版权和许可条件。

这一决策保留上游已验证的浏览器行为，同时让字幕管线、Provider、任务调度和缓存成为可独立测试的模块。

## 许可证执行清单

引入任何第三方代码前必须：

1. 记录仓库 URL、目标提交和原始文件路径。
2. 确认该目标提交仍受兼容许可证约束。
3. 保留原文件头中的版权声明。
4. 将所需许可证文本和版权声明加入第三方声明文件。
5. 在提交说明中区分“移植”“改写”和“仅参考行为”。
6. 不复制未公开代码，也不以行为复刻方式绕过商业产品的授权机制。

## 已知审计限制

本次环境的命令行 GitHub 网络代理不可用，因此未在本地完成上游构建或逐文件测试。审计依据为 GitHub 公开仓库页面、原始 `manifest.json`、`ARCHITECTURE.md`、`LICENSE` 和 Transly 的 `package.json`。开始代码移植前，必须补做固定提交的本地克隆、测试和安全检查。
