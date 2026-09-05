# CueWeave / 句织

<!-- impeccable:product-schema 1 -->

本文维护浏览器扩展界面的产品上下文；整个项目由扩展、桌面和共享核心组成，职责与接入边界见[共享翻译核心](docs/TRANSLATION-CORE.md)。

## Platform

web

## Users

观看带字幕的 YouTube 访谈、讲座和长视频，希望读到完整、自然双语字幕的用户。多数时间用于观看；需要核对修正、确认术语或下载字幕时进入工作台。

## Product Purpose

在保留原始转录和时间事实的前提下，把碎片字幕整理成完整语义。产品范围、数据规则和验收标准由 [产品规格](docs/PRODUCT_SPEC.md) 维护。

## Operating Context

Chromium 浏览器扩展。播放器承担阅读，Popup 承担当前视频状态与快速操作，设置页承担连接与偏好，字幕工作台承担核对、术语确认与导出。

## Brand Commitments

保留 CueWeave / 句织的名称。用户指定 openhanako 的默认 Warm Paper 界面作为整体气质参考：温润、轻盈、有书页感。标志及具体视觉规则归 DESIGN.md；[早期设计方向](docs/archive/design-initial.md)仅作为历史记录。

## Capabilities and Constraints

沿用现有 WXT、React 与业务系统。数据边界遵循 [README 的设计边界](README.md#浏览器扩展的设计边界)；术语和导出行为遵循 [产品规格](docs/PRODUCT_SPEC.md)。预览数据与真实扩展存储隔离，明确标注示例内容。

## Evidence on Hand

- `test/fixtures/youtube/` 提供字幕测试片段。
- 品牌标志的资源与适用范围见 [设计规范](DESIGN.md#shapes)。
- 字体与图标的来源、声明和许可见 [第三方声明](THIRD_PARTY_NOTICES.md)。

## Product Principles

1. 阅读内容和用户任务先于装饰。
2. 区分原始转录、已应用修正与仅记录的建议。
3. 明确展示当前状态、可用操作及恢复路径。
4. 配置和管理界面让出观看时间。

## Accessibility & Inclusion

保持清楚的文字对比度、键盘焦点和有名称的操作控件，支持浅色、深色、窄窗口及减少动态效果偏好。
