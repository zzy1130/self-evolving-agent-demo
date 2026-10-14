// 模型后端抽象：ChatModel.complete(system, user) -> 文本。
// PiChatModel：真正走 Pi SDK（pi-agent-core 的 Agent + pi-ai 的统一模型层）。
// MockChatModel：确定性脚本模拟，用于零成本验证飞轮机制本身。

import { Agent } from "@earendil-works/pi-agent-core";
import {
  contentText,
  type Api,
  type Model,
  type SimpleStreamOptions,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { CATEGORIES, detectCategory, referenceParse } from "./categories.js";

export interface ChatModel {
  complete(system: string, user: string): Promise<string>;
}

export function selectBackend(): "mock" | "pi" {
  return process.env["MOCK"] === "1" ? "mock" : "pi";
}

// ---------------------------------------------------------------------------
// 真实后端：Pi SDK
// ---------------------------------------------------------------------------

const DEFAULT_PI_MODEL = "anthropic/claude-haiku-4-5"; // pi-ai catalog 已验证的便宜模型

export class PiChatModel implements ChatModel {
  private models = builtinModels();
  private modelId = process.env["PI_MODEL"] ?? DEFAULT_PI_MODEL;

  constructor() {
    // fail-fast：没有 key 就直接报错，不发起任何网络调用
    const hasKey = Object.keys(process.env).some(
      (k) => /(_API_KEY|_AUTH_TOKEN)$/.test(k) && (process.env[k] ?? "").trim() !== "",
    );
    if (!hasKey) {
      throw new Error(
        [
          "未检测到任何 API Key 环境变量，无法调用真实模型。",
          "请先设置 pi-ai 支持的 Key，例如：",
          "  export ANTHROPIC_API_KEY=...   # Anthropic",
          "  export OPENAI_API_KEY=...      # OpenAI",
          "再用 PI_MODEL 指定模型（格式 provider/model-id，默认 " + DEFAULT_PI_MODEL + "）：",
          '  export PI_MODEL="deepseek/deepseek-flash"',
          "想零成本验证飞轮机制请用：npm run flywheel:mock",
        ].join("\n"),
      );
    }
  }

  async complete(system: string, user: string): Promise<string> {
    const slash = this.modelId.indexOf("/");
    if (slash < 0) {
      throw new Error(
        `PI_MODEL 格式应为 provider/model-id，例如 "anthropic/claude-haiku-4-5"，当前：${this.modelId}`,
      );
    }
    const provider = this.modelId.slice(0, slash);
    const id = this.modelId.slice(slash + 1);
    const model = this.models.getModel(provider, id);
    if (!model) {
      throw new Error(`在 pi-ai 的模型目录里找不到 ${this.modelId}，请检查 PI_MODEL。`);
    }

    // Agent 的 streamFn：把 pi-ai 的 streamSimple 接进来
    const streamFn = (
      m: Model<Api>,
      context: TranscriptContext,
      options?: SimpleStreamOptions,
    ) => this.models.streamSimple(m, context, options);

    // 每个 complete() 构造一个全新的 pi-agent-core Agent：
    // system prompt = 当前版本的 skill，user 消息 = 待转换的日期
    const agent = new Agent({
      initialState: { systemPrompt: system, model },
      streamFn,
    });
    await agent.prompt(user);
    await agent.waitForIdle();

    const last = [...agent.state.messages]
      .reverse()
      .find((m) => m.role === "assistant");
    if (!last || last.role !== "assistant") return "";
    return contentText(last.content);
  }
}

// ---------------------------------------------------------------------------
// Mock 后端：确定性模拟（零成本验证飞轮机制）
// ---------------------------------------------------------------------------

/**
 * 模拟"能力随 skill 成长"的 LLM：
 * skill 文本里出现某类别的 marker 词，就答对该类别；否则返回一个"自信但错误"的答案
 * （交换月和日，模拟真实 LLM 在规则缺失时的典型犯错方式）。
 */
export class MockChatModel implements ChatModel {
  async complete(system: string, user: string): Promise<string> {
    const s = user.trim();
    const category = detectCategory(s);
    const correct = referenceParse(s);
    if (system.includes(CATEGORIES[category].marker)) {
      return correct;
    }
    return swapMonthDay(correct);
  }
}

function swapMonthDay(yyyymmdd: string): string {
  const m = yyyymmdd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return `${m[1]}-${m[3]}-${m[2]}`;
}
