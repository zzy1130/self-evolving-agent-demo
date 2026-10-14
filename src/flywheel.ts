// 自进化飞轮主循环：评测 → 诊断归因 → 技能改进 → 门控 → 版本化。
// 方法论与 v1 (archive/v1-python) 一致，执行层换成真正的 Pi Agent。

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeDate } from "./agent.js";
import { diagnose, improveSkill } from "./curator.js";
import { evaluate, loadCases, type EvalReport } from "./eval.js";
import { MockChatModel, PiChatModel, selectBackend, type ChatModel } from "./model.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = join(ROOT, "skills");
const REPORTS_DIR = join(ROOT, "reports");
const MAX_ITERS = 5;

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function skillPath(version: number, category?: string): string {
  return version === 1
    ? join(SKILLS_DIR, "v1__initial.md")
    : join(SKILLS_DIR, `v${version}__${category}.md`);
}

function writeReport(iter: number, version: number, train: EvalReport, val: EvalReport): void {
  mkdirSync(REPORTS_DIR, { recursive: true });
  writeFileSync(
    join(REPORTS_DIR, `iter_${iter}.json`),
    JSON.stringify({ iter, version, train, val }, null, 2) + "\n",
  );
}

/** 每次运行清理上次的派生产物，保证演示可重复。 */
function cleanDerivedArtifacts(): void {
  for (const f of readdirSync(SKILLS_DIR)) {
    if (/^v[2-9]\d*__/.test(f)) rmSync(join(SKILLS_DIR, f));
  }
  mkdirSync(REPORTS_DIR, { recursive: true });
  for (const f of readdirSync(REPORTS_DIR)) rmSync(join(REPORTS_DIR, f));
}

async function main(): Promise<void> {
  const backend = selectBackend();
  console.log(`后端：${backend === "mock" ? "Mock（零成本，验证飞轮机制）" : "Pi 真实模型"}`);
  // 注意：PiChatModel 构造器内做 API Key fail-fast；mock 模式不走网络
  const model: ChatModel = backend === "mock" ? new MockChatModel() : new PiChatModel();

  cleanDerivedArtifacts();
  const cases = loadCases(join(ROOT, "eval", "cases.jsonl"));
  const changelog: string[] = [
    "# CHANGELOG",
    "",
    "飞轮每次接受一个新 skill 版本时追加一条记录。",
    "",
  ];

  let version = 1;
  let skill = readFileSync(skillPath(1), "utf-8");
  const rows: Array<{ version: number; train: number; val: number; fixed: string }> = [];

  for (let iter = 0; iter < MAX_ITERS; iter++) {
    // —— 评测：在 train 和 val 上跑当前 skill ——
    const train = await evaluate(cases, "train", (i) => normalizeDate(model, skill, i));
    const val = await evaluate(cases, "val", (i) => normalizeDate(model, skill, i));
    writeReport(iter, version, train, val);
    console.log(
      `[评测] 第 ${iter} 轮（skill v${version}）：train ${pct(train.accuracy)}，val ${pct(val.accuracy)}`,
    );

    // —— 收敛判断：train 无失败则停止 ——
    if (train.failures.length === 0) {
      rows.push({ version, train: train.accuracy, val: val.accuracy, fixed: "-" });
      console.log("[诊断] train 已无失败，飞轮收敛。");
      break;
    }

    // —— 诊断归因 + 生成候选 ——
    const category = diagnose(train.failures);
    console.log(`[诊断] 最差类别：${category}（train 失败 ${train.failures.filter((f) => f.category === category).length} 例）`);
    const proposal = await improveSkill(model, skill, train.failures);
    console.log(`[候选] v${version + 1}，${proposal.note}`);

    // —— 门控：val 严格提升 AND 之前通过的 val 用例零回归 ——
    const failedIds = new Set(val.failures.map((f) => f.id));
    const passedBefore = new Set(
      cases.filter((c) => c.split === "val" && !failedIds.has(c.id)).map((c) => c.id),
    );
    const valNew = await evaluate(cases, "val", (i) => normalizeDate(model, proposal.skill, i));
    const regressed = valNew.failures.filter((f) => passedBefore.has(f.id));
    console.log(
      `[门控] val ${pct(val.accuracy)} → ${pct(valNew.accuracy)}` +
        (valNew.accuracy > val.accuracy ? "（严格提升 ✓）" : "（未提升 ✗）") +
        `，回归检查：${regressed.length === 0 ? `之前通过的 ${passedBefore.size} 个 val 用例全部仍通过 ✓` : `${regressed.length} 个回归 ✗ → 拒绝`}`,
    );

    if (valNew.accuracy > val.accuracy && regressed.length === 0) {
      version += 1;
      skill = proposal.skill;
      writeFileSync(skillPath(version, category), skill);
      changelog.push(
        `## v${version}（${new Date().toISOString()}）`,
        `- 修复类别：${category}`,
        `- val：${pct(val.accuracy)} → ${pct(valNew.accuracy)}，零回归`,
        `- 备注：${proposal.note}`,
        "",
      );
      rows.push({ version: version - 1, train: train.accuracy, val: val.accuracy, fixed: category });
      console.log(`[落地] 接受 v${version}，已写入 ${skillPath(version, category)}`);
    } else {
      rows.push({ version, train: train.accuracy, val: val.accuracy, fixed: `${category}（被拒绝）` });
      console.log("[控制] 门控拒绝候选，飞轮停止。");
      break;
    }
  }

  writeFileSync(join(ROOT, "CHANGELOG.md"), changelog.join("\n"));

  console.log("\n===============================");
  console.log("飞轮运行总结");
  console.log("版本\t train\t val\t 修复类别");
  for (const r of rows) {
    console.log(`v${r.version}\t ${pct(r.train)}\t ${pct(r.val)}\t ${r.fixed}`);
  }
  console.log("===============================");
  console.log("产物：reports/iter_*.json（每轮评测报告），CHANGELOG.md（版本日志）");
}

main().catch((e) => {
  console.error("飞轮运行失败：", e instanceof Error ? e.message : e);
  process.exit(1);
});
