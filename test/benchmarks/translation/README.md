# 翻译测试集 v1

用于英语字幕到简体中文的算法与提示词回归。原文于 2026-09-05 整理；准备工具不调用模型。首版按来源视频划分 development 与 holdout，避免同一视频不同片段泄漏到两边。另提供生产首轮运行器和参考译文评审工具，不修改生产算法。

- 主测试集：5 个视频、15 段计分原文，约 11.43 分钟。
- 日常调试：9 段；其中 3 段为 smoke，约 2.06 分钟。
- 保留验证：另外两个视频的 6 段，约 5.53 分钟；不用于挑选提示词或反复试错。
- 诊断对照：科普视频另取相同范围的 3 段原语言 ASR 轨，约 2.23 分钟；不计入主测试集均分。
- 每段带左右各约 15 秒原文上下文，实际请求文本总量大于计分时长。计分范围不要求模型在端点硬切。

## 来源与覆盖

| 来源                                                                                                               | 划分 / 字幕轨                             | 计分范围                            | 重点                                     |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | ----------------------------------- | ---------------------------------------- |
| [Sources Podcast：Sam Altman on Astra, AGI, and the future of OpenAI](https://www.youtube.com/watch?v=VeizK1M7V7E) | development / 既有 ASR                    | 5:54–6:13、13:06–13:31、21:49–22:26 | 旧问题回归、陌生实体、口语边界、长条件句 |
| [BBC Learning English：Talking about food](https://www.youtube.com/watch?v=4C4wlOAscvY)                            | development / en-GB 人工轨                | 1:09–2:05、3:07–3:57、3:57–4:30     | 双人问答、频率、否定、口语表达           |
| [TED-Ed：How do vaccines work?](https://www.youtube.com/watch?v=rb7TVW77ZCs)                                       | development / en 人工轨；en-orig ASR 对照 | 0:40–1:29、1:29–2:09、2:16–3:01     | 科普术语、因果、多层条件、类别比较       |
| [3Blue1Brown：But what is a neural network?](https://www.youtube.com/watch?v=aircAruvnKk)                          | holdout / en 人工轨                       | 0:49–1:41、2:52–3:38、4:33–5:32     | 数量与范围、像素映射、逐层因果           |
| [TED：The Danger of a Single Story](https://www.youtube.com/watch?v=D9Ihs241zeg)                                   | holdout / en 人工轨                       | 0:22–1:26、1:44–2:37、3:15–4:13     | 叙事视角、反差、引语、姓名与指代         |

精确毫秒、标签、逐段检查要点、字幕 SHA-256 见 [manifest.json](manifest.json)。标题和频道来自本次取得的视频元数据。字幕正文、下载元数据和本地评审产物留在 Git 忽略的 `.fixtures/`；仓库只保存清单、检查要点和准备工具。

这是一份**已检查原文的回归集**，另配有助手撰写的 18 段中文参考译文，仍不是人工金标准。未逐段听音校对，不以“人工字幕轨”推定绝对正确，也不声称已覆盖口音识别质量。参考在首次模型基线之前冻结；保留集已用于基线评审，尚未据其输出修改提示词或算法。

## 本机使用

在项目根目录执行，均不访问网络、不读取密钥、不调用模型：

```powershell
# 查看划分和全部片段
node --import tsx scripts/prepare-translation-benchmark.ts list

# 验证已生成的 v1：来源指纹、切片、划分、词元与输出快照
node --import tsx scripts/prepare-translation-benchmark.ts check

# 从清单引用的原始字幕创建全新快照，目录必须不存在
node --import tsx scripts/prepare-translation-benchmark.ts build --out .fixtures/translation-benchmark/v1-copy
```

默认本地目录为 `.fixtures/translation-benchmark/v1/`：

- `index.json`：输入哈希、预处理源码指纹、划分、计分与上下文词元数量。
- `cases/<id>.input.json`：**数据输入**。包含原时间轴上的词元、计分词元 ID、有限视频上下文；没有评审检查项或译文答案。
- `cases/<id>.review.json`：**评审侧数据**。检查要点和空评审槽位，不得发送给翻译、规划或修复模型。
- `REVIEW.md`：可读的逐段前文、计分原文、后文和来源时间链接。

构建先对完整字幕运行现有 JSON3 解析、滚动字幕去重和词元生成，再裁取上下文；不先切原始 events，以免损坏滚动去重、时间与 ID。`scoreTokenIds` 用词元开始时间落在 `[fromMs, toMs)` 确定；实际首末词元时间另记于索引。上下文与相邻样本可能重叠，但同轨计分范围不重叠。不能把未显示目标范围外的上下文翻译算成漏译，也不能按新字幕序号强行对齐两个结果。

人工轨只有 cue 时间时，词元时间可能为现有算法插值；输入明确标记为 `cue-times-with-interpolated-tokens`。ASR 的 segment offset 也不等于经过人工验证的每词时间，标为 `segment-offsets-with-possible-interpolation`。人工轨主要用于语义质量和保留 cue 时间的后续路径，不能用插值时间来证明真实音画同步。未来保留 cue 翻译入口应从清单中的原始 JSON3 读取完整 cue；本次不新增该生产入口。

## 后续 A/B 约定

1. 先跑 `smoke: true` 的 3 段，再跑全部 development 主样本；方案冻结后运行 holdout。诊断 ASR 对照单独汇总。
2. 以 **production-first-pass** 为实时翻译基线：`scripts/run-translation-benchmark.ts` 直接使用共享 `PlaybackPlan` 和 `translatePlaybackWindow`（内部调用 `translateFirstPass`），不复制翻译实现。不要直接把这个输入格式传给接收 JSON3 的旧命令。
3. 现有 `eval:translate` 调用的是 `translateTokenWindow` 的严格复核路径，不等于生产首轮路径；可另立实验，但必须标明实际入口。新的片段运行器依次处理片段和窗口，不模拟浏览器缓存、并发预取或真实播放等待。
4. 提示词 A/B 固定规划后的窗口和模型配置；窗口算法 A/B 固定提示词，记录切点与额外规划调用。每个样本各自从空翻译记忆开始，前文译文只能在该样本中按时间顺序产生，不能跨视频继承。
5. 默认固定上下文只含本片段及 padding 提取的原文证据、真实标题和频道；`terminology`、`entityAliases`、`previousCues` 均为空。不得使用旧模型结果或评审标签构造上下文。需要全片实体归并时，单列 pipeline 模式，使用本来源的全片原文并计入调用成本，不能混入固定上下文对比。
6. 模型处理 `tokens` 的完整上下文范围，评审只聚焦 `scoreTokenIds`。评分边缘若与输出 unit 交叉，连同该 unit 和附近原文审阅，不能强制以计分端点重分段。
7. 记录模型、端点、协议、提示词/算法版本、输入指纹、每次请求、首轮输出、恢复输出、实际用量和耗时。对关键 development 片段重复 2–3 次，并单列每次结果。
8. ASR 对照不得读取人工轨、人工轨译文或人工轨提取的术语。两条字幕不一定逐字相同，只按视频时间对照；词面差异不是自动错误判决。

### 评分建议

先标记关键语义错误，再评价流畅度，不能用更短或更自然掩盖漏译。允许多种等价中文表达，不强制逐字匹配唯一答案。

- 关键语义：否定/条件/因果/比较方向错误、实际内容遗漏或凭空新增。
- 实体与数字：名称、对象、数量、范围、单位及其对应关系。
- 分段衔接：是否拆断搭配、重复译义、悬空引导词、错置引语或说话人内容。
- 中文自然度：按 1–5 分独立评分，并记录证据；没有评审时留空，不能记为满分。
- 工程指标：词元覆盖、结构恢复次数、首次可用耗时、P50/P95、请求数和报告用量。

盲评时随机隐藏 A/B 身份；先按视频汇总再计算宏平均，同时保留逐段关键错误和分项结果。主集 15 段中仍有 3 段来自旧访谈，报告应同时给出旧回归与新增来源结果，不能将“全通过”解释成通用准确率。

后续若根据 holdout 的具体输出调整了提示词，该批 holdout 就已参与开发；应记录暴露并在下一版本补入新视频，而不是继续宣称未见数据。多人抢话、强噪声、法律/商业术语、更多自然口音等是后续扩充方向；本次先保持小而可审阅。

## 参考译文与模型基线

本机参考文件为 `.fixtures/translation-benchmark/references/v1/references.json`，可读版为同目录的 `REFERENCES.md`。[reference-index.json](reference-index.json) 记录冻结哈希与对应输入哈希；参考正文留在本地，不进入模型请求或仓库。

每段包括通顺的参考译文、逐项语义要点、可接受变体，以及切片边缘补全说明。参考不锁定字幕条数、标点或中文措辞；原文优先于参考。保守保留不确定的 ASR 名称是有效结果，例如未提供映射的 Soul 或 T-C cells。因上下文补全而写入参考的边缘内容不能成为额外漏译扣分项。

```powershell
# 无网络预检，不读取密钥或创建输出
node --import tsx scripts/run-translation-benchmark.ts --out .eval/benchmarks/trial --group smoke --dry-run

# 真实模型基线，目录必须不存在；也支持 development、holdout、diagnostic、all
node --import tsx scripts/run-translation-benchmark.ts --out .eval/benchmarks/trial --group smoke --token-file C:/Users/LBLC/.v3-llm-token --max-requests 30
```

默认模型、端点及协议跟随仓库 Provider 默认配置，可用 `--model`、`--base-url`、`--protocol` 显式覆盖。不读取浏览器个人设置。`--resume` 要求相同输入、参数与源码；按片段复用最后一次完整结果，失败片段保留历史并重新运行。每次启动单独计算请求预算；报告用量包含历史请求。初次失败证据不要用续跑后的结果覆盖评价。

运行器只读数据输入，按白名单构造模型上下文，**不读取参考译文、语义检查项或评审文件**。每段从空术语记忆开始，在段内继承已接受译文及自动术语；不运行全片实体归并。输出保存全部真实请求、原始响应、源码快照、输入快照、逐窗口结果、缺失词元和汇总。完整候选与最终交付可能不同，应分别定位模型错误与校验/恢复错误。

本机首轮基线位于 `.eval/benchmarks/reference-v1-baseline/`；参考先行冻结后才调用模型，没有基于这轮结果修改生产算法或提示词。

评审通过独立 JSON 提供，由人或评审助手对照原文填写；报告工具不通过字符串相似度自动给模型打分，也不会再次调用模型。`judgments` 顶层需记录 `runFingerprint`、`runResultSha256`、`referenceSha256` 和 `reviewer`。每个片段记录：

- `meaningVerdicts`：与参考语义要点逐项对应的 `pass`、`partial`、`fail`、`unavailable` 或 `context-only`。未产出单列；边界外内容不计分。
- `fluency`：只对已输出中文评 1–5 分，不能抵消漏译或输出不完整。
- `verdict`：`usable`、`needs-polish`、`needs-fix` 或 `incomplete`。
- `issues`：类别、严重程度、最终字幕数组中的从 0 开始索引、原文与译文证据；校验失败没有最终字幕时使用空索引并引用原始请求记录。
- `notes`：说明可接受变体、判断依据或不确定性。

```powershell
# 本机已存在的助手评审；换新运行时须重新核对并填写 judgments
node --import tsx scripts/report-translation-benchmark.ts --run .eval/benchmarks/reference-v1-baseline --judgments .eval/benchmarks/reference-v1-baseline/judgments-v2.json --out .eval/benchmarks/reference-v1-baseline/assessment-new
```

输出目录必须不存在。工具核对输入、参考与模型输出快照的哈希，拒绝把旧判断套到续跑的新结果；不完整输出不能标为可用。结果分主集、开发、保留及诊断四种视图，分别记录完整产出、语义要点和展示风险。语义要点保留比例是本集的助手评审结果，不是通用翻译准确率。原始数据准备工具中的空评审模板不等于这里已经完成的逐项评审。

## 原始数据恢复与版本管理

现有本机快照已备齐。换机器时需要另外复制 `.fixtures/youtube/VeizK1M7V7E.en.full.json` 与清单引用的 `.fixtures/translation-benchmark/raw/` 字幕文件；原始完整字幕没有提交到仓库。工具对缺失或哈希变化直接报错。

也可使用项目已有 `yt-dlp.exe` 从来源 URL 重新取得公开字幕，仅取明确英文轨，避免 `en.*` 匹配到其他语言自动翻译成英文的轨道：

```powershell
# 在全新目录下载，不覆盖已冻结原文；不下载视频或音频
& apps/desktop/resources/tools/bin/yt-dlp.exe --skip-download --write-subs --write-auto-subs --sub-langs 'en,en-orig' --sub-format json3 --no-playlist --no-progress --sleep-subtitles 3 --js-runtimes 'deno:apps/desktop/resources/tools/bin/deno.exe' -o '.fixtures/translation-benchmark/refetch/%(id)s.%(ext)s' 'https://www.youtube.com/watch?v=rb7TVW77ZCs'

# BBC 原语言人工轨使用 en-GB
& apps/desktop/resources/tools/bin/yt-dlp.exe --skip-download --write-subs --sub-langs en-GB --sub-format json3 --no-playlist --no-progress --sleep-subtitles 3 --js-runtimes 'deno:apps/desktop/resources/tools/bin/deno.exe' -o '.fixtures/translation-benchmark/refetch/%(id)s.%(ext)s' 'https://www.youtube.com/watch?v=4C4wlOAscvY'
```

其他视频替换 URL 即可。YouTube 字幕会变化，重新下载不保证复现 v1 字节。旧访谈文件还有原有 fixture 包装字段；不能把重新下载的 JSON3 直接当作同一个旧文件。出现新指纹时先检查文本变化，再创建新版本清单和输出目录，保留 v1；不通过更新旧哈希掩盖输入变化。
