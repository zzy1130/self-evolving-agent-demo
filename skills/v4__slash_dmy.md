# Skill v4：修复 slash_dmy

> 版本：v4 ｜ 日期：2026-10-14 ｜ 状态：候选
>
> 触发：飞轮诊断发现 train 在 `slash_dmy` 类别系统性失败。
> 本文件由飞轮策展人自动生成；生产环境中此处应为 LLM 生成的 Diff 式补丁。

## 规则：歧义斜杠日期（某一段>12 才无歧义）

```rule
def parse(s):
    parts = s.strip().split("/")
    if len(parts) == 3 and all(p.isdigit() for p in parts) and len(parts[2]) == 4:
        a, b = int(parts[0]), int(parts[1])
        y = parts[2]
        if a > 12:  # 日在前：D/M/Y
            return f"{y}-{b:02d}-{a:02d}"
        if b > 12:  # 月在前：M/D/Y
            return f"{y}-{a:02d}-{b:02d}"
    return None
```
