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
  desktop-primary-fill: '#b6450f'
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
    backgroundColor: '{colors.desktop-primary-fill}'
    textColor: '{colors.on-accent}'
    rounded: '{rounded.control}'
    padding: '9px 16px'
  desktop-editor-input:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: '7px 8px'
  desktop-editor-save:
    backgroundColor: '{colors.desktop-primary-fill}'
    textColor: '{colors.on-accent}'
    rounded: '{rounded.control}'
    padding: '6px 12px'
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
- **布局**：原生窗口默认 1280×820，按主显示器可用区域收缩并记住正常窗口大小，最小 640×480；应用框架高 `100dvh`，三行为 52px 顶栏、弹性主区、30px 状态栏。媒体标题行最小 44px；底部控制区内播放行最小 50px、工具组最小 56px。右侧字幕面板宽 `clamp(280px, 29vw, 380px)`，收起后视频占满主区；900px 及以下面板以 `min(360px, 70%)` 覆盖视频区域右侧，不遮挡下方播放控制，并隐藏媒体元信息。680px 及以下横向留白收至 12px、视频内边距由 12px 收至 8px、隐藏品牌英文副标；导入预览改为纵排。字幕列表、来源设置、导入与关于内容各自滚动；根节点不滚动。
- **交互**：字幕来源设置可折叠；支持字幕搜索、当前句标记与点击定位。导入和关于使用原生对话框语义，Esc 返回并恢复入口焦点，不重建当前媒体元素。字幕搜索与表单输入不触发播放器快捷键。
- **D1 操作分区**：创建和打开项目归顶部；字幕轨选择、导入、撤销重做、文本与毫秒时间编辑以及导出归右侧字幕面板；保存与后台状态归底部。字段编辑在面板内使用表单，保存后写入项目，未保存草稿有关闭保护。导出折叠区提供内容与格式选择；D2 已加入翻译、译文校对与译文／双语导出，ASR 仍无未实现入口。
- **比较与删减**：A 同时支持观看与校对；B 的独立页面导航增加视频/字幕切换，C 的底部工作区压缩低高度窗口中的画面，暂不采用。删除宽松页面留白、固定宽高比撑高布局、播放器装饰投影和独立关于页面切换。

900px 及以下播放行与工具行分开，完整清晰度文本不设截断宽度；下拉保留原生选择交互并统一菜单外观，使用独立 Phosphor 箭头，右侧留白 12px。窗口内容高度不超过 650px 且进入编辑时，侧栏暂时隐藏导航、来源与导出控件，表单独立滚动，播放控制始终可见。

### Built component details

- **编辑与导出**：项目工具区最高占侧栏 40%；字幕编辑表单最高占 65%，仅字段正文独立滚动，标题、模式切换与保存按钮固定在表单内。进入编辑后隐藏项目工具与来源设置。时间字段以秒显示、步长 0.001，两个字段等宽并排；输入与文本域内边距 7px 8px，文本域最小高 64px，可纵向调整。保存按钮最小高 32px、内边距 6px 12px；保存中、内容无效或没有修改时禁用。导出内容与格式通过带可见标签的原生下拉选择，选项区允许换行；900px 及以下播放控制分成两行。高度不超过 650px 的编辑状态将整个可用侧栏交给表单，退出编辑后恢复列表与工具。
- **文字与轮廓**：桌面正文 0.875rem / 1.6，空态主标题 1.5rem，窄窗空态与导入对话框标题 1.25rem；标题字重 600、行高 1.45。媒体标题 0.875rem，字幕正文 0.8125rem / 1.75，时间与底部状态 0.6875rem。按钮与常规输入使用 8px 圆角，字幕来源下拉使用 5px，导入预览、下载状态与对话框使用 14px；不把扩展的胶囊开关样式引入桌面壳。
- **按钮与焦点**：主要和次要导入按钮最小高 42px、内边距 9px 16px；桌面主要按钮在两种主题下均使用白字，背景独立使用 `--primary-fill: #b6450f`（约 5.46:1 对比度）；深色文本强调继续使用明亮橙色 `--accent: #ff9859`，不用于白字实心按钮。轻量按钮悬停或按下时使用中性表面，按下时文字为橙色；播放器图标按钮为 32×32px。禁用控件保留原色并降至 0.6 不透明度。按钮焦点为 2px 橙色轮廓、4px 偏移；输入、下拉与来源摘要偏移 2px；字幕行焦点内缩 3px。
- **字幕来源按钮**：轻量操作最小高 32px、内边距 6px 10px；文字保持橙色，悬停表面在文字四周保留留白。
- **下拉菜单**：共享选择控件使用 `base-select` 与 `::picker(select)`，保留浏览器键盘导航和顶层定位。菜单使用主题表面、10px 圆角、4px 内边距及局部投影（浅色 `0 6px 20px rgb(56 45 30 / 0.18)`，深色 `0 6px 24px rgb(0 0 0 / 0.4)`）；最大高 `min(280px, calc(100dvh - 32px))`、最大宽 `calc(100vw - 24px)`。选项最小高 34px、内边距 7px 10px、6px 圆角；选中项兼有中性底、橙色半粗字和勾选标记。菜单打开时 Esc 优先关闭菜单，不触发页面返回或退出全屏。
- **滚动条**：桌面独立滚动区共用透明轨道，无箭头按钮；轨道宽 10px，滑块以 3px 透明边框形成 4px 可见宽度，圆角 999px、最小高 28px。浅色滑块为 `#918a81`，深色为 `#737373`，悬停使用次要文字色；强制颜色模式使用 `CanvasText`。
- **字幕列表**：来源设置使用 `details`，无字幕时展开、载入后折叠，最高占面板 50% 并独立滚动。搜索不区分大小写；“定位当前句”清除查询并居中当前行。每行内边距 14px 16px，时间使用等宽数字；当前行使用中性浅表面、橙色时间、“当前”文字、600 字重正文和 `aria-current`。长句保留换行并允许任意位置断行；列表使用稳定滚动条槽与 `content-visibility: auto`，不是固定行高虚拟列表。
- **视频与覆盖层例外**：视频画布固定为 `desktop-video-canvas`，通过 `object-fit: contain` 完整等比显示。桌面字幕为白色半粗字，基准字号 `clamp(1rem, 2.2vw, 1.5rem)` 乘用户缩放、行高 1.4，左右留 7%，距底部由显示偏好控制。原文／译文行纵向排列、间距 3px，每行内边距 2px 8px、4px 圆角；可选黑色底板的不透明度和两层黑色文字阴影强度由用户设置。双语原文字号以主字号的百分比计算。底板与阴影只用于视频可读性。宽窗侧栏没有投影；900px 及以下侧栏使用 `-12px 0 24px rgb(0 0 0 / 0.12)` 表明覆盖关系。模态背景为 `rgb(0 0 0 / 0.5)`；拖入提示背景为 `color-mix(in srgb, var(--paper) 92%, transparent)`。这些是局部视频与遮挡提示，不是通用卡片装饰。
- **导入与关于**：原生 HTML `dialog.showModal()` 保留背景媒体元素，宽 `min(720px, calc(100vw - 40px))`、最大高 `calc(100dvh - 40px)`；标题栏固定、正文独立滚动。Esc 或关闭返回，恢复仍存在的原焦点。关于标题接收初始焦点，版本与第三方许可保持真实内容，MiSans 署名留在此处。桌面仅加载旋转图标使用 0.8s 线性循环，减少动态效果时停止，不新增位移动画。

D1 沿用既有品牌、字体和图标，没有新增位图资产。此前的只读界面审阅不替代 D1 的编辑与恢复验收；当前功能范围见桌面 D1 实施文档。

### Desktop settings

外观、字幕显示与 AI 服务是既有桌面方向内的设置扩展，依据 [SettingsPage](apps/desktop/src/renderer/src/components/SettingsPage.tsx) 与桌面样式记录；页面策略见 [设置 brief](apps/desktop/.impeccable/surfaces/apps-desktop-src-renderer-src-components-settingspage-tsx.md)，配置、密钥与连接测试的产品边界见 [桌面设置说明](docs/DESKTOP_SETTINGS.md)。

- **页面结构**：从顶栏进入，设置非模态地替换主工作区；视频暂停，媒体元素和字幕编辑状态保持挂载。品牌顶栏与底部任务状态保留，工作台操作隐藏。页内返回按钮与标题位于滚动区上方；读取成功后的结果栏位于滚动区下方，最小高 44px、最大高 100px，长反馈可独立滚动。设置正文最大宽 960px，水平内边距 32px；外观、字幕显示和 AI 服务以细顶线分区，标签列 180px、列间距 32px，区块上下各留 20px。760px 及以下改为标签在上、表单在下，组内间距 16px、水平留白 24px；640×480 窗口通过正文独立滚动访问完整表单。
- **主题选择**：跟随系统、浅色、深色使用带 Phosphor 图标的三枚按钮，最小高 44px、8px 圆角、间距 8px。选中态以橙色边线、橙色文字、中性表面和 `aria-pressed` 共同表达；悬停只改变表面。主题保存后立即应用并在重启后保持，视觉沿用既有浅深色令牌。
- **表单与状态**：设置标题使用既有 1.5rem 标题，分区标题 1rem / 600，说明与密钥状态 0.75rem。可见字段标签为半粗，输入文字常规；输入和原生协议下拉高 40px、内边距 8px 12px、8px 圆角。模型与协议并排，间距 16px。保存沿用桌面白字暗橙主按钮，连接测试使用次要按钮；草稿未保存时测试禁用，测试中出现取消操作与既有旋转图标。底部结果使用文字区分未保存、保存、等待和错误，错误兼有陶红色与 `role="alert"`，其余更新通过礼貌播报区域传达。
- **返回与凭据**：进入时焦点落在设置标题，返回后恢复顶栏入口焦点。未保存 AI 或字幕样式草稿共同触发页内放弃确认，焦点转到「继续编辑」，使提示进入可见滚动区域；Esc 遵循同一返回路径。密钥输入为密码字段，已保存凭据仅显示状态，不回填；移除先形成可撤销草稿，保存后生效。设置打开时停用播放器快捷键与文件拖入。

本次扩展没有新增字体、图标库、位图或位移动画。设置验收截图位于忽略目录 `.impeccable/review/desktop-settings/`；测试服务地址、模型与认证值只用于验收，生产初始配置为空。独立界面终审发现的离开提示可见性问题已修复，复核将该项评为 resolved，处置为 ship；结论限于该项修复，不扩大桌面设置说明中的功能与安全验收范围。

### Desktop D2: subtitle appearance and translation

- **字幕显示表单**：外观之后、AI 服务之前提供原文／译文／双语、双语顺序、主字号、双语原文相对大小、距底部位置、底板开关与不透明度、阴影开关与强度。显示内容与顺序并排，控件组间距 16px；滑块保留可见百分比与等宽数字。非双语时禁用顺序与原文大小，关闭底板或阴影时禁用相应强度。预览高 180px，与播放器共用 SubtitleOverlay；预览基准字号为 1.125rem，样式示例不作为项目字幕。调整实时更新预览，保存后应用播放器；恢复默认先形成可保存草稿，字幕样式和 AI 草稿分别保留。无译文时回退原文，观看样式不写入导出文件。
- **翻译参数与持续反馈**：侧栏的「翻译字幕」折叠区显示已保存服务主机、模型与目标语言，开始后折叠参数。任务状态、目标语言、已完成／总条数和 5px 原生进度条留在折叠区之外；文字与橙色进度共同表达状态。运行时提供取消，未完成时提供继续剩余字幕与定位未完成字幕，错误就地使用 alert。侧栏原文下保留译文，人工修改有「已校对」文字；搜索同时匹配两种文本。持久化与恢复边界见 [D2 说明](docs/DESKTOP_D2.md)。
- **校对与导出**：编辑器通过带 aria-pressed 的「原文与时间」／「译文」按钮选择内容，未保存修改时禁止切换。译文模式显示最高 80px、可独立滚动的原文参考。字段正文滚动，保存和取消保持可见；高度不超过 650px 时隐藏参考原文、搜索、列表和页脚，表单接管剩余侧栏空间，播放控制仍固定。译文撤销／重做与原文分开；导出提供译文、双语以及明确选择的部分导出，数据规则由 D2 文档维护。

D2 保留既有 Warm Paper、MiSans 与 Phosphor，没有新增通用颜色令牌或位图资产。独立通用代理完成视觉／代码终审，12 张当前截图全部审阅，处置为 SHIP，无实质发现；截图位于忽略目录 `.impeccable/review/desktop-translation/`。展开的翻译入口与导出控件通过代码及 D2 文档核对，不属于截图覆盖。模拟 API 的功能验收单独记录在 D2 文档，不证明真实模型质量；该结论也不替代安装器验收。

### Desktop online: watch-time translation

本次精修依据 [OnlineTranslationTools](apps/desktop/src/renderer/src/components/OnlineTranslationTools.tsx)、[在线翻译状态](apps/desktop/src/renderer/src/use-online-translation.ts)、App 与桌面样式，沿用已确认 A 方案、Warm Paper、MiSans 和 Phosphor，不新增视觉方向、通用令牌或位图资产。

- **原文来源**：打开在线媒体后自动读取选定的原文字幕，优先英语自动字幕；来源区只呈现一条原文来源摘要，不展示平台翻译语言列表。载入失败时可重新读取，也保留加载本地字幕文件的入口。
- **边看边译**：侧栏依次呈现标题与开启／暂停／继续操作、目标语言、当前位置翻译状态与已完成／总条数、缓存说明和 AI 设置入口。连接或运行时禁用目标语言修改；载入原文、无可用字幕和连接期间禁用翻译操作。状态使用 `role="status"`，失败信息就地使用 `role="alert"`。首次开启前说明字幕发送到已配置 AI 服务及可能产生 API 费用；有会话后说明回看复用缓存，暂停时已有译文仍可观看。进入 AI 设置暂停媒体。
- **尺寸与低高度适配**：在线工具区内边距 12px 16px，以既有边线分区；标题 13px / 600，语言标签、状态、帮助与错误 12px，状态和帮助行高 1.6。窗口内容高度不超过 650px 时，在线侧栏整体纵向滚动、直接子项不收缩；标题与关闭按钮以 `position: sticky; top: 0; z-index: 2` 保持可见，背景为既有 `--surface`。内层字幕列表高 240px，保留自身滚动；播放控制仍在侧栏之外固定可见。
- **双语阅读**：在线译文呈现在对应原文下，播放器继续共用 `SubtitleOverlay` 与已保存显示偏好；没有当前译文时保留原文回退，不另建一套在线字幕样式。

独立代理对本次在线界面完成视觉／代码终审，处置为 SHIP，无实质发现。截图范围限于 `.impeccable/review/desktop-online/` 下的 `online-light`、`online-dark`、`online-narrow-light`、`online-narrow-dark`、`online-narrow-list-light`、`online-narrow-list-dark`、`online-error-light` 七张 PNG；该结论不扩大到真实模型质量、后台调度或安装器验收。

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

### 扩展翻译偏好（2026-09-05）

设置页在字幕显示分区增加“翻译偏好”原生下拉，使用既有字段行、MiSans、Phosphor Regular 图标和 Warm Paper 颜色。速度优先、均衡（默认）、质量优先各有一行等待与复核说明；保存后应用到打开的页面。宽屏与其他输入对齐，窄屏沿用标签在上、控件在下的布局。策略、预算与缓存实现记录在 docs/TRANSLATION-STRATEGY.md，不作为界面说明。
