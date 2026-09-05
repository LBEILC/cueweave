# CueWeave 本地开发

本文档说明如何从干净检出验证、构建并加载 CueWeave。脚本名称和有效运行时约束以 `package.json`、锁文件及 `.nvmrc` 为准。

## 安装

以下命令均在仓库根目录执行。目录职责和依赖方向见[仓库结构](WORKSPACE.md)。

```bash
npm install
```

安装会链接本地工作区，并让 WXT 在 `apps/extension/.wxt` 生成 TypeScript 环境文件。生成目录和依赖目录不提交到 Git。

CI 和需要严格使用锁文件的环境运行 `npm ci`。子应用不维护独立锁文件。

## 开发服务器

```bash
npm run dev
```

WXT 会持续构建开发扩展。涉及 YouTube content script 或 main-world bridge 的变化后，应刷新目标视频页面，确保页面载入新脚本。

根目录的 `dev`、`build` 和 `zip` 委托给 `@cueweave/extension` 工作区。也可以使用 `npm run dev --workspace @cueweave/extension` 直接运行扩展。桌面入口见[桌面工作区](../apps/desktop/README.md)。

## 界面预览

运行 `npm run preview:ui`，打开终端给出的本地地址，可查看字幕工作台、Popup、设置页和播放器字幕的浅深色及窄屏布局。预览使用合成示例数据，不读取扩展存储，也不连接模型服务；术语、模型配置、字幕显示和缓存操作只保留在当前页面内，刷新后重置。可切换完整翻译、空记录和失败等状态。设置页的连接测试使用模拟结果。

播放器预览复用 `apps/extension/src/ui/player-overlay.ts` 的实际字幕组件，可检查双语比例、长句、背景、重试和全屏。画面与翻译结果均为合成示例；真实视频验收仍需按下文加载扩展，在可播放且有字幕的 YouTube 视频上检查。

预览在启动时编译界面。修改源码后重启命令即可更新；它不替代加载扩展后的真实视频联调。

## 自动验证

```bash
npm run check
```

该命令依次运行格式检查、各工作区与评测工具的类型检查、Lint、单元测试以及扩展和桌面生产构建。字幕领域测试使用固定 cue 样本，不访问 YouTube，也不调用外部模型服务。真实 Electron 窗口的独立验证见[桌面验证](../apps/desktop/README.md#验证)。

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
npx vitest run apps/extension/src/provider/real-world.integration.test.ts
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
8. 点击 Popup 中的“打开字幕工作台”，确认工作台能显示当前视频、翻译进度和修正记录；原始转录可直接导出，其余导出模式先点击“翻译全部字幕”。

这个流程只加载本地构建，不需要 API Key。字幕读取失败时，先确认视频本身存在字幕轨，再刷新视频页面并查看 Popup 中的具体状态。

更新本地构建后，在扩展管理页重载 CueWeave，再刷新已打开的 YouTube 视频页。扩展重载不会替换旧页面中的内容脚本；Popup 打开期间会持续更新读取与翻译状态。

## 导出问题日志

1. 在设置页打开“问题排查”，开启“调试模式”。已打开的视频页面会立即开始记录后续过程。
2. 回到视频，在出现问题的位置打开扩展弹窗，点击“导出当前问题日志”。不用先翻译完整视频。
3. 将下载的 JSON 文件与问题描述一起反馈。显示错位或闪烁可以另附截图或短录屏。
4. 排查结束后关闭调试模式，清除本地日志。

如果问题发生后才开启调试，原始模型响应无法补录；需要保留现场后，在调试开启时重现。命中缓存、页面脚本未响应等缺失信息会写入文件，无法读取播放位置时记为未知。首次使用新构建前仍需重载扩展并刷新视频页面。数据与保留约定见[调试与问题反馈](PRODUCT_SPEC.md#调试与问题反馈)。

## 打包

```bash
npm run zip
```

可分发 ZIP 会写入仓库根目录的 `.output`。扩展产物路径由 `apps/extension/wxt.config.ts` 的 `outDir` 定义，产物目录由构建生成，不提交到 Git。

## 字幕管线入口

- [`normalizeCue`](../packages/core/src/domain/subtitle/normalize.ts)：文本标准化、说话人和噪声识别。
- [`deduplicateRollingCues`](../packages/core/src/domain/subtitle/dedupe.ts)：滚动字幕增量提取与来源映射。
- [`buildSourceTokens`](../packages/core/src/domain/subtitle/tokens.ts)：从清洗 cue 构建带时间的连续词元。
- [`createLocalDisplayCues`](../packages/core/src/domain/subtitle/tokens.ts)：生成不依赖模型的原文降级字幕。
- [`PlaybackPlan`](../packages/core/src/provider/playbackPlan.ts)：以本地初始窗口为起点，滚动规划接缝并固定已使用的边界；支持就近跳转和缓存快照恢复。
- [`selectBufferWork`](../apps/extension/src/provider/playbackBuffer.ts)：播放器缓冲决策入口；调参入口为同文件的 `PLAYBACK_BUFFER_POLICY`，行为约定见[翻译调度](PRODUCT_SPEC.md#翻译调度)。
- [`translatePlaybackWindow`](../packages/core/src/provider/chatCompletions.ts)：播放器使用的模型传输入口，接入首轮联合分段与翻译、完整性校验及有限恢复。
- [`translateFirstPass`](../packages/core/src/provider/firstPass.ts)：浏览器与首轮实验共享的纯翻译流程。原有 `translateTokenWindow` 保留供旧评测基线使用，不是默认播放入口。
- [`serializeSubtitleFile`](../packages/core/src/domain/subtitle/export.ts)：校验并序列化原始转录、修复原文、中文或双语 SRT / WebVTT。
- [`readVideoGlossary`](../apps/extension/src/context/videoGlossary.ts)：读取、清洗并维护按视频隔离的双语术语记忆。
- [`parseJson3Captions`](../apps/extension/src/platform/youtube/captions.ts)：保留 YouTube JSON3 cue 与词级时间的适配边界。

播放流程的语义与降级约定见[产品规格](PRODUCT_SPEC.md#两层断句)。模型默认值由 `packages/core/src/provider/settings.ts` 的 `DEFAULT_PROVIDER_SETTINGS` 维护，更新构建不会覆盖用户已保存的 Provider；对比实验效果时请先确认设置页中的模型名称。新流程的译文缓存与旧算法分开，不需要手动删除所有历史缓存。

需要显式联网检查生产规划与翻译入口时，可用已有完整评测数据运行小样本检查（输出目录必须不存在，密钥只在进程内读取）：

```bash
npx tsx scripts/smoke-playback.ts --from .eval/runs/baseline-gemini --out .eval/playback-smoke --token-file <本地密钥文件>
```

这项检查不代替浏览器的扩展重载、播放和跳转验收；默认 `npm test` 不访问模型服务。

调度回归可运行 `npx vitest run apps/extension/src/provider/playbackBuffer.test.ts apps/extension/src/provider/playbackBufferContent.test.ts packages/core/src/provider/translationQueue.test.ts`。其中内容脚本测试使用模拟视频、时钟和模型响应，覆盖暂停、补洞、重试上限和会话失效；浏览器验收还需确认真实网络耗时下的缓冲增长。播放器叠层的 `data-cueweave-buffered-seconds` 与 `data-cueweave-buffer-target-seconds` 分别暴露实际连续时长和目标，`[CueWeave]` 日志记录窗口范围、耗时与失败代码，不记录字幕正文或密钥。
