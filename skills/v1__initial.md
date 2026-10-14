# Skill v1：日期格式标准化（初始版）

> 版本：v1 ｜ 日期：2026-10-14 ｜ 状态：基线
>
> 已知局限（诚实记录）：只处理 ISO（`YYYY-MM-DD`）和斜杠年月日
> （`YYYY/MM/DD`）两种格式；中文、点分隔、英文月份、歧义斜杠日期
> 均无法处理——这些失败将由飞轮后续版本修复。

## 规则 1：ISO 直通

```rule
def parse(s):
    m = re.fullmatch(r"\s*(\d{4}-\d{2}-\d{2})\s*", s)
    if m:
        return m.group(1)
    return None
```

## 规则 2：斜杠年月日（YYYY/MM/DD，允许不补零）

```rule
def parse(s):
    m = re.fullmatch(r"\s*(\d{4})/(\d{1,2})/(\d{1,2})\s*", s)
    if m:
        y, mo, d = m.groups()
        return f"{y}-{int(mo):02d}-{int(d):02d}"
    return None
```
