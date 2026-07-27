# 现状与后续

最后更新:2026-07-27。换到 Windows 开发前的交接点。

---

## 已完成

|                                    | 位置                                                          | 状态                      |
| ---------------------------------- | ------------------------------------------------------------- | ------------------------- |
| 建仓、去 fork 化、品牌改名         | 全仓                                                          | ✅                        |
| 项目约定(作者身份 / 数据源 / 红线) | `CLAUDE.md`                                                   | ✅                        |
| 推荐引擎(纯函数)                   | `src/shared/draft-engine/`                                    | ✅ 全单测                 |
| 数据层(op.gg + MCP + Data Dragon)  | `src/shared/draft-data/`                                      | ✅ 实打端点验证           |
| 数据集发布流水线                   | `.github/workflows/datasets.yml`、`tools/publish-datasets.ts` | ✅ 线上跑通               |
| champ-select 接入                  | `src/main/shards/draft-advisor/`                              | ⚠️ 未对真客户端跑过       |
| 渲染层面板                         | `src/renderer/src-ongoing-game-window/DraftAdvisorPanel.vue`  | ⚠️ 未在真 Electron 里看过 |
| CLI                                | `tools/advise.ts`                                             | ✅                        |
| LCU 录制/回放                      | `tools/lcu-record.ts`、`tools/lcu-replay.ts`                  | ✅ 合成 fixture 跑通      |

**620 tests 通过 / 1 skipped,typecheck 干净。** 唯一失败的文件是
`src/main/shards/keyboard-shortcuts/index.test.ts`,需要真实 Electron 二进制,
在下不了它的无头 Linux 上必然失败 —— 环境限制,不是回归,换到 Windows 后确认它变绿。

### 已经端到端验证的链路(用合成 fixture)

```
lcu-replay → HTTP/WS → toDraftContext → advise
  t=0ms     role=support allies=2 enemies=0  → 526:52.88%  78:52.38%  89:52.14%
  t=2000ms  role=support allies=2 enemies=2  → 526:52.93%  26:52.29%  201:52.24%
```

Leona(89)在 t=0 被推荐、t=2000 消失 —— 因为对面把她选走了。时序行为是对的。

### 线上数据集

rolling release `datasets` 已发布:patch 16.14 / kr / emerald_plus,gzip 后 124 KB。
应用侧实测 **2 个请求、1.9 秒**。

---

## 关键测量结果(决定了下一步做什么)

全补丁刷新之后测的,patch 16.14 kr emerald_plus。这些数字是后续决策的依据,不要凭直觉推翻:

**1. 稀疏性是核心问题,不是边角。**
配对格子中位数 **191 局**;15,151 个格子里 **97.8% 不到 2,400 局**(要把胜率估到 ±2% 所需)。
收缩(shrinkage)是正确性的前提,不是可选优化。

**2. 信号只存在于一部分 role-pair 上。**
per-role-pair 的收缩强度 κ(越小 = 信号越强;上限 20000 = 测不到任何效应):

| role pair              | κ           | 解读       |
| ---------------------- | ----------- | ---------- |
| adc \| adc(对线)       | 735         | 真实信号   |
| mid \| mid(对线)       | 981         | 真实信号   |
| adc ↔ support(联动)    | 1513 / 2222 | 真实信号   |
| jungle 对位            | 20000(封顶) | **测不到** |
| jungle ↔ mid(联动)     | 20000(封顶) | **测不到** |
| jungle ↔ support(联动) | 20000(封顶) | **测不到** |

这直接反驳了"中野 / 野辅联动能从 op.gg 数据里测出来"这个假设。不是模型不够好,是数据里没有。

**3. op.gg 的 counters 只有同路。**
11,011 个对位格子里,**跨路的是 0 个**。`crossLaneMatchupWeight` 这个参数在当前数据源上是惰性的
(代码注释里写了),接上更好的数据源之前它不起作用。

**4. 本体强度仍然主导。**
base 项 ±14~27,配对项 ±2。也就是说**现在的输出接近一个带下路修正的 T 度榜**。
这一点写在测试文件的注释里,免得被误读成"引擎已经验证有效"。

结论:**要做出真正的差异化,数据源必须换。** 这就是下面第 2 项。

---

## 下一步

### 1. 在真实客户端上跑一遍(先做这个,门槛最低)

前置:Windows + 客户端。

```powershell
yarn lcu-record --out fixtures/champ-select-real.json --description "..."
git add fixtures/champ-select-real.json && git commit
```

然后 `yarn dev` 进一场自定义房的选人阶段,确认:

- [ ] `draft-advisor` shard 起得来,`toDraftContext` 拿到的 `role` 与客户端一致
      (客户端说 middle/bottom/utility,统计侧说 mid/adc/support)
- [ ] 面板随敌我 pick 实时更新,hover(`championPickIntent`)也算数
- [ ] 已被选走的英雄不出现在推荐里
- [ ] 数据集能下下来(冷启动路径),下不来时面板显示的是错误而不是空白
- [ ] 国服上 `statisticsAreForeign` 为 true,面板确实标注了"外服数据"
- [ ] `keyboard-shortcuts` 测试在 Windows 上变绿

这一步不需要写新代码,是**验证已写但从未运行过的代码**。真实 fixture 进仓之后,
以后所有回归都能在任何机器上跑。

### 2. 自建 Match-V5 爬虫(真正的差异化)

**为什么必须做**:见上面的测量结果。op.gg 的 synergy 每次只回 top-10、4,140 个格子、
中位数 191 局,且完全没有跨路对位。中野/野辅联动在这个数据源上不可测 —— 换个模型也没用。

自建爬虫能拿到:完整 duo 表(不是 top-10)、跨路对位、任意 role-pair、自己控制的段位与地区切片。

前置条件:

- **Riot dev key**(developer.riotgames.com,免费;个人 key 24 小时过期、100 请求 / 2 分钟。
  长期跑要申请 personal / production key)
- 一台能长期跑的机器
- 约 3-4 周积累到可用样本量

**只有发布者需要 key,用户永远不需要** —— 数据集流水线已经把这件事解决了(见 README)。
这也是当初做流水线的主要理由之一。

草图:`tools/crawler/` → 拉 match id → 拉 match detail → 落 sqlite → 聚合成
`draft-data` 已有的 `DraftStats` 结构 → 复用同一条发布流水线。
引擎侧不需要改,格式已经是对的。

### 3. 回测(等第 2 项有数据再做)

已经刻意推迟。在 op.gg 数据上做回测只能测校准(ECE)和消融,测不出"打赢 DraftGap 的准确率"
—— 因为双方用的是同样稀薄的数据。HuggingFace 那个 `match_v5.json` 是 1.3 GB 且补丁滞后。

对照基准:

|            | top-1  | log loss | ECE    |
| ---------- | ------ | -------- | ------ |
| DraftGap   | 54.66% | 0.6869   | 0.0199 |
| LoLDraftAI | 55.88% | 0.6829   | 0.0088 |

**ECE 比准确率重要**:准确率天花板约 57%,可提升空间只有 1-2pp;而现有工具的置信度普遍
与实际结果不相关,那才是能打赢的地方。

### 4. 移除 `src/main/shards/in-game-send/`

上游用 `akari-input-win64` 向游戏进程模拟键盘输入,是全仓唯一接近"游戏内自动化"的部分,
计划移除(`CLAUDE.md` §3 红线)。

**已经试过一次,回滚了**:删掉会级联影响约 20 个文件。要带 typecheck 逐个改干净,
在 Windows 上做(那里 typecheck 和构建都是完整的)。不是急事,但别忘了。

### 5. UI 重做

按最初的决定放在最后。参照 Seraphine 的 Fluent 观感,用 Vue 重新实现 —— **不碰它的代码**
(GPLv3 且禁商用,上游已删库),只参考观感。

---

## 交接备忘

- 所有 commit 已推到 `github.com/r04943083/LeagueSol`,作者全部是 `Yihong Lu <willu.star@gmail.com>`。
  推之前跑一次 `CLAUDE.md` §1 里那条自检命令。
- `upstream` remote 指向 LeagueAkari,方便 cherry-pick 上游修复。副作用:`gh` 会猜错默认仓库,
  新克隆后先 `gh repo set-default r04943083/LeagueSol`。
- `src/shared/shards/akari-api/types.ts` 里的 base URL 被刻意指向 `*.invalid`。
  上游那两个 URL 指着**它自己的**服务:接回去会拉到上游的功能开关和公告,
  还会提示用户把 LeagueSol "更新"成 League Akari。有自己的服务之前别动它。
- 引擎的纯净性是硬约束:`src/shared/draft-engine/` 不 import Electron、不 import axios、不读文件。
