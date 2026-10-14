# Skill v2：修复 chinese

> 版本：v2 ｜ 日期：2026-10-14 ｜ 状态：候选
>
> 触发：飞轮诊断发现 train 在 `chinese` 类别系统性失败。
> 本文件由飞轮策展人自动生成；生产环境中此处应为 LLM 生成的 Diff 式补丁。

## 规则：中文年月日（2026年10月14日）

```rule
def parse(s):
    m = re.fullmatch(r"\s*(\d{4})年(\d{1,2})月(\d{1,2})日\s*", s)
    if m:
        y, mo, d = m.groups()
        return f"{y}-{int(mo):02d}-{int(d):02d}"
    return None
```
