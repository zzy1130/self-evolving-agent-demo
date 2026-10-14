// 日期类别体系：评测分组、mock 能力的开关、curator 教学文本都以此为唯一事实来源。
// 注意：marker 词是 MockChatModel 判断"技能是否掌握某类别"的唯一依据，
// 写 skill 文本时必须精确使用这些词，不能在"已知局限"等位置误用。

export type Category =
  | "iso"
  | "slash_ymd"
  | "slash_dmy"
  | "chinese"
  | "dot"
  | "text_month_en";

export interface CategoryInfo {
  /** skill 文本中出现该词，即视为掌握此类别 */
  marker: string;
  /** curator 追加给技能的教学文本 */
  instruction: string;
}

export const CATEGORIES: Record<Category, CategoryInfo> = {
  iso: {
    marker: "ISO日期",
    instruction: "ISO日期，如 2026-10-14：已经是标准格式，直接保留。",
  },
  slash_ymd: {
    marker: "斜杠年月日",
    instruction: "斜杠年月日，如 2026/10/14：按 年/月/日 顺序解析，月日补零。",
  },
  slash_dmy: {
    marker: "日月倒置",
    instruction:
      "日月倒置的斜杠写法：若第一段数字>12，则为 日/月/年，如 14/10/2026→2026-10-14；" +
      "若第二段数字>12，则为 月/日/年，如 10/14/2026→2026-10-14。",
  },
  chinese: {
    marker: "中文年月日",
    instruction:
      "中文年月日，如 2026年10月14日：按 年-月-日 顺序提取数字，月和日补足两位。",
  },
  dot: {
    marker: "点分隔日期",
    instruction: "点分隔日期，如 2026.10.14：按 年.月.日 顺序解析，月日补零。",
  },
  text_month_en: {
    marker: "英文月份名",
    instruction:
      "英文月份名，如 Oct 14, 2026 或 14 Oct 2026：英文月份转为数字" +
      "（Jan=1, Feb=2, Mar=3, Apr=4, May=5, Jun=6, Jul=7, Aug=8, Sep=9, Oct=10, Nov=11, Dec=12），" +
      "注意两种语序，月日补零。",
  },
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n: number | string) => String(n).padStart(2, "0");

/** 识别输入属于哪个类别（评测集受控，不支持的类型直接抛错）。 */
export function detectCategory(input: string): Category {
  const s = input.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return "iso";
  if (/年|月|日/.test(s)) return "chinese";
  if (/^\d{4}\.\d{1,2}\.\d{1,2}$/.test(s)) return "dot";
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(s)) return "slash_ymd";
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return "slash_dmy";
  if (/[a-zA-Z]{3,}/.test(s)) return "text_month_en";
  throw new Error(`无法识别的日期类别：${s}`);
}

/** 参考解析器：给出正确答案。mock 用它生成"答对/答错"的输出。 */
export function referenceParse(input: string): string {
  const s = input.trim();
  const cat = detectCategory(s);
  switch (cat) {
    case "iso":
      return s;
    case "slash_ymd": {
      const [y, m, d] = s.split("/");
      return `${y}-${pad(m)}-${pad(d)}`;
    }
    case "slash_dmy": {
      const [a, b, y] = s.split("/").map(Number);
      // 第一段>12 必为"日"；否则看第二段>12 则为"月/日"，否则默认"日/月"
      const day = a > 12 ? a : b > 12 ? b : a;
      const month = a > 12 ? b : b > 12 ? a : b;
      return `${y}-${pad(month)}-${pad(day)}`;
    }
    case "chinese": {
      const m = s.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
      if (!m) throw new Error(`解析失败：${s}`);
      return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    }
    case "dot": {
      const [y, m, d] = s.split(".");
      return `${y}-${pad(m)}-${pad(d)}`;
    }
    case "text_month_en": {
      let m = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})$/);
      if (m) {
        const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
        if (!mo) throw new Error(`未知月份：${s}`);
        return `${m[3]}-${pad(mo)}-${pad(m[2])}`;
      }
      m = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
      if (m) {
        const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
        if (!mo) throw new Error(`未知月份：${s}`);
        return `${m[3]}-${pad(mo)}-${pad(m[1])}`;
      }
      throw new Error(`解析失败：${s}`);
    }
  }
}
