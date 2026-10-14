import type { Activity, Lesson, Stroke } from '../shared/types';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export function assert(condition: unknown, message: string, status = 400): asserts condition {
  if (!condition) throw new HttpError(status, message);
}
export function record(value: unknown): Record<string, unknown> {
  assert(!!value && typeof value === 'object' && !Array.isArray(value), '資料必須是物件');
  return value as Record<string, unknown>;
}
export function str(value: unknown, name: string, max = 500, min = 0): string {
  assert(
    typeof value === 'string' && value.length >= min && value.length <= max,
    `${name}格式不正確`,
  );
  return value;
}
export function integer(value: unknown, min: number, max: number): number {
  assert(
    Number.isInteger(value) && Number(value) >= min && Number(value) <= max,
    `數值必須介於 ${min}–${max}`,
  );
  return Number(value);
}
export function identifier(value: unknown): string {
  const id = str(value, 'ID', 100, 1);
  assert(/^[a-zA-Z0-9_-]+$/.test(id), 'ID 只接受英數、底線和連字號');
  assert(!['__proto__', 'constructor', 'prototype'].includes(id), 'ID 為保留名稱');
  return id;
}
function texts(value: unknown, name: string, maxCount = 20): string[] {
  assert(Array.isArray(value) && value.length <= maxCount, `${name}必須是陣列`);
  return value.map((v) => str(v, name, 3000));
}
export function validateActivity(input: unknown): Activity {
  const a = record(input);
  assert(['single', 'multiple', 'scale', 'short'].includes(String(a.type)), '不支援的活動類型');
  const out: Activity = {
    id: identifier(a.id),
    type: a.type as Activity['type'],
    prompt: str(a.prompt, '題目', 3000, 1),
  };
  if (out.type === 'single' || out.type === 'multiple') {
    out.options = texts(a.options, '選項', 12);
    assert(out.options.length >= 2, '至少需要兩個選項');
    if (a.correct !== undefined) {
      assert(Array.isArray(a.correct), '答案必須為陣列');
      out.correct = [...new Set(a.correct.map((v) => integer(v, 0, out.options!.length - 1)))];
      assert(out.type !== 'single' || out.correct.length === 1, '單選標準答案應為一個');
    }
  }
  if (out.type === 'scale') {
    out.min = integer(a.min ?? 1, 0, 100);
    out.max = integer(a.max ?? 5, out.min + 1, 100);
    if (a.minLabel !== undefined) out.minLabel = str(a.minLabel, '量尺標籤', 100);
    if (a.maxLabel !== undefined) out.maxLabel = str(a.maxLabel, '量尺標籤', 100);
  }
  if (a.explanation !== undefined) out.explanation = str(a.explanation, '解析', 4000);
  out.sensitive = a.sensitive === true;
  out.aiAllowed = a.aiAllowed === true;
  return out;
}
export function validateLesson(input: unknown): Lesson {
  const l = record(input);
  assert(l.schemaVersion === 1, '不支援的課程版本');
  assert(
    Array.isArray(l.slides) && l.slides.length > 0 && l.slides.length <= 60,
    '課程需要 1–60 頁',
  );
  const slideIds = new Set<string>(),
    activityIds = new Set<string>();
  const out: Lesson = {
    schemaVersion: 1,
    id: identifier(l.id),
    title: str(l.title, '課程名稱', 200, 1),
    description: str(l.description ?? '', '描述', 3000),
    subject: str(l.subject ?? '', '科目', 100),
    duration: integer(l.duration ?? 45, 1, 600),
    objectives: texts(l.objectives ?? [], '學習目標'),
    slides: l.slides.map((input) => {
      const s = record(input),
        id = identifier(s.id);
      assert(!slideIds.has(id), '投影片 ID 不可重複');
      slideIds.add(id);
      const slide: Lesson['slides'][number] = {
        id,
        title: str(s.title, '投影片標題', 300, 1),
        body: str(s.body ?? '', '內文', 10000),
      };
      for (const field of ['eyebrow', 'notes', 'source', 'customHtml'] as const)
        if (s[field] !== undefined)
          slide[field] = str(s[field], field, field === 'customHtml' ? 40000 : 5000);
      if (s.bullets !== undefined) slide.bullets = texts(s.bullets, '重點');
      if (s.visual !== undefined) {
        assert(['balance', 'steps', 'cards', 'bars'].includes(String(s.visual)), '不支援的視覺化');
        slide.visual = s.visual as typeof slide.visual;
      }
      if (s.activity) {
        slide.activity = validateActivity(s.activity);
        assert(!activityIds.has(slide.activity.id), '活動 ID 不可重複');
        activityIds.add(slide.activity.id);
      }
      return slide;
    }),
    updatedAt: new Date().toISOString(),
  };
  return out;
}
export function validateAnswer(a: Activity, value: unknown): string | number | number[] {
  if (a.type === 'short') return str(str(value, '短答', 2000, 1).trim(), '短答', 2000, 1);
  if (a.type === 'scale') return integer(value, a.min!, a.max!);
  if (a.type === 'single') return integer(value, 0, a.options!.length - 1);
  assert(
    Array.isArray(value) && value.length > 0 && value.length <= a.options!.length,
    '請至少選一個答案',
  );
  return [...new Set(value.map((v) => integer(v, 0, a.options!.length - 1)))].sort((a, b) => a - b);
}
export function validateStrokes(value: unknown): Stroke[] {
  assert(Array.isArray(value) && value.length <= 100, '每頁最多 100 筆畫');
  return value.map((input) => {
    const s = record(input),
      color = str(s.color, '筆色', 20);
    assert(/^#[\da-f]{3,8}$/i.test(color), '筆色格式不正確');
    assert(typeof s.width === 'number' && s.width >= 0.1 && s.width <= 30, '筆寬格式不正確');
    assert(Array.isArray(s.points) && s.points.length <= 1000, '每筆最多 1000 點');
    return {
      id: identifier(s.id),
      color,
      width: s.width,
      points: s.points.map((input) => {
        const p = record(input);
        assert(
          typeof p.x === 'number' &&
            typeof p.y === 'number' &&
            Number.isFinite(p.x) &&
            Number.isFinite(p.y) &&
            p.x >= 0 &&
            p.x <= 1 &&
            p.y >= 0 &&
            p.y <= 1,
          '白板座標必須是 0–1',
        );
        return { x: p.x, y: p.y };
      }),
    };
  });
}
