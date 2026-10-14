# Skill v3：修复 dot

> 版本：v3 ｜ 日期：2026-10-14 ｜ 状态：候选
>
> 触发：飞轮诊断发现 train 在 `dot` 类别系统性失败。
> 本文件由飞轮策展人自动生成；生产环境中此处应为 LLM 生成的 Diff 式补丁。

## 规则：点分隔年月日（2026.10.14）

```rule
def parse(s):
    parts = s.strip().split(".")
    if len(parts) == 3 and all(p.isdigit() for p in parts) and len(parts[0]) == 4:
        y, mo, d = parts
        return f"{y}-{int(mo):02d}-{int(d):02d}"
    return None
```
