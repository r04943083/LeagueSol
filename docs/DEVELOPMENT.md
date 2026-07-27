# 开发环境

两套环境,分工明确:

|                                    | Linux / WSL / CI                | Windows(真机 + 客户端) |
| ---------------------------------- | ------------------------------- | ---------------------- |
| `src/shared/draft-engine` 单测     | ✅                              | ✅                     |
| `src/shared/draft-data` 实打 op.gg | ✅                              | ✅                     |
| `yarn advise` CLI                  | ✅                              | ✅                     |
| 渲染层组件测试(happy-dom)          | ✅                              | ✅                     |
| `yarn lcu-replay` + `yarn dev`     | ⚠️ 需要能起 Electron 的图形环境 | ✅                     |
| 真实客户端、`yarn lcu-record`      | ❌                              | ✅                     |
| 原生模块重编译、`yarn build:win`   | ❌                              | ✅                     |

**Docker / VM 这条路是死的**:Vanguard 是内核态驱动,容器里加载不了,Riot 也主动封虚拟机。
客户端相关的东西只能在真实 Windows 上跑 —— 这正是 `tools/lcu-record.ts` /
`tools/lcu-replay.ts` 存在的原因:在 Windows 上录一次,之后在任何机器上回放。

---

## Windows 首次设置

```powershell
# Node 22+ 和 Yarn 4(仓库自带 .yarn/releases,corepack 会用它)
corepack enable

git clone https://github.com/r04943083/LeagueSol.git C:\dev\LeagueSol
cd C:\dev\LeagueSol
yarn install
```

**放在 Windows 原生盘上,不要放在 `\\wsl$\...` 下。** node-gyp 和 electron-builder 在
9P 文件系统上会慢到不可用,原生模块也编不过。

`yarn install` 之后确认能跑:

```powershell
yarn test          # 应该全绿
yarn typecheck     # node + web 两个 project
```

### 原生模块

`native/win32-x64/`(`akari-tools-win64`)是 C++ 附加模块,负责读
`LeagueClientUx.exe` 的命令行拿 `--app-port` / `--remoting-auth-token`。仓库里已带预编译产物,
一般不用管。要重编译:

```powershell
yarn build:native:win
```

需要 **Visual Studio Build Tools**(含 "Desktop development with C++" 工作负载)和
**Python 3**。这是唯一一处 Linux 上完全做不了的构建。

### 跑起来

```powershell
yarn dev           # Electron + 真实客户端
yarn build:win     # 出安装包
```

---

## LCU 录制 / 回放

这是让"改选人逻辑不必每次真排一局"成立的东西,也是让非 Windows 环境能端到端测的唯一途径。

**在 Windows 上录一次**(客户端要开着,进一场自定义房的选人阶段):

```powershell
yarn lcu-record --out fixtures/champ-select-real.json --description "solo queue, blue side, support"
# 打完选人,Ctrl+C 停止;会再抓一次快照然后写文件
```

录制器从客户端 lockfile 读凭证(`C:\Riot Games\League of Legends\lockfile`),
不需要原生模块、不需要管理员权限 —— 跟应用本体的做法不同,对一次性工具这是对的取舍。
路径不对就传 `--lockfile <path>`,或者直接 `--port` / `--token`。

**在任何地方回放**:

```bash
yarn lcu-replay fixtures/champ-select-real.json
# 另一个终端
LEAGUESOL_LCU_ENDPOINT=http://127.0.0.1:8777 yarn dev
```

`--speed 4` 加速,`--loop` 循环(手动戳 UI 时有用)。

fixture 是可读 JSON,**故意的**:它应该被提交、被手改,用来构造真实对局里很难凑出来的情况
——诡异的 pick 顺序、没人玩的英雄、没分配位置的队友。

几个已经踩过的点:

- 事件按录制时的时间戳回放,不是一次性推完。选人是个序列,建议本来就该随 pick 落地而变;
  一次性推完永远测不到这个。
- 同一个 endpoint 录到多次时**取最后一次**。录制通常在进选人之前就开始了,所以
  `/lol-champ-select/v1/session` 的第一次抓取是 404;回放那个会让每个 fixture 看起来都是空的。
- 回放走明文 HTTP,不用生成证书。`LEAGUESOL_LCU_ENDPOINT` 带 scheme 就是为了这个;
  值解析不了会被忽略而不是致命 —— 一个手滑的环境变量不该让应用连不上真实客户端。

---

## 数据与引擎

```bash
yarn advise --allies Lulu,Jinx --enemies Ahri,Leona --role jungle   # 看推荐与逐项拆解
yarn refresh-stats                                                   # 本地组装一份数据集(~680 请求 / ~6 分钟)
yarn publish-datasets                                                # CI 用,发布到 rolling release
```

正常情况下**应用不组装数据**:GitHub Actions 每周一/四组装一次发到
[`datasets` rolling release](https://github.com/r04943083/LeagueSol/releases/tag/datasets),
应用只下一个 manifest 加一个 ~124 KB 的 gzip 文件。原因写在 README 里 ——
每台机器各自组装的话,一千个用户就是每补丁 ~68 万请求打在一个免费服务上。

手动触发一次发布:

```bash
gh workflow run datasets.yml
```

> ⚠️ 仓库里有 `upstream` remote 指向 LeagueAkari,`gh` 会因此把默认仓库猜错并对着别人的仓库
> 发请求(会 404)。新克隆之后先跑一次:
>
> ```bash
> gh repo set-default r04943083/LeagueSol
> ```

---

## 测试

```bash
yarn test                        # 全量
yarn vitest run src/shared/draft-engine
LEAGUESOL_LIVE_TESTS=0 yarn test # 跳过打网络的
```

- **引擎是纯函数**,零 I/O、零 Electron 依赖 —— 这是它能在没有 Windows、没有客户端的环境下
  被完整测试的前提,别为了图方便破坏它。
- 部分 `draft-data` 测试**真打 op.gg 和 Data Dragon**,用来在对方改 schema 时立刻炸掉。
  离线时用 `LEAGUESOL_LIVE_TESTS=0` 跳过。
- 组件测试用 happy-dom,按文件声明:`// @vitest-environment happy-dom`。
  其余测试留在更快的 node 环境。
- 代理后面要设 `https_proxy`。Node 的 `fetch` 不像 curl/axios 会自己读环境变量,
  `scripts/vitest-setup.ts` 里用 undici 的 `ProxyAgent` 接上了。

已知的环境性失败:`src/main/shards/keyboard-shortcuts/index.test.ts` 需要真实 Electron
二进制,在下不了它的无头 Linux 上会失败。**在 Windows 上应该是过的** —— 换过去之后确认一下。
