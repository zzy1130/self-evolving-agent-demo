# Skill v5：修复 text_month_en

> 版本：v5 ｜ 日期：2026-10-14 ｜ 状态：候选
>
> 触发：飞轮诊断发现 train 在 `text_month_en` 类别系统性失败。
> 本文件由飞轮策展人自动生成；生产环境中此处应为 LLM 生成的 Diff 式补丁。

## 规则：英文月份（Oct 14, 2026 / 14 Oct 2026）

```rule
def parse(s):
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
    return None
```
