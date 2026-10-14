// Worker Agent：拿 skill 当 system prompt 调模型做日期标准化，
// 再从回复里提取第一个 YYYY-MM-DD。Agent 本体不含任何日期知识，
// 知识全部在 skill 文本里——这正是"记忆/Harness 层进化"的演示要点。

import type { ChatModel } from "./model.js";

const DATE_RE = /\d{4}-\d{2}-\d{2}/;

export async function normalizeDate(
  model: ChatModel,
  skillPrompt: string,
  input: string,
): Promise<string> {
  const reply = await model.complete(skillPrompt, input);
  const m = reply.match(DATE_RE);
  return m ? m[0] : "";
}
