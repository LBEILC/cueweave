---
name: CueWeave Warm Paper
description: 字幕工作台、Popup、设置页、播放器字幕与桌面壳的暖纸、活力橙与中性深色界面规范
colors:
  accent: '#b6450f'
  accent-hover: '#a73c09'
  accent-wash: '#eeeae4'
  on-accent: '#ffffff'
  paper: '#f8f4ed'
  surface: '#fffdf9'
  surface-muted: '#eeeae4'
  ink: '#383838'
  ink-secondary: '#69645e'
  line: '#dedbd5'
  line-strong: '#8e8982'
  success: '#496750'
  success-wash: '#eaf0e9'
  warning: '#7b6037'
  warning-wash: '#f2eadb'
  danger: '#925448'
  danger-wash: '#f4e9e5'
  focus: '#b6450f'
  dark-accent: '#ff9859'
  dark-accent-hover: '#ffb184'
  dark-accent-wash: '#303030'
  dark-on-accent: '#202020'
  dark-paper: '#1a1a1a'
  dark-surface: '#242424'
  dark-surface-muted: '#303030'
  dark-ink: '#eeeeee'
  dark-ink-secondary: '#b9b9b9'
  dark-line: '#414141'
  dark-line-strong: '#898989'
  dark-success: '#b9c8bb'
  dark-success-wash: '#2d322e'
  dark-warning: '#dbc59e'
  dark-warning-wash: '#34312b'
  dark-danger: '#deb4ad'
  dark-danger-wash: '#382d2b'
  dark-focus: '#ff9859'
  player-secondary: '#d5d5d5'
  desktop-video-canvas: '#0b0b0b'
typography:
  headline:
    fontFamily: 'MiSans, "Mi Sans", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: '1.5rem'
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: '-0.02em'
  section:
    fontFamily: 'MiSans, "Mi Sans", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: '1.25rem'
    fontWeight: 600
    lineHeight: 1.45
  title:
    fontFamily: 'MiSans, "Mi Sans", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: '1rem'
    fontWeight: 600
    lineHeight: 1.6
  body:
    fontFamily: 'MiSans, "Mi Sans", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: 1.6
  compact:
    fontFamily: 'MiSans, "Mi Sans", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: '0.8125rem'
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: 'MiSans, "Mi Sans", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: '0.75rem'
    fontWeight: 400
  caption:
    fontFamily: 'MiSans, "Mi Sans", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: '0.6875rem'
    fontWeight: 400
rounded:
  small: '5px'
  control: '8px'
  panel: '14px'
  switch: '20px'
spacing:
  compact: '8px'
  related: '12px'
  group: '16px'
  panel: '24px'
components:
  button-primary:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.on-accent}'
    rounded: '{rounded.control}'
    padding: '9px 15px'
  button-primary-hover:
    backgroundColor: '{colors.accent-hover}'
  button-secondary:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: '9px 15px'
  button-disabled:
    backgroundColor: '{colors.surface-muted}'
    textColor: '{colors.ink-secondary}'
  input:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: '9px 12px'
  panel:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.panel}'
  status-success:
    backgroundColor: '{colors.success-wash}'
    textColor: '{colors.success}'
    rounded: '{rounded.small}'
    padding: '4px 8px'
  status-warning:
    backgroundColor: '{colors.warning-wash}'
    textColor: '{colors.warning}'
    rounded: '{rounded.small}'
    padding: '4px 8px'
  filter-selected:
    backgroundColor: '{colors.accent-wash}'
    textColor: '{colors.accent}'
    padding: '6px 11px'
  player-caption:
    backgroundColor: 'rgb(26 26 26 / var(--cueweave-caption-background-opacity, 0.8))'
    textColor: '{colors.dark-ink}'
    rounded: '{rounded.control}'
    padding: '0.4em 0.7em 0.45em'
  player-action:
    backgroundColor: '{colors.dark-accent}'
    textColor: '{colors.dark-on-accent}'
    rounded: '{rounded.control}'
    padding: '6px 12px'
  player-action-hover:
    backgroundColor: '{colors.dark-accent-hover}'
  player-action-disabled:
    backgroundColor: '{colors.dark-surface-muted}'
    textColor: '{colors.player-secondary}'
  desktop-button-primary:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.on-accent}'
    rounded: '{rounded.control}'
    padding: '9px 16px'
  desktop-subtitle-row:
    textColor: '{colors.ink}'
    padding: '14px 16px'
  desktop-subtitle-current:
    backgroundColor: '{colors.surface-muted}'
    textColor: '{colors.ink}'
    padding: '14px 16px'
  desktop-dialog:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.panel}'
    width: 'min(720px, calc(100vw - 40px))'
---

# Design System: CueWeave Warm Paper

## Overview

**Creative North Star: "Warm Paper · 字幕编辑书桌"**

温润的纸色承托字幕内容，活力橙指向操作，细边框整理相邻信息。深色界面使用纯中性的石墨灰底和面板，让橙色集中在操作与选中状态。沿用用户指定的 OpenHanako Warm Paper 气质，以「引语」标志表达语言与字幕，保留句织的名称和中文阅读习惯。界面紧凑、平静，让修正内容与状态先被看见。

本规范覆盖字幕工作台、Popup、设置页与播放器字幕，依据 [共享主题](apps/extension/src/ui/theme.css)、[工作台样式](apps/extension/entrypoints/review/style.css)、[Popup 样式](apps/extension/entrypoints/popup/style.css)、[设置页样式](apps/extension/entrypoints/options/style.css)、[品牌组件](apps/extension/src/ui/Brand.tsx) 和 [播放器字幕组件](apps/extension/src/ui/player-overlay.ts) 提取。页面任务与布局方向分别由 [工作台与 Popup brief](.impeccable/surfaces/entrypoints-review-app-tsx.md)、[设置页 brief](.impeccable/surfaces/entrypoints-options-app-tsx.md) 和 [播放器 brief](.impeccable/surfaces/entrypoints-youtube-content-index-ts.md) 维护，产品约束见 [PRODUCT.md](PRODUCT.md)。播放器开发预览的运行方式与示例边界由 [开发指南](docs/DEVELOPMENT.md) 维护；预览场景与测试控件不构成产品视觉令牌。

桌面壳沿用同一视觉系统，样式以 [桌面样式](apps/desktop/src/renderer/src/style.css) 为依据，页面任务与布局方向由 [桌面 brief](apps/desktop/.impeccable/surfaces/apps-desktop-src-renderer-src-app-tsx.md) 维护。

**Key Characteristics:**

- 浅色使用暖纸与近白面板；深色使用中性石墨灰与细线分区。
- MiSans 常规与半粗字重组成清晰层级。
- 活力橙操作、绿色已应用、赭色仅记录，状态同时保留文字。
- 工作台保留对照阅读，Popup 使用紧凑控件，设置页按分区组织表单。
- 播放器保持中性深色字幕底，译文与原文通过字重和字号建立层级，橙色标明就地操作。

## Colors

浅色以暖纸承托活力橙，深色以中性石墨灰承托亮橙；大面积表面保持克制，强调色集中在操作、进度和选中状态。前置令牌是规范值，以下说明其用途。

### Primary

- **活力橙**（`accent`）：主要按钮、当前筛选、进度与功能图标；`accent-hover` 表示可操作反馈，`accent-wash` 以中性浅表面承托低强度选中态，`on-accent` 用于实色按钮内的文字。
- **焦点橙**（`focus`）：键盘操作的可见轮廓，不代替选中态。

### Neutral

- **暖纸**（`paper`）：整页与 Popup 的底色。
- **近白纸面**（`surface`）：面板、输入框和次要按钮。
- **浅暖灰**（`surface-muted`）：分段控件底、未激活区域和禁用操作。
- **深墨与次级墨色**（`ink`、`ink-secondary`）：正文和辅助说明。
- **暖细线与控件边线**（`line`、`line-strong`）：分别划分内容层次与输入边界。
- **字幕次级墨色**（`player-secondary`）：播放器双语原文、禁用操作与设置页双语原文样例使用的中性浅灰；单独显示原文时保留主字幕的墨色和字重。

### Semantic States

- **草绿**（`success`、`success-wash`）：已应用修正和就绪状态。
- **赭色**（`warning`、`warning-wash`）：仅记录的建议、待处理状态与可恢复的问题。
- **陶红**（`danger`、`danger-wash`）：删除术语、清除缓存等破坏性操作，以及表单失败反馈。

深色主题使用同一套语义关系，画布、面板、边线和正文均采用纯中性灰，橙色操作与语义状态色单独提供色彩。面板相对画布略微提亮；选中背景保持中性，橙色文字标明当前状态。`dark-` 前缀表示共享主题在 `prefers-color-scheme: dark` 中对同名变量的覆盖；它不是第二套组件 API。

播放器字幕在两种浏览器主题下都使用深色中性底和浅色文字，橙色仅用于操作与焦点。背板的不透明度、文字阴影开关和强度由字幕偏好控制；关闭背板时保留黑色字边。强制颜色模式的系统色映射由 `createSubtitleOverlay` 的样式维护。

**The Semantic Pair Rule.** 状态文字与对应底色成对使用；颜色必须与状态名称共同出现。对照区的“仅记录”保持警示色与普通字重，不能呈现为已经应用。

## Typography

**Display Font:** MiSans；不另设展示字体。
**Body Font:** MiSans，回退顺序见前置字体令牌。

**Character:** 中文界面使用同一家族，让字号、字重和间距承担层级。正文采用常规字重，标题、主操作与已确认内容使用半粗字重；数字读数使用等宽数字特性。

### Hierarchy

- **Headline**：工作台视频标题。窄窗口按工作台样式收小，并允许长标题换行。
- **Section**：设置页各任务分区的标题。
- **Title**：面板标题和品牌名称。
- **Body**：工作台与设置页的操作、表单和输入内容。
- **Compact**：Popup 正文、术语列表和分段选择。
- **Label**：辅助说明、输入标签、状态与筛选。
- **Caption**：原始／建议写法的说明及低优先级读数标签。

对照正文比辅助说明更突出，原文保持常规字重；已应用的修正以半粗绿色区分。不要从最小的页脚文字推导新正文规格。

播放器的主字幕使用半粗字重，双语原文使用常规字重；字号随播放器宽度和用户比例变化，独立原文继承主字幕层级。行高与缩放公式由 [播放器组件](apps/extension/src/ui/player-overlay.ts) 的 `createSubtitleOverlay` 维护。该组件通过 `loadFont` 和 FontFace API 注册 MiSans 常规与半粗字体，资源地址由 [内容脚本](apps/extension/entrypoints/youtube.content/index.ts) 的 `ensureOverlay` 提供。

**The Reading Weight Rule.** 使用已随软件分发的 Regular 与 Semibold 字体，不合成其他字重；字体来源、版权与许可由 [第三方声明](THIRD_PARTY_NOTICES.md#misans) 和随附许可文件维护，日常任务界面不显示字体署名，版权与许可信息放在关于或第三方声明中。

## Layout

间距以紧密关联、控件组合、内容组、面板留白四级组织，重复使用前置间距令牌。面板内部借助细线与留白分组；避免把每条信息都包成独立卡片。

工作台容器居中，最大宽度（1320px）；桌面主区由弹性对照列、术语列（324px）和面板间距组成。在（1050px）以下缩小水平留白和术语列；在（800px）以下转为单列，导航换行，术语表单先并排；在（480px）以下表单纵排，导出控件换行。具体响应规则由工作台样式中的三个媒体查询维护。

Popup 是固定宽度（360px）的扩展面板，内容内边距（20px）。状态、字幕开关、语言选择和快捷操作沿单列排列。它复用色彩、字体与控件规则，不照搬桌面工作台的双列构图。

设置页以侧边分区导航与表单内容组成双列。在（960px）以下先把字段控件移到标签下方；在（760px）以下导航横排、内容单列。各组表单保持独立标题、操作和结果反馈，详细页面策略见设置页 brief。

桌面壳保留原生窗口边框，工作区固定在窗口可用高度内；视频、字幕和播放控制的分区规则见 [Desktop workspace](#desktop-workspace)。关于与导入通过独立覆盖层打开，内容只在层内滚动，播放器持续挂载。

播放器字幕贴合文字宽度，在播放器底部居中，以宽度上限和换行约束长句；字幕位置与整体大小遵循保存的偏好，播放器控制条显示时保留操作空间。小播放器遇到超高长句时，`createSubtitleOverlay` 内的 `fit` 临时同比缩小两种语言，保留原文比例，重新测量时恢复以用户字号为起点；适配不改写已保存设置。设置映射由 `applyOverlayPreferences` 维护。

## Elevation & Depth

工作台、Popup 与设置页面板没有投影。深度来自纸底与面板的色差、细边框和内容间距；悬停通过表面和文字颜色反馈，不抬升卡片。共享键盘焦点使用明确的外轮廓（2px）及外偏移（4px）。

播放器背板同样没有容器投影或装饰边框。字幕的黑色描边与可调文字阴影仅用于视频字幕。设置页预览与播放器共享 `apps/extension/src/ui/subtitle-style.ts` 的 `subtitleTextShadow` 规则；sidecar 展示默认阴影样式。就地操作不继承文字阴影或描边，其焦点外偏移由播放器组件维护。

**The Paper Layer Rule.** 用表面色和边线建立层次，保持静止界面的平面感。

颜色与背景反馈采用共享短时长；开关滑块使用共享缓出曲线。加载图标可连续旋转。开启减少动态效果时，停止动画、过渡与平滑滚动；完整动态令牌见配套 sidecar。

## Shapes

面板使用较舒展的圆角，按钮与输入框使用统一控件圆角，状态标签和紧凑选项使用小圆角。开关保留胶囊轨道与圆形滑块；圆形与胶囊形不是普遍禁用的装饰形式。

品牌使用 [「引语」标志](apps/extension/public/cueweave-mark-paper.svg)：双引号的实心轮廓位于橙色圆角底上，浅色模式使用白色图形，深色模式使用深灰图形。工作台、Popup 与设置页通过共享 Brand 组件使用此资源。界面图标来自 Phosphor，常规线条配合邻近文字，纯图标操作保留可访问名称。品牌图形不扩展为背景条纹或分区装饰。

## Components

### Buttons

清楚而轻巧。主要按钮使用橙色底与反色文字，次要按钮使用纸面底与细边线；两者共享控件圆角、图标间距和半粗字重。最低高度（40px），悬停变色，焦点使用统一轮廓。禁用态改用浅表面、辅助文字与边线。破坏性次要操作使用陶红文字，悬停时同步改变边线与底色。

### Chips

状态标签紧凑地组合文字与功能图标。已应用与仅记录分别采用成功色和警示色；中性与进行中状态使用对应的中性色和操作色。状态标签本身不表现为可点击按钮。

### Cards / Containers

工作台与设置页面板使用同一纸面、边线和面板圆角，内部标题、内容与反馈按任务分区。对照记录直接以分隔线连接，不添加逐条卡片阴影。

### Inputs / Fields

术语输入框与设置页的文本输入、下拉选择使用纸面底、较强边线和控件圆角，最低高度（42px）。术语标签位于输入框上方；设置字段标签在宽屏位于控件左侧，窄屏移到上方。可见标签持续保留，占位示例只是补充。焦点沿用共享轮廓，成功或失败反馈位于对应表单附近。

### Navigation

工作台导航使用文字链接与轻量悬停底色，在窄窗口换到独立一行。Popup 的工作台入口以中性浅表面承托标题和说明，悬停转为实色；设置入口采用有名称的图标按钮。设置页分区导航使用图标与文字，当前分区以橙色文字、中性选中表面和半粗字重标识，并通过 `aria-current` 表达位置；窄屏保持同一顺序横排。

桌面壳的关于入口以中性表面和橙色文字表示选中，并使用 `aria-pressed` 表达状态。进入关于页时焦点移到标题，返回工作台时恢复到入口按钮。

### Applied / Recorded Filter

“全部／已应用／仅记录”筛选与数量就地控制对照列表。选中项以中性浅表面、橙色操作文字和半粗字重突出，并使用 `aria-pressed` 表示状态。记录同时展示原始转录、修正或建议写法和应用状态；空结果在原位置说明如何切换筛选。

### Segmented Controls & Switch

导出与设置分段控件以浅表面承托选项，选中项使用纸面、橙色文字和 `aria-pressed`；不可用选项保留禁用状态。Popup 与设置页开关共享胶囊圆角，通过轨道变色与滑块位移共同表示状态，并提供 `aria-checked`。外观表达业务层给出的状态与可用性。设置页的字幕样例展示偏好变化，其局部字幕样式不扩展为通用控件规则。

### Player Captions & Inline Action

紧凑的圆角中性背板承托字幕。译文默认在前，原文顺序与大小遵循双语偏好；设置页样例也把两种语言放在同一背板内，只在双语时降低原文的文字层级。播放器的空白与禁用状态隐藏阅读层，原文回退、译文及操作的显示条件由 [内容脚本](apps/extension/entrypoints/youtube.content/index.ts) 的 `renderLoop` 维护。

重试与配置操作使用独立字号、橙色实底、明确焦点和最小点击高度（32px），不随字幕适配缩小。操作本身接收指针和键盘输入，其余覆盖区域让输入通过；字幕内容更新不强制触发逐句朗读。状态处理与真实操作连接由内容脚本维护，视觉与输入隔离由 `createSubtitleOverlay` 维护。

## Desktop workspace

2026-09-05：用户确认 A 方案（视频 + 可收起字幕侧栏）。先由 `design-from-constraints` 完成约束与低成本布局比较；用户随后批准由 `impeccable` 接手实施、精修和验证。以下记录该方向的已实现界面，以 [App](apps/desktop/src/renderer/src/App.tsx)、[桌面样式](apps/desktop/src/renderer/src/style.css) 与其导入、字幕、关于和对话框组件为依据；产品范围仍由 [桌面规格](docs/DESKTOP.md) 定义。

- **确定要求**：保留原生窗口操作、现有媒体来源与播放能力。播放器适应剩余窗口空间，整窗不出现纵向或横向滚动；播放控制固定可见。保留 Warm Paper、官方 MiSans Regular / Semibold、Phosphor 图标、暖纸浅色和中性石墨深色。
- **信息顺序**：应用操作 → 当前媒体 → 视频与字幕 → 播放控制 → 任务状态。文件名截断并保留完整名称提示；视频始终完整等比显示，长字幕在自己的列表区域换行。
- **布局**：原生窗口最小 640×480；应用框架高 `100dvh`，三行为 52px 顶栏、弹性主区、30px 状态栏。媒体标题行最小 44px；底部控制区内播放行最小 50px、工具组最小 56px。右侧字幕面板宽 `clamp(280px, 29vw, 380px)`，收起后视频占满主区；900px 及以下面板以 `min(360px, 70%)` 覆盖视频区域右侧，不遮挡下方播放控制，并隐藏媒体元信息。680px 及以下横向留白收至 12px、视频内边距由 12px 收至 8px、隐藏品牌英文副标；导入预览改为纵排。字幕列表、来源设置、导入与关于内容各自滚动；根节点不滚动。
- **交互**：字幕来源设置可折叠；支持字幕搜索、当前句标记与点击定位。导入和关于使用原生对话框语义，Esc 返回并恢复入口焦点，不重建当前媒体元素。字幕搜索与表单输入不触发播放器快捷键。
- **暂定边界**：本轮字幕列表为只读，编辑与持久化随 D1 接入。未来项目操作归顶部、字幕编辑和翻译归侧栏、后台任务归底部、导出归项目操作；功能未完成前不展示无效入口。
- **比较与删减**：A 同时支持观看与校对；B 的独立页面导航增加视频/字幕切换，C 的底部工作区压缩低高度窗口中的画面，暂不采用。删除宽松页面留白、固定宽高比撑高布局、播放器装饰投影和独立关于页面切换。

### Built component details

- **文字与轮廓**：桌面正文 0.875rem / 1.6，空态主标题 1.5rem，窄窗空态与导入对话框标题 1.25rem；标题字重 600、行高 1.45。媒体标题 0.875rem，字幕正文 0.8125rem / 1.75，时间与底部状态 0.6875rem。按钮与常规输入使用 8px 圆角，字幕来源下拉使用 5px，导入预览、下载状态与对话框使用 14px；不把扩展的胶囊开关样式引入桌面壳。
- **按钮与焦点**：主要和次要导入按钮最小高 42px、内边距 9px 16px；桌面主要按钮在两种主题下均使用白字，不继承扩展的深色按钮文字覆盖。轻量按钮悬停或按下时使用中性表面，按下时文字为橙色；播放器图标按钮为 32×32px。禁用控件保留原色并降至 0.6 不透明度。按钮焦点为 2px 橙色轮廓、4px 偏移；输入、下拉与来源摘要偏移 2px；字幕行焦点内缩 3px。
- **字幕列表**：来源设置使用 `details`，无字幕时展开、载入后折叠，最高占面板 50% 并独立滚动。搜索不区分大小写；“定位当前句”清除查询并居中当前行。每行内边距 14px 16px，时间使用等宽数字；当前行使用中性浅表面、橙色时间、“当前”文字、600 字重正文和 `aria-current`。长句保留换行并允许任意位置断行；列表使用稳定滚动条槽与 `content-visibility: auto`，不是固定行高虚拟列表。
- **视频与覆盖层例外**：视频画布固定为 `desktop-video-canvas`，通过 `object-fit: contain` 完整等比显示。桌面字幕为白色半粗字，字号 `clamp(1rem, 2.2vw, 1.5rem)`、行高 1.4，左右及底部各留 7%；没有扩展播放器的字幕背板或双语样式。其黑色文字阴影仅用于视频可读性：`0 2px 5px #000, 0 0 2px #000`。宽窗侧栏没有投影；900px 及以下侧栏使用 `-12px 0 24px rgb(0 0 0 / 0.12)` 表明覆盖关系。模态背景为 `rgb(0 0 0 / 0.5)`；拖入提示背景为 `color-mix(in srgb, var(--paper) 92%, transparent)`。这些是局部视频与遮挡提示，不是通用卡片装饰。
- **导入与关于**：原生 HTML `dialog.showModal()` 保留背景媒体元素，宽 `min(720px, calc(100vw - 40px))`、最大高 `calc(100dvh - 40px)`；标题栏固定、正文独立滚动。Esc 或关闭返回，恢复仍存在的原焦点。关于标题接收初始焦点，版本与第三方许可保持真实内容，MiSans 署名留在此处。桌面仅加载旋转图标使用 0.8s 线性循环，减少动态效果时停止，不新增位移动画。

独立 finish review 对既有生产截图与代码的限定审阅结论为 `ship`，未提出实质修复项；这不替代桌面规格中的后续功能验收。本轮复用现有品牌与字体，没有新增位图资产。

结构原型与本机截图留在被忽略的 `.impeccable/review/desktop-redesign/` 和 `.impeccable/review/desktop-smoke/`；测试视频与长字幕均为确定性生成样本，不作为产品默认内容。运行验证见桌面工作区 README。

## Do's and Don'ts

### Do:

- **Do** 在工作台、Popup 与设置页复用共享语义颜色、MiSans 字体和控件轮廓。
- **Do** 用文字、字重与颜色共同区分已应用修正和仅记录建议。
- **Do** 让标题、转录内容和术语允许换行，保持窄窗口的阅读顺序。
- **Do** 为键盘焦点和减少动态效果偏好保留明确反馈。
- **Do** 保持「引语」标志的实心轮廓和 Phosphor 功能图标的一致线条。
- **Do** 让播放器字幕保留中性深色、用户的语言层级偏好与独立可读的操作。

### Don't:

- **Don't** 用背景条纹、编号眉题或装饰性投影争夺内容的注意力。
- **Don't** 把成功色应用到未应用建议，或只靠颜色传达状态。
- **Don't** 把字幕黑色字边与文字阴影扩展为通用卡片投影，或把开发预览场景当成产品视觉规范。
- **Don't** 从页脚和孤立装饰尺寸推导通用正文、间距或控件规范。
