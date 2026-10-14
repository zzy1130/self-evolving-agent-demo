"""极简日期标准化 Agent。

设计原则：Agent 本体保持"笨"——只负责按顺序调度规则，
所有知识都沉淀在 skills/ 目录的规则文件里（Markdown + ```rule 代码块）。

每个 ```rule 代码块必须定义一个函数：
    def parse(s: str) -> str | None
输入原始日期字符串，返回 YYYY-MM-DD；处理不了返回 None。
Agent 按文件名顺序加载 skills/*.md，逐条尝试，第一个非 None 结果获胜。
"""
import re
from pathlib import Path

SKILLS_DIR = Path(__file__).resolve().parent.parent / "skills"
RULE_RE = re.compile(r"```rule\n(.*?)```", re.DOTALL)


def load_rules(skills_dir=SKILLS_DIR):
    """按文件名顺序加载所有 skill 文件中的 parse 规则。

    返回 [(skill 文件名, parse 函数), ...]。
    每个代码块在独立命名空间中执行，互不干扰。
    """
    rules = []
    for path in sorted(skills_dir.glob("*.md")):
        text = path.read_text(encoding="utf-8")
        for block in RULE_RE.findall(text):
            ns = {}
            exec(compile(block, str(path), "exec"), {"re": re}, ns)
            fn = ns.get("parse")
            if callable(fn):
                rules.append((path.name, fn))
    return rules


class Agent:
    def __init__(self, skills_dir=SKILLS_DIR):
        self.rules = load_rules(skills_dir)

    def normalize(self, s):
        """返回标准化后的 YYYY-MM-DD；没有任何规则能处理时返回 None。"""
        for _name, parse in self.rules:
            try:
                out = parse(s)
            except Exception:
                continue  # 单条规则崩了不影响整体
            if out:
                return out
        return None

    def rule_count(self):
        return len(self.rules)
