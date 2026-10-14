#!/usr/bin/env python3
"""自进化飞轮演示：评测 → 记忆 → 落地 → 控制。

任务：日期格式标准化（多种输入 → YYYY-MM-DD）。

飞轮四齿轮与代码的映射：
  评测（信号）: evaluate() —— 在 train/val 上跑 Agent，输出准确率与分类型明细。
  记忆（积累）: skills/v{N}__{category}.md —— 经验沉淀为版本化的 Skill 文件。
  落地（工程化）: 门控 —— val 严格提升 + 零回归才接受；CHANGELOG 记录每次变更。
  控制（人机协作）: 每次接受候选前打印【人工确认点】，展示规则 diff 与门控标准。
      生产环境此处应阻塞等待人工确认；演示中打印后自动继续（见 README）。

运行：cd 项目根目录 && python3 flywheel/run.py
"""
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
from agent.agent import Agent  # noqa: E402

EVAL_FILE = PROJECT_ROOT / "eval" / "cases.jsonl"
SKILLS_DIR = PROJECT_ROOT / "skills"
REPORTS_DIR = PROJECT_ROOT / "reports"
CHANGELOG = PROJECT_ROOT / "CHANGELOG.md"
MAX_ITERS = 6

# ---------------------------------------------------------------------------
# 策展人规则模板
# 生产环境中，这一步由 LLM 根据诊断结论生成 Diff 式补丁；
# 演示中用确定性模板代替，保证可复现、零依赖。
# ---------------------------------------------------------------------------
CHINESE_RULE = r'''def parse(s):
    m = re.fullmatch(r"\s*(\d{4})年(\d{1,2})月(\d{1,2})日\s*", s)
    if m:
        y, mo, d = m.groups()
        return f"{y}-{int(mo):02d}-{int(d):02d}"
    return None'''

DOT_RULE = r'''def parse(s):
    parts = s.strip().split(".")
    if len(parts) == 3 and all(p.isdigit() for p in parts) and len(parts[0]) == 4:
        y, mo, d = parts
        return f"{y}-{int(mo):02d}-{int(d):02d}"
    return None'''

SLASH_DMY_RULE = r'''def parse(s):
    parts = s.strip().split("/")
    if len(parts) == 3 and all(p.isdigit() for p in parts) and len(parts[2]) == 4:
        a, b = int(parts[0]), int(parts[1])
        y = parts[2]
        if a > 12:  # 日在前：D/M/Y
            return f"{y}-{b:02d}-{a:02d}"
        if b > 12:  # 月在前：M/D/Y
            return f"{y}-{a:02d}-{b:02d}"
    return None'''

TEXT_MONTH_RULE = r'''def parse(s):
    months = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
              "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}
    t = s.strip()
    m = re.fullmatch(r"([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})", t)
    if m:
        mon, d, y = m.groups()
    else:
        m = re.fullmatch(r"(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})", t)
        if not m:
            return None
        d, mon, y = m.groups()
    mo = months.get(mon.lower()[:3])
    if mo:
        return f"{y}-{mo:02d}-{int(d):02d}"
    return None'''

SLASH_YMD_RULE = r'''def parse(s):
    m = re.fullmatch(r"\s*(\d{4})/(\d{1,2})/(\d{1,2})\s*", s)
    if m:
        y, mo, d = m.groups()
        return f"{y}-{int(mo):02d}-{int(d):02d}"
    return None'''

ISO_RULE = r'''def parse(s):
    m = re.fullmatch(r"\s*(\d{4}-\d{2}-\d{2})\s*", s)
    if m:
        return m.group(1)
    return None'''

CURATOR_RULES = {
    "chinese": ("中文年月日（2026年10月14日）", CHINESE_RULE),
    "dot": ("点分隔年月日（2026.10.14）", DOT_RULE),
    "slash_dmy": ("歧义斜杠日期（某一段>12 才无歧义）", SLASH_DMY_RULE),
    "text_month_en": ("英文月份（Oct 14, 2026 / 14 Oct 2026）", TEXT_MONTH_RULE),
    "slash_ymd": ("斜杠年月日（YYYY/MM/DD）", SLASH_YMD_RULE),
    "iso": ("ISO 直通（YYYY-MM-DD）", ISO_RULE),
}


def load_cases():
    rows = []
    for line in EVAL_FILE.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    train = [r for r in rows if r["split"] == "train"]
    val = [r for r in rows if r["split"] == "val"]
    return train, val


def evaluate(agent, cases):
    detail = []
    for c in cases:
        got = agent.normalize(c["input"])
        detail.append({"id": c["id"], "input": c["input"], "expected": c["expected"],
                       "category": c["category"], "got": got, "ok": got == c["expected"]})
    by_cat = {}
    for d in detail:
        b = by_cat.setdefault(d["category"], {"total": 0, "correct": 0})
        b["total"] += 1
        b["correct"] += 1 if d["ok"] else 0
    correct = sum(1 for d in detail if d["ok"])
    acc = correct / len(detail) if detail else 0.0
    return {"accuracy": acc, "correct": correct, "total": len(detail),
            "by_category": by_cat, "detail": detail}


def diagnose(train_eval):
    fails = {}
    for d in train_eval["detail"]:
        if not d["ok"]:
            fails[d["category"]] = fails.get(d["category"], 0) + 1
    if not fails:
        return None, {}
    worst = sorted(fails.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
    return worst, fails


def write_skill_file(version, category):
    desc, rule_src = CURATOR_RULES[category]
    path = SKILLS_DIR / ("v%d__%s.md" % (version, category))
    lines = [
        "# Skill v%d：修复 %s" % (version, category),
        "",
        "> 版本：v%d ｜ 日期：%s ｜ 状态：候选" % (version, datetime.now().date().isoformat()),
        ">",
        "> 触发：飞轮诊断发现 train 在 `%s` 类别系统性失败。" % category,
        "> 本文件由飞轮策展人自动生成；生产环境中此处应为 LLM 生成的 Diff 式补丁。",
        "",
        "## 规则：%s" % desc,
        "",
        "```rule",
        rule_src,
        "```",
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def fmt_pct(x):
    return "%.1f%%" % (x * 100)


def print_val_breakdown(val_eval):
    parts = []
    for c in sorted(val_eval["by_category"]):
        v = val_eval["by_category"][c]
        parts.append("%s %s" % (c, fmt_pct(v["correct"] / v["total"])))
    print("  val 分类型：" + " ｜ ".join(parts))


def summarize(ev):
    return {"accuracy": round(ev["accuracy"], 4), "correct": ev["correct"],
            "total": ev["total"],
            "by_category": {c: {"correct": v["correct"], "total": v["total"]}
                            for c, v in ev["by_category"].items()}}


def save_report(it, version, evals, fixed_category, gate, decision):
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    report = {
        "iteration": it,
        "version": version,
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "fixed_category": fixed_category,
        "gate": gate,
        "decision": decision,
        "train": summarize(evals["train"]),
        "val": summarize(evals["val"]),
        "val_failures": [
            {"id": d["id"], "input": d["input"], "expected": d["expected"], "got": d["got"]}
            for d in evals["val"]["detail"] if not d["ok"]
        ],
    }
    (REPORTS_DIR / ("iter_%d.json" % it)).write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


def append_changelog(version, category, base, cand_eval, prev_pass_n):
    if not CHANGELOG.exists():
        CHANGELOG.write_text("# 更新日志（由飞轮自动追加）\n", encoding="utf-8")
    with CHANGELOG.open("a", encoding="utf-8") as f:
        f.write("\n## v%d —— 修复 %s（%s）\n"
                % (version, category, datetime.now().isoformat(timespec="seconds")))
        f.write("- val 准确率：%s → %s\n"
                % (fmt_pct(base["val"]["accuracy"]), fmt_pct(cand_eval["val"]["accuracy"])))
        f.write("- train 准确率：%s → %s\n"
                % (fmt_pct(base["train"]["accuracy"]), fmt_pct(cand_eval["train"]["accuracy"])))
        f.write("- 回归检查：之前通过的 %d 个 val 用例全部仍通过 ✅\n" % prev_pass_n)


def main():
    # 演示可重复运行：每次从 v1 开始，清理上次生成的派生产物。
    for p in SKILLS_DIR.glob("v[2-9]*__*.md"):
        p.unlink()
    if REPORTS_DIR.exists():
        shutil.rmtree(REPORTS_DIR)
    REPORTS_DIR.mkdir(parents=True)
    if CHANGELOG.exists():
        CHANGELOG.unlink()

    train, val = load_cases()
    print("=" * 64)
    print("自进化飞轮演示：日期格式标准化（评测→记忆→落地→控制）")
    print("用例：train %d / val %d，共 6 个类别" % (len(train), len(val)))
    print("=" * 64)

    version = 1
    agent = Agent()
    base = {"train": evaluate(agent, train), "val": evaluate(agent, val)}
    save_report(0, version, base, None, None, "baseline")
    print("")
    print("[评测] v%d 基线：train %s（%d/%d），val %s（%d/%d）" % (
        version,
        fmt_pct(base["train"]["accuracy"]), base["train"]["correct"], base["train"]["total"],
        fmt_pct(base["val"]["accuracy"]), base["val"]["correct"], base["val"]["total"]))
    print_val_breakdown(base["val"])

    history = [(version, base["train"]["accuracy"], base["val"]["accuracy"], "-")]
    it = 0
    while it < MAX_ITERS:
        it += 1
        worst, fails = diagnose(base["train"])
        if worst is None:
            print("")
            print("[诊断] 第 %d 轮：train 已无失败，飞轮收敛。" % it)
            break
        fail_str = ", ".join("%s:%d" % kv for kv in sorted(fails.items()))
        print("")
        print("[诊断] 第 %d 轮：train 失败按类别 → %s；最差类别 = %s" % (it, fail_str, worst))

        cand_version = version + 1
        cand_path = write_skill_file(cand_version, worst)
        desc, rule_src = CURATOR_RULES[worst]
        print("[生成候选] 已写入 %s（规则：%s）" % (cand_path.name, desc))

        print("[人工确认点] 候选版本待审")
        print("  候选：v%d，修复类别：%s" % (cand_version, worst))
        print("  新增规则 diff（摘要）：")
        for line in rule_src.splitlines()[:6]:
            print("    " + line)
        print("    ...")
        print("  门控标准：val 准确率严格提升 AND 之前通过的 val 用例零回归")
        print("  （生产环境：此处阻塞等待人工确认；演示：打印后自动继续）")

        cand_agent = Agent()
        cand_eval = {"train": evaluate(cand_agent, train), "val": evaluate(cand_agent, val)}
        prev_pass = set(d["id"] for d in base["val"]["detail"] if d["ok"])
        new_pass = set(d["id"] for d in cand_eval["val"]["detail"] if d["ok"])
        regressions = sorted(prev_pass - new_pass)
        improved = cand_eval["val"]["accuracy"] > base["val"]["accuracy"]

        gate = {"improved": improved, "regressions": regressions,
                "prev_val_acc": round(base["val"]["accuracy"], 4)}
        accepted = improved and not regressions
        save_report(it, cand_version, cand_eval, worst, gate,
                    "accepted" if accepted else "rejected")

        if accepted:
            print("[门控] val %s → %s（严格提升 ✓），回归检查：之前通过的 %d 个 val 用例"
                  "全部仍通过 ✓ → 接受"
                  % (fmt_pct(base["val"]["accuracy"]),
                     fmt_pct(cand_eval["val"]["accuracy"]), len(prev_pass)))
            append_changelog(cand_version, worst, base, cand_eval, len(prev_pass))
            version = cand_version
            base = cand_eval
            history.append((version, base["train"]["accuracy"],
                            base["val"]["accuracy"], worst))
        else:
            reason = []
            if not improved:
                reason.append("val 未严格提升")
            if regressions:
                reason.append("出现回归：" + ",".join(regressions))
            print("[门控] 拒绝（%s），飞轮停止。" % "；".join(reason))
            cand_path.unlink()
            break
    else:
        print("")
        print("达到最大迭代数（%d），停止。" % MAX_ITERS)

    print("")
    print("=" * 64)
    print("飞轮运行总结")
    print("%-8s%-14s%-14s%s" % ("版本", "train 准确率", "val 准确率", "修复类别"))
    for v, ta, va, cat in history:
        print("%-8s%-14s%-14s%s" % ("v%d" % v, fmt_pct(ta), fmt_pct(va), cat))
    print("=" * 64)
    print("产物：reports/iter_*.json（每轮评测报告），CHANGELOG.md（版本日志）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
