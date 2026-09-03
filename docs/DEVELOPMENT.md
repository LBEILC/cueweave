# CueWeave 本地开发

本文档说明如何从干净检出验证、构建并加载 CueWeave。脚本名称和有效运行时约束以 `package.json`、锁文件及 `.nvmrc` 为准。

## 安装

```bash
npm install
```

安装会让 WXT 生成 TypeScript 环境文件。生成目录和依赖目录不提交到 Git。

## 开发服务器

```bash
npm run dev
```

WXT 会持续构建开发扩展。涉及 YouTube content script 或 main-world bridge 的变化后，应刷新目标视频页面，确保页面载入新脚本。

## 自动验证

```bash
npm run check
```

该命令依次运行类型检查、Lint、单元测试和生产构建。字幕领域测试使用固定 cue 样本，不访问 YouTube，也不调用外部模型服务。

只运行字幕测试：

```bash
npm test
```

## YouTube 字幕测试夹具

下载完整 JSON3 字幕轨并生成指定时间段的回归测试片段：

```bash
npm run fixture:youtube -- <video-id> [language] [from-ms] [to-ms]
```

完整字幕写入 `.fixtures/youtube`，仅供本地诊断且不提交 Git；指定时间段写入 `test/fixtures/youtube`，用于可重复的单元测试。脚本通过视频公开页面取得字幕轨，不读取浏览器 Cookie。默认语言为 `en`，默认时间段为 `330000–380000` 毫秒。

默认测试不会调用外部模型。需要用真实 Provider 验证已提交的字幕片段时，在当前终端设置 `CUEWEAVE_LLM_TOKEN`，再运行：

```bash
npx vitest run src/provider/real-world.integration.test.ts
```

该测试只从环境变量读取密钥，并断言真实词元的跨边界归属；未设置环境变量时自动跳过。

## 字幕翻译评测

完整字幕可以脱离浏览器运行同一翻译管线，保存请求与修复记录，并生成按原文范围对齐的模型对比页。运行、续跑和评审方法见[字幕离线评测](EVALUATION.md)。默认单元测试覆盖评测工具，不会调用模型；`eval:translate` 是显式联网的独立命令。

## 加载未打包扩展

1. 运行 `npm run build`。
2. 打开 `chrome://extensions` 或 `edge://extensions`。
3. 开启“开发者模式”。
4. 选择“加载已解压的扩展程序”。
5. 选择 `.output/chrome-mv3`。
6. 打开带字幕的 YouTube 视频并刷新一次页面。
7. 点击 CueWeave 图标，确认字幕覆盖层已开启。
8. 点击 Popup 底部的“字幕工具”，确认工作台能显示当前视频、翻译进度和修正记录；原始转录可直接导出，其余导出模式先点击“翻译全部字幕”。

这个流程只加载本地构建，不需要 API Key。字幕读取失败时，先确认视频本身存在字幕轨，再刷新视频页面并查看 Popup 中的具体状态。

## 打包

```bash
npm run zip
```

可分发 ZIP 会写入 `.output`。产物目录由构建生成，不提交到 Git。

## 字幕管线入口

- [`normalizeCue`](../src/domain/subtitle/normalize.ts)：文本标准化、说话人和噪声识别。
- [`deduplicateRollingCues`](../src/domain/subtitle/dedupe.ts)：滚动字幕增量提取与来源映射。
- [`buildSourceTokens`](../src/domain/subtitle/tokens.ts)：从清洗 cue 构建带时间的连续词元。
- [`createLocalDisplayCues`](../src/domain/subtitle/tokens.ts)：生成不依赖模型的原文降级字幕。
- [`createTokenWindows`](../src/domain/subtitle/tokens.ts)：为模型构建有界连续上下文。
- [`parseAiSubtitleOutput`](../src/domain/subtitle/ai.ts)：校验模型结构、词元覆盖、原文完整性和中文长度。
- [`serializeSubtitleFile`](../src/domain/subtitle/export.ts)：校验并序列化原始转录、修复原文、中文或双语 SRT / WebVTT。
- [`readVideoGlossary`](../src/context/videoGlossary.ts)：读取、清洗并维护按视频隔离的双语术语记忆。
- [`parseJson3Captions`](../src/platform/youtube/captions.ts)：保留 YouTube JSON3 cue 与词级时间的适配边界。
