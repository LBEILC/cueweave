# 字幕离线评测

从保存的完整 YouTube JSON3 字幕运行翻译，不需要播放视频或重载扩展。这里的“离线”指脱离播放器；翻译仍会请求配置的模型服务。

## 开始一次评测

先按[本地开发](DEVELOPMENT.md#youtube-字幕测试夹具)下载字幕。使用 `--dry-run` 检查选中的窗口，不读取密钥、不调用模型，也不创建运行目录：

```powershell
npm run eval:translate -- --input .fixtures/youtube/VeizK1M7V7E.en.full.json --run .eval/runs/baseline --dry-run
```

确认范围后运行。`--token-file` 指向已有密钥文件，也可设置 `CUEWEAVE_LLM_TOKEN` 环境变量；不要将密钥写进命令参数、上下文文件或 Git。

```powershell
npm run eval:translate -- --input .fixtures/youtube/VeizK1M7V7E.en.full.json --run .eval/runs/baseline --token-file C:/Users/LBLC/.v3-llm-token --cases test/fixtures/youtube/eval-cases.json
```

运行目录必须不存在，避免覆盖旧实验。模型和地址默认值跟随项目 Provider 配置；评测默认使用 Chat Completions，其他协议需通过 `--protocol` 显式选择。完整参数见 `npm run eval:translate -- --help`。

只迭代一段，添加 `--from 21:40 --to 22:20`；初次试通可添加 `--limit 1 --max-requests 8`。时间可用秒数、`mm:ss` 或 `hh:mm:ss`。范围选择保留完整窗口，不裁断窗口内部词元；实体证据仍来自全片。每一次初次请求、协议回退和修复请求均计入请求上限，达到上限暂停。

程序返回码：`0` 表示所选窗口全部完成；`2` 表示暂停或存在失败窗口；`1` 表示输入、文件或其他执行错误。认证、接口不存在、限流和网络错误会暂停，避免对剩余窗口持续发送无效请求。

## 两种评测模式

| 模式          | 输入上下文                                           | 适合观察                           |
| ------------- | ---------------------------------------------------- | ---------------------------------- |
| `pipeline`    | 视频级实体归并、之前成功窗口积累的术语、前 6 条译文  | 完整翻译流程的最终效果及错误传播   |
| `translation` | 显式固定的术语和别名，不使用先前模型译文、不积累术语 | 在同样上下文下比较翻译模型或提示词 |

两种模式都复用生产代码中的 JSON3 解析、词元构建、窗口划分、提示词、翻译解析、校验与修复。命令行只替换浏览器权限检查和请求记录方式，不另写一套翻译算法。

`pipeline` 按时间顺序运行，但不模拟浏览器的优先队列、跳转、缓存命中或播放延迟。它从空术语记忆开始，不读取扩展里的缓存和手动术语。默认上下文没有标题、频道或简介；需要这些信息时显式传入 `--context`。所以它是可重复的顺序回放实验，不应宣称与任意浏览器会话逐字相同。

上下文文件示例：

```json
{
  "videoTitle": "用户核实的视频标题",
  "channelName": "用户核实的频道",
  "videoDescription": "实际简介，不加入评测标准答案",
  "correctionEnabled": true,
  "terminology": [],
  "entityAliases": []
}
```

`terminology` 和 `entityAliases` 的每项均为 `{ "source": "原词", "translation": "固定译法或确认后的实体名" }`。`pipeline` 中省略 `entityAliases` 才会自动执行视频级实体识别；显式传空数组表示不运行识别。`translation` 必须显式提供这两个数组，允许为空。未经独立核对，不要从待比较模型的输出提取术语作为双方共同输入。

## 比较两个运行

保持原字幕、范围、上下文和协议一致，为每个模型使用不同运行目录：

```powershell
npm run eval:translate -- --input .fixtures/youtube/VeizK1M7V7E.en.full.json --run .eval/runs/model-b --model MODEL_ID --base-url https://api.gpt.ge/v1 --token-file C:/Users/LBLC/.v3-llm-token --cases test/fixtures/youtube/eval-cases.json
npm run eval:compare -- --left .eval/runs/baseline --right .eval/runs/model-b --out .eval/comparisons/a-vs-b
```

打开输出目录的 `report.html`。同一原文可能在 A 中分成 2 条、B 中分成 3 条；报告按**重叠原文词元范围**对齐，不按字幕序号强行配对。不同字幕文件或词元无法比较；其他配置差异会在报告中提示。范围不同可以查看，但未覆盖的一侧会标为不完整，不能据此评判优劣。

报告支持关键词搜索、时间定位、只看差异、只看风险项，以及逐范围的判断和备注。备注暂存于当前浏览器；点击“导出评审”下载 JSON 长期留存。浏览器禁用本地存储时仍可编辑并导出。重新生成结果后，评审记录以结果快照区分，避免把旧判断自动套到新输出。

比较提示词或算法时，也应新建运行目录保留旧结果；源码指纹变化会显示为实验变量。相同模型重复运行也可能产生不同输出，单次胜出不代表稳定优势。

## 输出与诊断

所有本地运行产物默认放在 Git 忽略的 `.eval/` 中：

- `input.json`：本次原始字幕快照。
- `result.json`：输入与源码指纹、模型与协议、上下文、窗口、当前和历史尝试、最终字幕及纠错记录。
- `requests/*.json`：逐次完整请求体、原始响应、HTTP 状态、耗时、服务返回的 Token 用量。既保留第一次输出，也保留修复输出；窗口失败不会丢弃请求证据。
- `summary.json`：结构统计和案例检查结果，便于脚本比较。
- `report.html` 与 `assets/`：无需联网加载资源的本地报告，附原样复制的 MiSans 字体及许可。
- `translation.srt` / `.vtt`、`bilingual.srt` / `.vtt`：所选窗口的最终输出。尚有窗口未成功时，文件名带 `.partial`；只选择片段时，即使所有窗口成功，也仅导出该片段。

完整与未完成状态发生切换时，旧状态的导出文件移入 `exports-history/`，避免旧的完整文件被误认为本次结果；历史文件可以恢复。

记录不保存认证请求头，并对当前密钥做精确脱敏，但**仍包含字幕、视频上下文和模型输出**。分享日志前检查内容；不要把完整字幕、模型输出或密钥提交到仓库。服务没有返回用量时记为未知，不当作零消耗，也不推算费用。异常中断后请求目录可能比窗口检查点更新，读取报告或续跑时会恢复这些请求记录。

已完成运行可以随时重建报告，不请求模型：

```powershell
npm run eval:report -- --run .eval/runs/baseline
```

## 续跑与保留基线

按 `Ctrl+C` 会尝试中止当前请求并保存状态；关闭终端或进程崩溃时也保留之前写入的检查点。继续时重用原命令并加 `--resume`：

```powershell
npm run eval:translate -- --input .fixtures/youtube/VeizK1M7V7E.en.full.json --run .eval/runs/baseline --token-file C:/Users/LBLC/.v3-llm-token --cases test/fixtures/youtube/eval-cases.json --resume
```

必须保持输入、模型、地址、模式、上下文、窗口范围和翻译源码一致；否则拒绝续跑，要求新建实验。请求预算按本次启动计算，密钥可以轮换。同一运行有进程锁，不允许同时写入。

只有校验成功且有效上下文指纹相同的窗口能复用。失败窗口会再试；如果补齐了前文或实体别名，改变了后文上下文，受影响的后文也会重跑。历史尝试不删除，但这可能增加请求数量。因此，评估首次通过率要看第一次尝试，评估最终输出看最后一次成功状态；想保留首次完整跑测结论时，先查看报告，不要立即续跑抹平失败现象。

## 怎样判断质量

自动结构检查包括词元缺失、重复、范围外词元、失败窗口和修复次数。译文超过 30 个非空白字符、阅读速度超过每秒 11 字符、展示不足 0.8 秒、原文含点数字未原样出现，会标为**待审阅风险**，不是错误判决，也不会改变输出。数字变化可能是合理单位换算；真实双行情况还取决于播放器尺寸和字号。

案例文件包含时间范围、人工核对提示和可选词面 `required` / `forbidden` 检查。标签不发送给模型；命中要求也不等于翻译准确。原文覆盖不足时显示未完整覆盖。项目案例覆盖已反馈的 Hey 边界、Astra / Sol、长句和 ChatGPT 转录变体；版本号点号另有确定性的领域测试。

建议每次只改一个变量，先看重点片段，再跑全片回归；后续增加不同主题、口音和长度的视频作为未参与调优的保留集，避免只适配这一个访谈。语义完整、专名可信、口语自然、分屏顺畅仍需人工判断。离线报告不能替代最后少量的音画同步、实际换行和跳转播放验证。
