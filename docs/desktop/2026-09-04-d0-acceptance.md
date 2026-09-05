# D0 验收记录 · 2026-09-04

本记录对应 Windows x64 桌面宿主 D0 的本机验收。实现边界与复验命令见 [D0 实施与验收](../DESKTOP_D0.md) 和[桌面工作区 README](../../apps/desktop/README.md)。

## 构建与环境

- 源码基线：`e628c17941bf3bb5f408c3f8619ddc2c0bd41ec4` 加工作区未提交改动。
- 系统：Windows NT 10.0.26200.0，x64。
- 目录产物：`CueWeave.exe`，245,289,472 字节，SHA-256 `94bd38bc7ae6e5647209f773cb5fac639cf4eeb56c2f4a0b330497cf95b95493`。
- 安装包：`CueWeave-0.1.0-x64.exe`，220,159,590 字节，SHA-256 `504354716312a6c16fa9e4a1dbbb05e54baf07fdbe83ad201bd88cd4d784fe60`。
- 媒体与下载工具：FFmpeg SHA-256 `04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00`；ffprobe SHA-256 `3a7e2dc003dc2cd1472827e4c7c4f056ae1ae0ae7c5bbc580c99b49827351ba4`；yt-dlp 2026.08.19 SHA-256 `66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a`；Deno 2.9.6 SHA-256 `2ff9493dfa356be2975f477025ea770088e9e9cb2c83d983236d13561b96b7a6`。版本、来源与许可证由[工具清单](../../apps/desktop/resources/tools/manifest.json)维护。
- 签名状态：`NotSigned`。当前安装包只用于开发验收；公开分发前需要发行证书签名并重新验证哈希和安装流程。

目录产物和已安装应用均使用隔离用户数据目录，工作目录位于临时目录，`PATH` 缩减为 `C:\Windows\System32;C:\Windows`。这证明运行时不依赖仓库、Node、Python或全局 FFmpeg；它不是独立机器证明。提交后的 `desktop-windows` CI 会在新的 Windows runner 中重复构建、目录验收、安装和卸载。

## 结果

| 范围          | 输入或动作                                     | 结果                                                                         |
| ------------- | ---------------------------------------------- | ---------------------------------------------------------------------------- |
| Renderer 安全 | 生产资源与开发服务器                           | sandbox 和 context isolation 开启；Node integration 关闭；外部导航被拒绝     |
| 登录窗口      | 哔哩哔哩官方登录页                             | 独立持久会话；sandbox 与 context isolation 开启；Node、preload、webview 关闭 |
| 统一播放器    | 中文路径 H.264/AAC MP4                         | DOM 视频加载成功，画面正常，seek 到 1 秒成功                                 |
| 统一播放器    | 中文路径 VP9/Opus WebM                         | DOM 视频加载成功，画面正常，seek 到 1 秒成功                                 |
| Range         | 完整、固定、开放尾部、后缀、越界、多范围、HEAD | `200`、`206`、`416` 与长度均符合策略；HEAD 无响应体                          |
| 媒体登记      | 未登记 ID、登记后文件变化                      | 拒绝读取                                                                     |
| 探测          | H.264/AAC MP4、VP9/Opus WebM                   | 容器、编码、轨道、时长和采样信息正确                                         |
| 探测          | HEVC 与双音轨 MKV                              | 识别一条 HEVC 视频轨和两条 AAC 音轨；未据此宣称可直接播放                    |
| 探测          | 变帧率 MP4、非零起点 MKV                       | 变帧率平均帧率被保留；非零起点为 1.979 秒                                    |
| 错误输入      | 损坏 MP4                                       | ffprobe 明确失败，未返回伪造媒体信息                                         |
| 音频提取      | H.264/AAC MP4 到 16 kHz 单声道 PCM WAV         | 生成 96,334 字节文件并清理实验输出                                           |
| SQLite        | 事务写入、关闭、只读重开                       | 写入 token 可回读                                                            |
| 服务恢复      | 强制 utility process 退出                      | 从执行代次 1 恢复到执行代次 2                                                |
| 取消与清理    | 运行中 FFmpeg 取消、关闭应用                   | FFmpeg 被终止；应用退出后旧、新服务 PID 均不存在                             |
| 安装          | NSIS 静默安装、已安装应用复验、卸载            | 全部通过；卸载后测试安装目录被移除                                           |
| HTTP(S) 直链  | 本地受控服务、一次重定向、MP4                  | 元信息、Range 流式播放、独立下载、探测和本地播放通过                         |
| 取消与续传    | 限速直链下载中取消后重试                       | 保留 `.part`；重试使用 Range 完成并清理临时文件                              |
| YouTube       | 公开短视频 `jNQXAC9IVRw`                       | 读取 240p、144p 清晰度与英德字幕；人工英文字幕加载、显示与双流播放通过       |
| YouTube 4K    | 公开 4K60 视频 `LXb3EKWsInQ`                   | 列出 1440p（2K）和 2160p（4K）；3840×2160 VP9 流在 DOM 播放器解码通过        |
| YouTube       | 公开 19 秒单视频 `jNQXAC9IVRw`                 | 标题、时长、下载、H.264/AAC 合并、探测和播放通过                             |
| 哔哩哔哩      | 用户提供的公开单视频 `BV1qNtd6sEai`            | 未登录读取 1080p 至 360p；1080p 到 720p 切换后画面、音频同步与进度连续性通过 |
| 播放控制      | 本地视频、YouTube、哔哩哔哩                    | 共用播放暂停、进度、音量、静音、倍速、全屏、本地/在线字幕和字幕延迟控制      |
| 链接边界      | 内网地址、播放列表策略、工具配置               | 产品模式拒绝内网；不展开播放列表；默认不读取 Cookie、用户配置或插件          |
| 登录状态      | 不使用登录、使用句织登录                       | 隔离会话持久保存；自动验证状态读取、清除和 renderer 隔离                     |

原始机器可读结果由 `npm run test:desktop:d0`、`npm run test:desktop:links` 和 `npm run test:desktop:installer` 写入已忽略的 `.impeccable/review/desktop-d0/` 与 `.impeccable/review/desktop-links/`。生成样本位于已忽略的 `.fixtures/desktop/`，脚本每次重新生成并记录内容哈希。

## 限制

- HEVC、多音轨、变帧率和非零起点样本本轮只验证受控探测；播放器兼容性仍以具体 Windows 解码环境中的实际加载结果为准。
- 未执行一小时级媒体的长期内存与磁盘压力测试；该项留在首版整链性能验收。
- ASR 路线未选定，本轮没有下载 ASR 引擎或模型，也没有上传音频或调用识别服务。
- YouTube 和哔哩哔哩支持依赖站点当前行为，需要在 yt-dlp、Deno 或站点发生变化后重新验收；软件内登录状态只读取账号已有权限，不处理付费授权、DRM、直播或播放列表。
- 哔哩哔哩未登录样本 `BV1qNtd6sEai` 返回至普通 1080P；4K 与 1080P 高码率由平台提示需要大会员。自动验收不使用真实账号，会员清晰度需要用户登录后验证。
- 普通清晰度选择上限为标准 SDR 2160p；8K、HDR10 和杜比视界需要另做硬件解码、色彩管理与性能验收。
- 在线字幕与外挂字幕都只把字幕名称和文本交给 renderer；字幕样式与站点专有元数据当前不会保留。
- 本机 Windows 11 25H2 build 26200 存在 [Electron 已跟踪的 GPU 子进程沙箱启动问题](https://github.com/electron/electron/issues/52098)；隐藏的 D0 自动验收使用 `--disable-gpu-sandbox`，正常应用与 renderer 安全设置没有因此放宽。
