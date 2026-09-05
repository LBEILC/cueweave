# CueWeave Desktop

Electron 桌面应用工作区。当前提供安全宿主、统一的 DOM 播放器、视频链接播放、后台媒体探测、字幕项目编辑与持久化，以及 Windows x64 安装包。链接入口支持 HTTP(S) 媒体直链，以及公开的 YouTube 和哔哩哔哩单视频；翻译按 D2 接入，ASR 路线确定前不下载模型或调用识别服务。

产品边界、进程架构、媒体与 ASR 接入、项目持久化及验收要求见[桌面端开发规格](../../docs/DESKTOP.md)。实现顺序与阶段完成条件由[开发路线图](../../docs/ROADMAP.md#桌面应用)维护。

宿主实现与兼容性实验的边界、风险和证据要求见 [D0 实施与验收](../../docs/DESKTOP_D0.md)。

项目创建、字幕导入、编辑、撤销重做、关闭恢复和原文导出的范围见 [D1 实施与验收](../../docs/DESKTOP_D1.md)。

模块依赖规则见[仓库结构与依赖边界](../../docs/WORKSPACE.md)。依赖统一在仓库根目录安装，可用命令以本目录的 [package.json](package.json) 为准。

## 运行

在仓库根目录运行：

```bash
npm install
npm run dev:desktop
```

开发服务器仅监听本机；关闭窗口或在终端按 Ctrl+C 结束开发会话。首次运行会下载锁定版本的 Electron 官方运行时，需要网络连接。

验证生产构建：

```bash
npm run build:desktop
npm run start:desktop
```

构建输出位于本工作区的 `dist/`。工作台可以通过系统对话框或拖放打开本地视频，也可以读取直链、YouTube 或哔哩哔哩单视频元信息后直接在线播放；下载作为独立的离线入口保留。所有来源由页面内的 DOM 播放器呈现，网站流通过随包 yt-dlp 解析并由主进程代理；磁盘路径和实际站点媒体地址不会暴露给 renderer。关于页面读取真实宿主信息，字体许可使用系统 PDF 阅读器打开。

桌面工作台默认窗口为 1280×820，按可用桌面适配并记住调整后的大小。视频适应剩余空间，底部播放控制保持可见；字幕面板可收起，支持加载字幕、搜索、当前句标记和点击定位。创建项目后可修改字幕文本与毫秒时间、撤销重做、保存和导出。窄窗口中侧栏覆盖画面右侧，播放控制分行；低高度编辑时优先显示可滚动表单。打开其他视频或关于时，当前播放器持续挂载；取消或返回不会重置播放位置。

构建 Windows x64 目录产物或 NSIS 安装包：

```bash
npm run pack:desktop
npm run dist:desktop
```

目录产物与安装包位于 `apps/desktop/dist/package/`。打包会针对 Electron x64 重新构建 `better-sqlite3`，并把清单中的 FFmpeg、ffprobe、yt-dlp 与 Deno 放入应用资源目录。

## 验证

```bash
npm run typecheck --workspace @cueweave/desktop
npm run test:desktop:smoke
npm run test:desktop:project
npm run pack:desktop
npm run test:desktop:d0
npm run test:desktop:links
npm run dist:desktop
npm run test:desktop:installer
```

冒烟检查使用隐藏的真实 Electron 窗口，覆盖生产资源与开发服务器加载、隔离桥接、DOM 播放器的 MP4 与 WebM 播放和 seek、关于页面及关闭退出。D0 产物验收覆盖 Range、媒体探测矩阵、音频提取、SQLite 关闭重开、工具取消、服务崩溃重连和退出清理；链接验收覆盖直链 Range 流式播放、重定向、取消续传、YouTube 与哔哩哔哩在线播放和 YouTube 独立下载，需要网络；安装包验收再执行静默安装、已安装应用检查和卸载。脚本生成的媒体、隔离用户数据、报告和截图分别写入已忽略的 `.fixtures/desktop/` 与 `.impeccable/review/`，不使用日常应用数据，也不涉及 ASR 或模型密钥。

所有自动媒体检查均静音启动；测试窗口的音频输出也被禁用，不修改系统音量或正常使用时的播放设置。布局回归覆盖 1120×720、960×640、640×480、浅深色主题、503 条字幕的搜索与独立滚动，以及导入/关于前后的媒体元素和暂停位置连续性。样本用于验证布局和播放路径，不替代真实长视频性能或听音验收。

只复验本机直链、下载与取消续传，可在 PowerShell 中执行：

```powershell
$env:CUEWEAVE_LINK_ONLY = 'local'
npm run test:desktop:links
Remove-Item Env:CUEWEAVE_LINK_ONLY
```

若当前 Windows 11 环境出现 D0 记录中的 GPU 沙箱启动故障，可仅为冒烟测试设置 `$env:CUEWEAVE_TEST_DISABLE_GPU_SANDBOX = '1'`。默认测试及正常应用不会使用此兼容开关；它不关闭 renderer sandbox 或 context isolation。
