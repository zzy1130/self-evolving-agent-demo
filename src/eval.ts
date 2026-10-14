// 评测：纯确定性检查器。LLM 只通过注入的 normalize 函数参与，
// 评分逻辑本身不含任何模型调用，保证"评测可信度高于系统复杂度"。

import { readFileSync } from "node:fs";
import { detectCategory, type Category } from "./categories.js";

export interface CaseItem {
  id: string;
  input: string;
  expected: string;
  split: "train" | "val";
  category: Category;
  difficulty: number;
}

export interface Failure {
  id: string;
  input: string;
  got: string;
  expected: string;
  category: Category;
}

export interface EvalReport {
  accuracy: number;
  total: number;
  correct: number;
  perCategory: Record<string, { total: number; correct: number }>;
  failures: Failure[];
}

export function loadCases(path: string): CaseItem[] {
  const cases = readFileSync(path, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as CaseItem);
  // 校验：类别必须可识别，避免评测集本身出错污染结论
  for (const c of cases) {
    const detected = detectCategory(c.input);
    if (detected !== c.category) {
      throw new Error(`用例 ${c.id} 标注类别 ${c.category} 与检测结果 ${detected} 不一致`);
    }
  }
  return cases;
}

export async function evaluate(
  cases: CaseItem[],
  split: "train" | "val",
  normalize: (input: string) => Promise<string>,
): Promise<EvalReport> {
  const subset = cases.filter((c) => c.split === split);
  const failures: Failure[] = [];
  const perCategory: Record<string, { total: number; correct: number }> = {};
  let correct = 0;
  // 顺序执行：真实模式下避免并发打爆 API；mock 模式也保持确定性
  for (const c of subset) {
    const got = await normalize(c.input);
    const ok = got === c.expected;
    if (ok) {
      correct++;
    } else {
      failures.push({ id: c.id, input: c.input, got, expected: c.expected, category: c.category });
    }
    const pc = (perCategory[c.category] ??= { total: 0, correct: 0 });
    pc.total++;
    if (ok) pc.correct++;
  }
  return {
    accuracy: subset.length ? correct / subset.length : 0,
    total: subset.length,
    correct,
    perCategory,
    failures,
  };
}
