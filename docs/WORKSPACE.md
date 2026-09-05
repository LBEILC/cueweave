# 仓库结构与依赖边界

CueWeave 使用 npm workspaces 管理应用与共享包。依赖在仓库根目录安装，由根目录 `package-lock.json` 统一锁定。

| 目录             | 职责                                                                               |
| ---------------- | ---------------------------------------------------------------------------------- |
| `apps/extension` | WXT 浏览器扩展，包括页面入口、YouTube 接入、浏览器权限与存储、播放器叠层及扩展资源 |
| `apps/desktop`   | Electron 桌面应用工作区，承载本地播放器、媒体导入、ASR 和项目保存                  |
| `packages/core`  | 纯字幕处理、模型传输与翻译、窗口规划、通用队列、设置解析和字幕导出                 |
| `scripts`        | 仓库级评测、实验、字幕样本获取和扩展界面预览                                       |
| `test/fixtures`  | 固定回归样本，供共享核心、扩展与评测工具使用                                       |
| `docs`           | 产品规格、架构、开发和评测文档                                                     |

各应用的启动与构建入口由各自 `package.json` 的 `scripts` 定义。日常安装、验证和扩展加载步骤见[开发指南](DEVELOPMENT.md)。

## 依赖方向

应用通过 `@cueweave/core` 的包入口使用共享能力。应用之间不直接导入源码；共享核心不能导入应用、Electron、WXT，也不能访问 `browser`、`chrome`、`window` 或 `document`。

共享核心的公开入口由 [`packages/core/package.json`](../packages/core/package.json) 的 `exports` 定义：

- `@cueweave/core` / `@cueweave/core/subtitle`：字幕类型、清洗、词元、实体证据和导出。
- `@cueweave/core/subtitle/*`：字幕领域模块，包括 AI 输出校验。
- `@cueweave/core/provider/*`：Provider 类型、配置解析、模型调用、首轮翻译、窗口规划和通用队列。
- `@cueweave/core/settings/subtitle`：字幕显示偏好的类型、默认值与解析。

共享包直接导出 TypeScript 源码，由应用构建工具或评测工具编译；不维护另一份生成后的源码。跨包引用使用包名，不通过相对路径访问 `packages/core/src`。

## 平台操作

[`ProviderRuntime`](../packages/core/src/provider/runtime.ts) 提供模型请求、访问检查与诊断的注入接口。核心传输默认使用标准 `fetch`；访问策略由宿主负责。浏览器扩展必须通过自己的 [`chatCompletions.ts`](../apps/extension/src/provider/chatCompletions.ts) 适配器调用，以保留模型域名权限检查。

Provider 和字幕偏好的解析放在共享核心，浏览器存取放在扩展端。浏览器消息协议、IndexedDB 缓存、视频术语存储和播放缓冲策略也由扩展维护。桌面端的本地文件、密钥存储、ASR 进程与持久任务由桌面宿主实现。

YouTube 页面接入属于扩展。仓库级 YouTube 评测可以复用扩展中的 JSON3 解析器；共享核心及桌面应用不依赖这个适配器。

## 验证和资源

根目录 `vitest.config.ts` 收集各应用、共享包和评测工具的测试；`tsconfig.base.json` 维护共同的严格类型规则。核心包独立类型检查，扩展另行生成 WXT 类型，桌面分别检查 Node 与 Web 入口；ESLint 检查共享核心、桌面渲染层及应用间的依赖边界。

扩展字体、图标和静态资源位于 `apps/extension/public`；桌面使用 `apps/desktop/resources/public` 的独立打包资源。桌面与评测报告复用未经修改的官方字体及许可，声明见[第三方声明](../THIRD_PARTY_NOTICES.md)。

`.eval`、`.fixtures` 和 `.impeccable/review` 为本地工作数据。扩展的 WXT 类型位于 `apps/extension/.wxt`；扩展安装包和可加载产物位于仓库根目录的 `.output`，具体路径由扩展构建配置定义。`.wxt`、`.output` 和 `dist` 均为生成目录，不提交到 Git。

历史文档入口与本地资料的归档、恢复方式见[归档说明](archive/README.md)。
