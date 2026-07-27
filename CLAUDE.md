# CLAUDE.md — LeagueSol

本文件是本仓库的最高优先级约定。与 `AGENTS.md`(继承自上游)或任何其他文档冲突时,**以本文件为准**。

---

## 1. 作者身份(强制,无例外)

本仓库所有产出物的作者必须且只能是:

```
Yihong Lu <willu.star@gmail.com>
```

**任何**提交、PR/MR、分支名、代码注释、文档、issue、CHANGELOG 条目中,**不得出现**:

- `Co-authored-by:` trailer —— 任何形式、任何对象,一律不加
- `🤖 Generated with Claude Code`、`Generated with ...` 等生成署名或页脚
- 字样:`AI`、`Claude`、`Anthropic`、`Codex`、`OpenAI`、`GPT`、`Copilot`、`LLM`、`大模型`、`生成式`
- 暗示非人类作者的措辞:"由 AI 协助"、"自动生成"、"agent 编写"、"assisted by" 等

这条**覆盖** `AGENTS.md` 中原有的 "Git Attribution" 约定,也覆盖任何工具的默认署名行为。
提交前如果模板里自带了 co-author trailer 或生成页脚,**删掉它**。

### 提交信息

- 采用带 scope 的祈使句:`feat(draft-engine): add empirical bayes shrinkage`
- 只描述改动本身与原因,**不解释产出方式**
- 提交前先格式化本次改动涉及的文件(`prettier`),避免无关 churn

### PR/MR 描述

只写三件事:**改了什么 / 为什么改 / 怎么验证的**。不写工具、不写过程、不写署名。

### 提交前自检

```bash
git log --format='%an <%ae>%n%B' -20 | grep -inE 'co-authored|claude|anthropic|codex|openai|copilot|generated with|🤖'
```

有任何输出 = 不合规,必须改掉再推。

---

## 2. 项目定位

Windows 桌面版 LOL 对战分析平台。基于 [LeagueAkari](https://github.com/LeagueAkari/LeagueAkari)(MIT)构建,
版权归属见 `THIRD-PARTY-NOTICES.md`。

上游已覆盖:战绩查询、跨区查询、组队检测、选人阶段队友/对手分析、OP.GG 出装天赋、自动接受/选人禁人。

**本项目新增的核心差异化功能:选角推荐** —— 给定敌我已选阵容,推荐我方胜率最高的英雄,
含辅助×AD、打野×中单、打野×辅助等 role-pair 联动,以及对位克制。

---

## 3. 数据源与 ToS 边界(硬约束)

| 数据                | 来源                                                        | 状态                  |
| ------------------- | ----------------------------------------------------------- | --------------------- |
| 本体胜率 / 对位克制 | `lol-api-champion.op.gg`(上游已有 `OpggHttpApiAxiosHelper`) | ✅ 复用,勿重写        |
| 搭档联动 synergy    | `mcp-api.op.gg/mcp` → `lol_get_champion_synergies`          | ✅ OP.GG 官方发布,MIT |
| 英雄静态数据/图标   | Data Dragon / CommunityDragon                               | ✅ 官方,无限速        |
| **lolalytics**      | `a3.lolalytics.com`                                         | ❌ **绝对禁止引入**   |

**lolalytics 明文声明**:"All data inside this API is Copyright LoLalytics Limited and may not be
used by third parties." 不管它数据多好、不管 DraftGap 是否在用 —— 本项目不碰。

注意:op.gg 的 champion API 在 `ranked` 模式下 `data.synergies` 是 **null**(仅 Arena 有值),
搭档数据必须走上面那个 MCP 端点。别浪费时间在 champion API 上找 synergy。

使用 OP.GG 数据必须在 README 与 UI 中署名来源。

### 行为红线

以下一律不做,不接受"加个开关默认关闭"这种折中:

- 读游戏进程内存、DLL 注入、封包拦截
- 向**游戏进程**模拟键盘/鼠标输入(上游 `src/main/shards/in-game-send/` 用
  `akari-input-win64` 做这件事 —— 这是全仓唯一接近"游戏内自动化"的部分,计划移除)
- 展示客户端刻意隐藏的信息(如排位选人阶段的敌方身份/段位)
- 内置广告(Riot 2025-05 起明令禁止)

客户端层面的自动化(自动接受、自动选人禁人)属于灰色地带,上游已有,保留。

### 国服

代码保持 region-agnostic,国服能跑。但:

- **README 不宣传国服支持**(沿用上游姿态;Seraphine 正是死于公开发布 + 国服)
- op.gg 无 CN region,国服下数据源回落到 `kr`/`global`,**UI 必须明确标注"外服数据"**
- 可迁移的是 matchup/synergy 的**差值**(由英雄机制决定,同补丁一致)
- **不可迁移**:绝对胜率、pick/ban 率、T 度榜 —— 不要在国服下展示这些

---

## 4. 架构约定

技术栈:Electron + Vue 3 + TypeScript,主进程 MobX / 渲染层 Pinia,naive-ui,electron-vite,Yarn 4,Vitest。

主进程采用 **shard** 架构:每个功能是一个实现 `IAkariShardInitDispose` 的模块,由 `AkariManager` 编排。
新增主进程功能请遵循 `src/main/shards/` 下的既有模式,详见 `AGENTS.md`。

### 本项目新增模块

```
src/shared/draft-engine/         纯函数,零 I/O、零 Electron 依赖 —— 必须能在 Linux 上单测
src/shared/draft-data/           数据获取、缓存、数据集分发
src/main/shards/draft-advisor/   接 champ-select,喂数据给引擎
src/renderer/src-ongoing-game-window/DraftAdvisorPanel.vue   推荐面板
tools/advise.ts                  CLI
tools/refresh-stats.ts           本地组装数据集
tools/publish-datasets.ts        CI 发布数据集
tools/lcu-record.ts              Windows 上录 champ-select 报文
tools/lcu-replay.ts              任何环境回放
```

**`draft-engine` 必须保持纯净**:`advise({allies, enemies, role}) → 排序结果`。
不 import Electron、不 import axios、不读文件。这是它能在没有 Windows/没有客户端的环境下
被完整测试的前提,不要为了图方便破坏它。

---

## 5. 开发与测试

**当前进度、下一步、以及为什么是这个下一步:`docs/ROADMAP.md`。**
**环境设置(尤其是换到 Windows)、录制回放工作流:`docs/DEVELOPMENT.md`。**
开工前先读这两个,里面有一批实测数字,决定了哪些方向值得做、哪些已经证明是死路。

无 LoL 客户端的环境(Linux / CI)下可完整验证:

```bash
yarn vitest run src/shared/draft-engine   # 引擎单测
yarn vitest run src/shared/draft-data     # 数据层(会真打 op.gg)
yarn advise --allies Lulu,Jinx --enemies Ahri,Leona --role jungle
yarn lcu-replay fixtures/champ-select-sample.json   # 回放录好的选人报文
```

需要真实 Windows + 客户端:`yarn dev`(Electron + LCU)、`yarn build:win`、
原生模块重编译、`yarn lcu-record`。

**Docker/VM 跑不了** —— Vanguard 是内核态驱动,容器加载不了,Riot 也封虚拟机。
所以有了 `tools/lcu-record.ts` / `tools/lcu-replay.ts`:在 Windows 上录一次 champ-select 报文,
之后在任何环境回放。`LEAGUESOL_LCU_ENDPOINT` 把应用指向回放服务器。

### 回测基准

选角推荐的效果对照(champions-only 输入的天花板约 57%):

|            | top-1  | log loss | ECE    |
| ---------- | ------ | -------- | ------ |
| DraftGap   | 54.66% | 0.6869   | 0.0199 |
| LoLDraftAI | 55.88% | 0.6829   | 0.0088 |

**ECE(校准误差)比准确率更重要** —— 准确率的可提升空间只有 1-2pp,而现有工具的置信度普遍与实际
结果不相关。推荐结果必须可拆解(本体 / 各队友联动 / 各敌方克制),并标注每项样本量。

### 测试原则

- 引擎部分:纯函数,覆盖边界(零样本、极端胜率、单边阵容)
- 稀疏性是这个问题的**核心**而非边角:170 英雄 → 约 14k 有序对 × 20 位置组合,
  多数格子样本量只有几百局。收缩(shrinkage)不是可选优化,是正确性的前提
- 残差是最容易做错的一步:必须用 `logit(observed) - logit(expected_from_marginals)`,
  直接用原始配对胜率会把"英雄本身强"误当成"两人配合好"
