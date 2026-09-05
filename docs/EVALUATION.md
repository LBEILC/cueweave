# 字幕离线评测

从保存的完整 YouTube JSON3 字幕运行翻译，不需要播放视频或重载扩展。这里的“离线”指脱离播放器；翻译仍会请求配置的模型服务。

日常片段回归使用[翻译测试集 v1](../test/benchmarks/translation/README.md)：5 个视频、15 个主片段及 3 个 ASR 对照，按视频划分调试集和保留集。它提供本地原文、助手参考译文、真实生产首轮运行器和独立评审工具；参考与评审内容不发送给待测模型。本页 `eval:translate` 的严格复核入口与生产首轮入口不同，接入测试集时按其文档选择实际调用链。

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

字幕按页加载，翻页会释放上一页的控件；评审表单和日志在展开时加载。页内搜索与筛选覆盖完整报告，时间定位和字幕锚点会自动切到对应页。浏览器自身的查找只覆盖已加载内容，查找全片请使用报告的搜索框。分页不会丢失已填写的备注。

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

## 窗口与恢复策略实验

`scripts/experiment-resilience.ts` 是独立的离线实验入口，不使用 `eval:translate` 的生产修复流程。D 组复用已有 C 规划的窗口，E 组重新规划相邻窗口的语义接缝；两组使用相同的翻译、语义复核与局部恢复策略。基线位置由脚本中的 `baselinePath` / `originalPath` 指定，运行前须备齐对应的结果和规划文件。

```powershell
node --import tsx scripts/experiment-resilience.ts --out .eval/experiments/resilience-trial --dry-run
node --import tsx scripts/experiment-resilience.ts --out .eval/experiments/resilience-trial --token-file C:/Users/LBLC/.v3-llm-token
```

用 `--case` 选择一个案例，用 `--max-requests` 限制本次两组共享的请求总数。所有规划、复核、修复和截断重试均计入上限；可选案例见 `scripts/eval/window-experiment.ts` 的 `CASES`。模型和端点由实验入口指定，实际值及输出额度写入 `manifest.json`。参数以各入口的 `--help` 为准。

要检查旧错误能否被恢复，使用旧运行的首次响应，跳过重新翻译：

```powershell
node --import tsx scripts/replay-resilience.ts --from .eval/experiments/semantic-windows-20260903/C-planned --out .eval/experiments/recovery-trial --starts 400,792480,1324480,2911680 --token-file C:/Users/LBLC/.v3-llm-token
```

`--starts` 接收旧结果中的窗口开始毫秒数；`--dry-run` 先验证输入，不读取密钥或请求模型。默认选择该窗口首次尝试的第一个请求；用 `--request-index` 指定其他请求（下标从 0 开始），例如选取输出额度重试后的完整响应。回放采用所选请求保存的上下文。这是恢复能力验证，不能拿它的请求数冒充从零开始翻译的成本。

两个实验入口都要求新输出目录，不支持 `--resume`。中断后保留检查点和请求记录；重试时使用新目录。最终状态以 `result.json` / `summary.json` 为准，进程退出不等于所有字幕或语义复核均已成功。

除通用输出外，实验还记录 `manifest.json`、`recovery.json`；双组实验的 `plans.json` 记录独立窗口规划。根目录 `summary.json` 汇总包含规划的总请求数和用量，HTML 中的翻译流程统计不包含独立规划请求。

解释实验状态时分开看三个指标：完整产出、词元覆盖、语义复核。`partial` 表示只接受了部分字幕，不能算完整成功；`reviewComplete: false` 表示复核不可用时保留了已有候选，不能算语义检查通过。长字幕、阅读速度和口语停顿作为质量风险保留；真正的漏译或对齐问题只修复对应固定 ID，结构损坏时另行请求语义分段。具体处理见 `scripts/eval/resilient-translation.ts` 的 `recoverCandidate`，输出截断处理见 `scripts/eval/complete-output.ts` 的 `requestCompleteOutput`。

### E 全片运行

`scripts/experiment-full-seams.ts` 验证基线窗口覆盖完整原文，再处理相邻双窗口的内部接缝；奇数个窗口留下的尾部窗口原样处理。规划不通过时使用对应原始窗口，并记录回退原因。分组之间的外侧边界不移动，具体规划规则见 `scripts/eval/seam-planner.ts` 的 `seamPrompt`。

```powershell
node --import tsx scripts/experiment-full-seams.ts --out .eval/runs/full-e-trial --dry-run
node --import tsx scripts/experiment-full-seams.ts --out .eval/runs/full-e-trial --token-file C:/Users/LBLC/.v3-llm-token
```

组间可以并发，组内按时间顺序翻译。输入固定使用全片原文证据和已确认的视频别名；不继承旧运行的中文译文，仅使用本组前面已经接受的译文和前后原文。因此它是独立全片实验，与按固定时间顺序积累全部历史译文的播放器仍有区别。

该入口支持 `--resume`。输入、源码和固定上下文必须不变；符合本次上下文的完整产出且已完成复核的窗口会复用。其他窗口继续尝试；前一窗结果变化时，本组后一窗的上下文可能变化并需重新翻译。请求上限按本次启动计算，历史请求保留。不要在运行中修改实验源码；新算法使用新目录。

输出包括逐窗口与逐请求检查点、规划记录、恢复记录、源码快照和分页报告。复核问题用 `ids` 数组表示受影响字幕；数组成员逐个校验，跨条问题的所有成员都进入修复。JSON 的复核问题数按问题计，不把涉及多条字幕的一个问题误算成多个。

全片运行的 `summary.json` 与 HTML 请求统计包含独立规划；`full-summary.json` 另列规划回退、尚未复核的窗口、未解决问题及修复情况。`result.json` 的 `planningAttempts` 保存规划请求，`recovery.json` 通过 `attemptId` 区分历史与最终尝试。全片产物位于用户指定的输出目录，不会覆盖旧实验或扩展缓存。

### 滚动接缝与局部重分段

用 `scripts/experiment-rolling.ts` 对照窗口规划和展示边界修复。输入位置与选取片段见该入口的 `baselinePath`、`savedPath` 和 `CASES`；用 `--dry-run` 验证同一原文范围完整覆盖。

```powershell
node --import tsx scripts/experiment-rolling.ts --out .eval/experiments/rolling-trial --dry-run
node --import tsx scripts/experiment-rolling.ts --out .eval/experiments/rolling-trial --token-file C:/Users/LBLC/.v3-llm-token
```

- **E-fixed**：复用已记录的 E 窗口边界，重新翻译。历史规划成本不计入本轮请求。
- **F-rolling**：相邻窗口规划后确定左窗，右窗暂存，与下一原始窗口继续规划。所有片段内部接缝均可调整，片段最外侧边界仍固定。规划失败保留该次输入边界并记录原因，见 `scripts/eval/rolling-seams.ts` 的 `planRollingSeams`。
- **G-repaired**：复用 F 译文，另行复核展示边界，由模型选择连续范围重分段。只在原文覆盖、语义及分段收益复核通过后替换，失败则保留该范围旧字幕，无关联修复可分别提交。含转写修正记录的范围暂不重分段，见 `scripts/eval/boundary-repair.ts` 的 `repairDisplayBoundaries`。

E/F 使用相同原文证据、已确认别名和上下文策略，不输入历史中文答案。各片段内按顺序使用前面的已接受译文；案例标签和评审要求不发送给模型。G 的报告按片段聚合输出，其“窗口”不是新增的翻译请求窗口，不能将 G 的窗口成功数与 E/F 直接比较。

输出中的 `E-vs-F/report.html` 用于观察滚动规划，`F-vs-G/report.html` 用于观察局部重分段。根目录 `summary.json` 汇总三档新增成本；G 的请求与用量仅为追加成本，完整 G 流程成本须加上 F。`plans.json` 保存切点与回退，`repairs.json` 保存局部修复前后和保留原因；复核完成不等于所有问题都被发现或修好。

`--max-requests` 限制本次共享请求总数，涵盖规划、翻译、复核、修复和输出截断重试。使用新目录，不支持续跑；中断保留检查点与独立日志。模型、端点、源码指纹和上下文策略记录在 `manifest.json`，实际参数见 `--help`。

仅迭代局部修复时，可以直接复用 F 的已存译文，不重新规划或翻译：

```powershell
node --import tsx scripts/replay-boundaries.ts --from .eval/experiments/rolling-trial/F-rolling --out .eval/experiments/boundary-replay --token-file C:/Users/LBLC/.v3-llm-token
```

回放要求来源目录的 `plans.json` 与结果窗口一致，使用新输出目录，不支持续跑。`summary.json` 的成本只包含本次新增请求，完整流程须加上来源运行成本；来源指纹记录在 `manifest.json`。`repairs.json` 区分 `applied`（通过本轮验收并替换）与 `retained`（未替换，旧字幕仍可用）。两者都是执行结果，不代表人工质量判决；跨条修复的整个范围一起提交。

### 连续范围与跨窗联合复核

`scripts/experiment-continuous.ts` 将相邻的原始窗口合并为连续规划范围，案例标签只用于评审，不决定处理切点。来源位置和选择范围见入口中的 `baselinePath`、`oldPath`、`selected`。

```powershell
node --import tsx scripts/experiment-continuous.ts --out .eval/experiments/continuous-trial --dry-run
node --import tsx scripts/experiment-continuous.ts --out .eval/experiments/continuous-trial --token-file C:/Users/LBLC/.v3-llm-token
```

该实验分开记录以下路径：

- `G2-reference`：相同原文范围的历史 G2 输出，不产生新调用。
- `H-translation`：连续滚动规划并重新翻译，使用 G2 的翻译提示词；前面接受的译文跨旧片段边界传递。
- `H-refined`：复用 H 的译文，对连续范围执行 G2 展示边界修复；请求统计为追加成本。
- `G2-joint-replay`：直接复用历史 G2 译文，仅联合复核旧接缝两侧的少量字幕；请求统计也为追加成本，不是完整翻译成本。

`scripts/eval/continuous-boundaries.ts` 的 `continuousWindowGroups` 按原文词元连续性组合窗口，拒绝重复、重叠，不跨未选中的原文空缺。`repairAcrossSeams` 用右侧首词元 ID 定位接缝，字幕合并后重新定位后续接缝；最多取两侧各三条字幕共同修复。原文缺失时不猜测补齐，已经包含在同一字幕内的接缝不重复处理。模型复核、重分段和验收复用 `repairDisplayBoundaries`；两侧作为同一连续原文范围提交。

主对比位于 `G2-vs-H/report.html`；`G2-vs-joint/report.html` 隔离旧接缝修复效果；`H-raw-vs-refined/report.html` 查看重新翻译后的追加修复。根目录 `summary.json` 只汇总新 H 请求及两条派生路径的追加成本，记录规划回退及复核状态；历史参考统计见 `G2-reference` 报告。历史参考与新 H 之间仍有模型随机性和上下文路径差异，不是严格单变量的准确率实验。

该入口要求新目录，不支持续跑。`--max-requests` 对全部新请求共享计数；检查点、独立请求日志和源码快照保留在输出目录，实际参数见 `--help`。连续样本最外侧仍为所选范围边界；报告不代表已经验证整片或浏览器调度。

### 连续首轮与队列耗时

用 `scripts/experiment-first-pass.ts` 评测观看视频所需的首次可用结果。滚动规划确定左窗后即可开始翻译，同时规划下一处接缝；不必等整片规划完成。每窗使用已经接受的前文译文和前后原文，正常路径不追加模型复核。翻译与异常恢复实现见 `packages/core/src/provider/firstPass.ts` 的 `translateFirstPass`。

```powershell
node --import tsx scripts/experiment-first-pass.ts --out .eval/runs/first-pass-trial --dry-run
node --import tsx scripts/experiment-first-pass.ts --out .eval/runs/first-pass-trial --token-file C:/Users/LBLC/.v3-llm-token
```

用 `--windows` 先测开头部分，省略则处理完整字幕；参数见 `--help`。相同源码、输入和上下文可用 `--resume` 续跑，完整且上下文一致的结果会复用。每次启动独立计请求预算，历史调用仍计入运行总成本。运行时不要修改翻译或规划源码。

结构损坏时从原文重新生成完整窗口；个别字幕校验失败时仅恢复对应固定范围，并分别接收通过校验的结果。原有可用字幕不会因另一个恢复条目失败而丢弃。超过恢复预算仍失败的范围明确计为缺失，不把原文回退算成翻译成功。可读性风险保留供评审，不按空格或字数机械重切。

`state.json` 记录连续切点、恢复情况和完成时间；`first-pass-summary.json` 汇总首窗等待、窗口耗时分位数及请求成本。`firstPassWindows` 是仅一次实际请求且无诊断的完整窗口；`firstPassCompleteWindows` 表示完整模型响应无需内容恢复，可能已发生输出截断重试。两者都不是语义准确率。`comparisonReport` 指向本次对照历史 E 的报告，续跑时生成新的对比目录以保留旧快照；试跑只覆盖部分原文时，未选范围不可比较。

`steadyPlaybackLateWindows` 仅模拟首窗准备好后从头以原速连续播放，使用离线队列的真实完成时间。它不包含播放器渲染、缓存、网速变化或跳转调度；续跑数据也不能视为一次不间断播放的测量。浏览器实际首屏、预取及跳转需另行验证，实验不会改写扩展缓存。

定位未收到 HTTP 响应的连接失败时，可在命令的脚本路径前增加 `--import ./scripts/eval/network-diagnostics.ts`。它仅向标准错误输出异常名称和底层错误码，不输出请求头或密钥；原异常仍交回评测入口处理。

只验证本地解析或元数据修正时，可以用 `scripts/replay-first-pass.ts --from <完整首轮运行目录> --out <审计 JSON 路径>` 回放已保存响应，无需密钥或模型请求。它核对阶段提示词、字幕文本、范围和元数据；提示词变化或缺少阶段日志会产生差异，不能据此替代新提示词的真实模型实验。

## 速度与质量策略对照

目标、三档策略、局部交付行为和运行方法见 [TRANSLATION-STRATEGY.md](TRANSLATION-STRATEGY.md)。`run-translation-benchmark.ts` 支持 `--mode speed|balanced|quality`，默认 balanced；`compare-translation-strategies.ts` 对相同输入与源码的多轮结果比较首次可用、整段耗时、请求数和缺失量。完整覆盖不等于语义正确。
