// Curator（技能改进器）：评测→记忆的关键一跃。
// 输入当前 skill + 失败样例，输出修订后的完整 skill。
// - mock 模式：确定性规则改进（找到最差类别，追加其教学文本），
//   对应生产环境里"LLM 生成候选 Skill"的占位；
// - 真实模式：让 LLM（同一个 PiChatModel）重写完整 skill，
//   从 ```skill 代码块中解析，解析失败则回退为全文。

import { CATEGORIES, type Category } from "./categories.js";
import { MockChatModel, type ChatModel } from "./model.js";
import type { Failure } from "./eval.js";

export interface SkillProposal {
  skill: string;
  note: string;
  category: Category;
}

/** 归因：按类别统计 train 失败数，取最差的一类。 */
export function diagnose(failures: Failure[]): Category {
  const counts = new Map<Category, number>();
  for (const f of failures) counts.set(f.category, (counts.get(f.category) ?? 0) + 1);
  const worst = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!worst) throw new Error("没有失败样例，无法归因");
  return worst[0];
}

export async function improveSkill(
  model: ChatModel,
  currentSkill: string,
  failures: Failure[],
): Promise<SkillProposal> {
  const category = diagnose(failures);
  const info = CATEGORIES[category];

  if (model instanceof MockChatModel) {
    const skill = `${currentSkill.trim()}\n\n## 新增：${info.marker}\n${info.instruction}\n`;
    return { skill, note: `修复类别：${category}（mock 确定性改进）`, category };
  }

  const examples = failures
    .slice(0, 8)
    .map(
      (f) =>
        `- 输入：${f.input}\n  模型输出：${f.got || "(空)"}\n  期望输出：${f.expected}（类别：${f.category}）`,
    )
    .join("\n");

  const coachSystem =
    "你是一位 Agent 技能教练，擅长根据失败样例改进 system prompt。只输出技能本身，不要解释方法论。";
  const coachUser = [
    "请改进下面的日期标准化技能（system prompt）。",
    "",
    "当前技能全文：",
    "---",
    currentSkill.trim(),
    "---",
    "",
    "它在以下用例上失败了（输入 / 模型输出 / 期望）：",
    examples,
    "",
    "要求：",
    "1. 保留原有规则，只增改与失败类别相关的内容；",
    "2. 针对失败类别给出明确、可执行的解析规则，带 1 个示例；",
    "3. 规则用中文写，示例保留原文；",
    "4. 把修订后的完整技能放在 ```skill … ``` 代码块中，块外最多附一句话说明。",
  ].join("\n");

  const reply = await model.complete(coachSystem, coachUser);
  const m = reply.match(/```skill\n([\s\S]*?)```/);
  const skill = (m ? m[1] : reply).trim();
  return { skill, note: `修复类别：${category}（LLM 重写）`, category };
}
