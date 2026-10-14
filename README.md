# 自进化 Agent 演示 v2：评测 → 记忆 → 落地 → 控制

v1（见 `archive/v1-python/`）用 Python + 硬编码规则演示了飞轮**机制**；
v2 把执行层换成了真正的 AI Agent：Worker 和 Curator 都是跑在
Pi SDK（`@earendil-works/pi-ai` + `@earendil-works/pi-agent-core` v1.2.0）上的 LLM Agent，
飞轮每一次"诊断→改进"都经过真实模型的推理。

任务不变：日期格式标准化 → `YYYY-MM-DD`（与 v1 同题，方便对比）。

## v1 → v2 的变化

| | v1 | v2 |
|---|---|---|
| Worker | Python 硬编码规则函数 | `pi-agent-core` 的 `Agent`，system prompt = 当前 skill |
| Curator | Python 写死的"追加规则" | 真实模式下由 LLM 重写完整 skill；mock 模式用确定性规则占位 |
| 模型层 | 无 | `pi-ai` 统一多 provider（`builtinModels()` + `getModel()`） |
| 评测 | 48 条 | 24 条（省 token：LLM 调用按次计费） |
| 语言 | Python | TypeScript（Node 22+，零构建，`tsx` 直接跑） |

## 架构

```
                ┌─────────────────────────────────┐
评测（信号）     │  src/eval.ts：确定性检查器        │  train/val 双 split，
                │  准确率 + 分类型明细 + 失败样例    │  诊断只用 train
                └───────────────┬─────────────────┘
                                ▼
记忆（积累）     │  skills/v{N}__*.md：版本化 skill  │  Agent 的全部知识只活
                │  = Agent 的 system prompt        │  在这里，本体保持"笨"
                └───────────────┬─────────────────┘
                                ▼
落地（工程化）   │  门控：val 严格提升 + 零回归才接受  │  拒绝则停转
                │  CHANGELOG.md + reports/iter_*.json│
                └───────────────┬─────────────────┘
                                ▼
控制（人机协作） │  候选接受前打印规则摘要与门控标准    │  演示自动继续，
                │  （生产环境此处应人工确认）        │  生产环境需人审
                └─────────────────────────────────┘
        ▲                                               │
        │   src/curator.ts：归因到最差类别 → 生成候选 skill │
        └───────────────────────────────────────────────┘

Worker（src/agent.ts）和 Curator 共用同一个 ChatModel 后端（src/model.ts）。
```

## Pi SDK 映射表

| 角色 | Pi SDK 符号（全部对照 `/tmp/piapi` 的 `.d.ts` 核实，非编造） | 用途 |
|---|---|---|
| Agent 本体 | `pi-agent-core` 的 `Agent`（`AgentOptions.streamFn`） | 每个 `complete()` 构造一个新 Agent，system prompt = 当前 skill 版本 |
| 模型调用 | `Agent.prompt()` → `streamFn` → `pi-ai` 的 `models.streamSimple()` | provider 无关的一次性流式调用 |
| 模型解析 | `pi-ai/providers/all` 的 `builtinModels()` + `models.getModel(provider, id)` | `PI_MODEL` 格式 `provider/model-id`（如 `anthropic/claude-haiku-4-5`，id 来自 pi-ai 自带目录） |
| 文本提取 | `pi-ai` 的 `contentText()` | 从 `AssistantMessage` 提取纯文本回复 |
| 认证 | pi-ai 的环境变量约定 | 无 key 直接 fail-fast，不发起任何网络调用 |

## 运行方法

```bash
npm install
npm run typecheck        # 类型检查
npm run flywheel:mock    # 零成本：一键跑通，验证飞轮机制
```

Mock 模式实测轨迹（可复现）：

| 版本 | train | val | 修复类别 |
|---|---|---|---|
| v1 | 50.0% | 50.0% | 中文年月日 |
| v2 | 66.7% | 66.7% | 日月倒置 |
| v3 | 83.3% | 83.3% | 英文月份名 |
| v4 | 100.0% | 100.0% | 收敛 |

真实模型模式：

```bash
export ANTHROPIC_API_KEY=...          # 或 OPENAI_API_KEY 等 pi-ai 支持的 Key
export PI_MODEL="anthropic/claude-haiku-4-5"   # 可选，默认即此（便宜）
npm run flywheel
```

- 调用量预估：每轮 train+val 共 24 次短调用 + curator 1 次；约 4 轮 ≈ 100 次调用，
  用 haiku 级别模型约几美分。
- 无 Key 时直接报错退出（中文提示），不会发起任何网络调用。

### 真实模式实测（DeepSeek V4.1 Flash，2026-10-14）

| 版本 | train | val | 说明 |
|---|---|---|---|
| v1 | 58.3% | 66.7% | 基线：朴素 prompt，真实 LLM 零样本已能做对一部分 |
| v2 | 91.7% | 100.0% | LLM curator 重写 skill，修复中文日期类别，门控通过 |
| v3（候选） | — | 100.0% → 100.0% | 未带来 val 提升，**门控拒绝**，飞轮停止 |

注意 v3 这一行：curator 针对 train 剩下的 1 个 `slash_dmy` 失败重写了 skill，
但在独立 val 上没有提升——门控按规则拒绝了它。这正是"控制"齿轮的价值：
**飞轮不仅负责进步，也负责在没进步时停下来**。真实轨迹随模型与采样而异，
上表为单次运行记录，不保证复现相同数字。

## 诚实声明

1. **Mock 验证的是飞轮机制，不是模型能力**：`MockChatModel` 是"能力随 skill 文本
   精确开关"的脚本模拟，轨迹整齐好看；真实 LLM 的轨迹取决于模型本身，
   v1 的朴素 prompt 下真实模型可能起点更高、也可能在歧义项上反复横跳。
2. **评测集很小**：24 条、6 类，每类每 split 仅 2 条。100% 只在该集合上成立，
   不可外推为通用日期解析能力。
3. **Curator 在真实模式下是"LLM 教 LLM"**：它看到的是失败样例，不是梯度；
   门控（独立 val + 零回归）是防止"越改越错"的唯一防线，这正是文章强调的
   "评测可信度高于系统复杂度"。
4. 生产环境还缺：人工确认卡点、灰度发布、线上回流、Skill 冲突检测——
   方法论见腾讯技术工程原文《一篇讲透 Agent 自进化飞轮怎么搭》。
