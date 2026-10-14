import { test, expect, type Page, type Browser, type BrowserContext } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:8787';
const screenshots = resolve('artifacts/screenshots');
const contexts: BrowserContext[] = [];
const cleanup: { context: BrowserContext; type: 'sessions' | 'lessons'; id: string }[] = [];

async function surface(browser: Browser, width = 1440, height = 1000, touch = false) {
  const context = await browser.newContext({ baseURL, viewport: { width, height }, hasTouch: touch, deviceScaleFactor: 1 });
  contexts.push(context);
  const page = await context.newPage();
  return { context, page };
}
async function loginTeacher(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '教師示範', exact: true }).click();
  await expect(page.getByTestId('lesson-card').first()).toBeVisible();
  // A reusable local Wrangler process can retain an older demo seed across builds.
  // Refresh only this repository's fictional demo lesson, never a real classroom.
  const sample = JSON.parse(await readFile(resolve('content/demo.json'), 'utf8'));
  const refreshed = await page.request.put(`/api/lessons/${sample.id}`, { headers: { Origin: baseURL }, data: { lesson: sample } });
  expect(refreshed.ok(), await refreshed.text()).toBeTruthy();
}
async function start(page: Page, context: BrowserContext) {
  await page.getByTestId('lesson-card').filter({ hasText: '我的一天，如何更有節奏？' }).getByRole('button', { name: '開始上課', exact: true }).click();
  await page.locator('#start-form select').selectOption('demo-class');
  await page.locator('#start-form').getByRole('button', { name: '開始上課', exact: true }).click();
  await expect(page.getByTestId('session-slide')).toBeVisible();
  const id = page.url().split('/session/')[1];
  cleanup.push({ context, type: 'sessions', id });
  return id;
}
async function loginStudent(page: Page, seat = 1) {
  await page.goto('/#/student');
  await page.getByLabel('座號', { exact: true }).fill(String(seat));
  await page.getByLabel('識別碼', { exact: true }).fill(`DEMO${String(seat).padStart(2, '0')}`);
  await page.getByRole('button', { name: '學生示範', exact: true }).click();
  await expect(page.getByTestId('session-slide')).toBeVisible();
}
async function slide(page: Page, index: number) {
  await page.getByRole('button', { name: `第 ${index} 頁`, exact: true }).click();
}
async function openActivity(page: Page) {
  await page.getByRole('button', { name: '開放作答', exact: true }).click();
  await expect(page.getByRole('button', { name: '結束作答', exact: true })).toBeVisible();
}
async function noHorizontalOverflow(page: Page) {
  const size = await page.evaluate(() => ({ full: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(size.full).toBeLessThanOrEqual(size.viewport + 1);
  const stage = await page.getByTestId('session-slide').boundingBox();
  const panel = await page.locator('.interaction-panel').boundingBox();
  if (stage && panel) {
    const overlapping = stage.x < panel.x + panel.width - 1 && stage.x + stage.width > panel.x + 1
      && stage.y < panel.y + panel.height - 1 && stage.y + stage.height > panel.y + 1;
    expect(overlapping, 'Slide and answer panel must never overlap').toBe(false);
  }
}
async function touchTarget(page: Page, selector: string) {
  for (const element of await page.locator(selector).all()) {
    if (!await element.isVisible()) continue;
    const box = await element.boundingBox();
    expect(box?.width, `${selector}: minimum width`).toBeGreaterThanOrEqual(48);
    expect(box?.height, `${selector}: minimum height`).toBeGreaterThanOrEqual(48);
  }
}
async function shot(page: Page, name: string) {
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: resolve(screenshots, name), fullPage: true });
}
test.afterEach(async () => {
  for (const resource of cleanup.splice(0)) {
    await resource.context.request.delete(`/api/${resource.type}/${resource.id}`, { headers: { Origin: baseURL }, data: {} });
  }
  await Promise.all(contexts.splice(0).map(c => c.close()));
});

test('teacher and independent iPad student complete all activity formats and isolated HTML', async ({ browser }) => {
  test.setTimeout(90_000);
  const t = await surface(browser);
  const s = await surface(browser, 768, 1024, true);
  const pageErrors: string[] = [];
  t.page.on('pageerror', e => pageErrors.push(e.message));
  s.page.on('pageerror', e => pageErrors.push(e.message));
  await loginTeacher(t.page);
  const sid = await start(t.page, t.context);
  await loginStudent(s.page);
  await expect(s.page.getByTestId('session-slide')).toContainText('留一點空間');
  await slide(t.page, 2);
  await openActivity(t.page);
  await expect(s.page.getByTestId('poll-option-0')).toBeEnabled();
  await touchTarget(s.page, '.answer-option, [data-testid="submit-answer"]');
  await s.page.getByTestId('poll-option-0').tap();
  await s.page.getByTestId('submit-answer').tap();
  await expect(s.page.getByText('已儲存你的回答', { exact: true })).toBeVisible();
  await expect(t.page.locator('#answer-count')).toHaveText('1 / 40');
  await s.page.reload();
  await expect(s.page.getByText('已儲存你的回答', { exact: true })).toBeVisible();
  await expect(s.page.getByTestId('poll-option-0')).toHaveAttribute('aria-pressed', 'true');
  await t.page.getByRole('button', { name: '公布統計', exact: true }).click();
  await expect(s.page.getByText('全班回饋', { exact: true })).toBeVisible();
  for (const [width, height, label] of [[768, 1024, 'student-ipad-portrait'], [1024, 768, 'student-ipad-landscape'], [390, 844, 'student-phone']] as const) {
    await s.page.setViewportSize({ width, height });
    await noHorizontalOverflow(s.page);
    await shot(s.page, `${label}.png`);
  }
  await s.page.setViewportSize({ width: 768, height: 1024 });
  await t.page.getByRole('button', { name: '教師同步翻頁', exact: true }).click();
  await expect(s.page.getByRole('button', { name: '第 4 頁', exact: true })).toBeEnabled();
  await slide(s.page, 4);
  await expect(s.page.getByText('自主閱讀中', { exact: true })).toBeVisible();
  await expect(s.page.getByTestId('submit-answer')).toHaveCount(0);
  await s.page.getByRole('button', { name: '回到目前活動', exact: true }).tap();
  await expect(s.page.getByText('已儲存你的回答', { exact: true })).toBeVisible();
  await t.page.getByRole('button', { name: '學生自主瀏覽', exact: true }).click();
  await expect(s.page.getByRole('button', { name: '第 4 頁', exact: true })).toBeDisabled();
  await slide(t.page, 3);
  await openActivity(t.page);
  await expect(s.page.getByTestId('poll-option-3')).toBeEnabled();
  for (const option of [0, 1, 3]) await s.page.getByTestId(`poll-option-${option}`).tap();
  await s.page.getByTestId('submit-answer').tap();
  await expect(s.page.getByText('已儲存你的回答', { exact: true })).toBeVisible();
  await slide(t.page, 4);
  await openActivity(t.page);
  await s.page.getByRole('button', { name: '4', exact: true }).tap();
  await s.page.getByTestId('submit-answer').tap();
  await expect(s.page.getByText('已儲存你的回答', { exact: true })).toBeVisible();
  await slide(t.page, 5);
  await openActivity(t.page);
  await s.page.getByLabel('你的回答', { exact: true }).fill('QA_PRIVATE_REMARK：我建議先比較需要的時間，因為安排會更清楚。');
  await s.page.getByTestId('submit-answer').tap();
  await expect(t.page.locator('#aggregate')).toContainText('QA_PRIVATE_REMARK');
  await t.page.getByRole('button', { name: '大屏授課', exact: true }).click();
  await expect(t.page.locator('#aggregate')).not.toContainText('QA_PRIVATE_REMARK');
  await expect(t.page.locator('.teacher-notes')).toHaveCount(0);
  await t.page.waitForResponse(r => r.url().endsWith(`/api/sessions/${sid}`));
  await expect(t.page.locator('#aggregate')).not.toContainText('QA_PRIVATE_REMARK');
  await t.page.getByRole('button', { name: '標準授課', exact: true }).click();
  await slide(t.page, 6);
  await openActivity(t.page);
  const frame = s.page.frameLocator('#custom-activity');
  await expect(frame.getByRole('button', { name: '① 觀察', exact: true })).toBeEnabled();
  expect(await s.page.locator('#custom-activity').getAttribute('sandbox')).toBe('allow-scripts');
  await frame.getByRole('button', { name: '① 觀察', exact: true }).tap();
  await expect(s.page.getByText('已儲存你的回答', { exact: true })).toBeVisible();
  const view = await (await t.context.request.get(`/api/sessions/${sid}`)).json();
  expect(view.answers).toHaveLength(5);
  expect(view.answers.map((a: any) => a.value)).toEqual([0, [0, 1, 3], 4, 'QA_PRIVATE_REMARK：我建議先比較需要的時間，因為安排會更清楚。', 0]);
  expect(pageErrors).toEqual([]);
});

test('touch board persists normalized strokes, supports undo/redo and keeps drawing separate from slide navigation', async ({ browser }) => {
  const t = await surface(browser, 1440, 1000, true);
  await t.page.goto('/');
  await expect(t.page.getByRole('button', { name: '教師示範', exact: true })).toBeVisible();
  await shot(t.page, 'landing-desktop.png');
  await loginTeacher(t.page);
  await shot(t.page, 'teacher-workspace.png');
  const sid = await start(t.page, t.context);
  await t.page.getByRole('button', { name: '學生加入資訊', exact: true }).tap();
  await expect(t.page.getByTestId('join-qr')).toBeVisible();
  expect(await t.page.getByTestId('join-qr').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  const entry = new URL(await t.page.getByLabel('學生入口連結', { exact: true }).inputValue());
  expect(entry.searchParams.get('class')).toBe('DEMO801');
  expect(entry.hash).toBe('#/student');
  await t.page.getByRole('button', { name: '關閉對話框', exact: true }).tap();
  await t.page.getByRole('button', { name: '大屏授課', exact: true }).tap();
  await expect(t.page.locator('.big-screen')).toBeVisible();
  await touchTarget(t.page, '.teaching-toolbar button, .slide-navigation .btn');
  await t.page.getByTestId('tool-pen').tap();
  const canvas = t.page.getByTestId('whiteboard-canvas');
  expect(await canvas.evaluate(el => getComputedStyle(el).touchAction)).toBe('none');
  const bounds = (await canvas.boundingBox())!;
  const cdp = await t.context.newCDPSession(t.page);
  const points = [{ x: bounds.x + bounds.width * .2, y: bounds.y + bounds.height * .3 }, { x: bounds.x + bounds.width * .35, y: bounds.y + bounds.height * .45 }, { x: bounds.x + bounds.width * .55, y: bounds.y + bounds.height * .3 }];
  const saved = t.page.waitForResponse(r => r.url().endsWith('/whiteboard') && r.request().method() === 'PUT');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...points[0], id: 1 }] });
  for (const point of points.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect((await saved).ok()).toBe(true);
  const before = await (await t.context.request.get(`/api/sessions/${sid}`)).json();
  const stroke = before.whiteboard.welcome[0];
  expect(stroke.points.length).toBeGreaterThan(2);
  expect(stroke.points[0].x).toBeCloseTo(.2, 2);
  expect(stroke.points[0].y).toBeCloseTo(.3, 2);
  expect(before.session.slideIndex).toBe(0);
  const undoSaved = t.page.waitForResponse(r => r.url().endsWith('/whiteboard') && r.request().method() === 'PUT');
  await t.page.getByRole('button', { name: '復原', exact: true }).tap();
  await undoSaved;
  expect((await (await t.context.request.get(`/api/sessions/${sid}`)).json()).whiteboard.welcome).toHaveLength(0);
  const redoSaved = t.page.waitForResponse(r => r.url().endsWith('/whiteboard') && r.request().method() === 'PUT');
  await t.page.getByRole('button', { name: '重做', exact: true }).tap();
  await redoSaved;
  expect((await (await t.context.request.get(`/api/sessions/${sid}`)).json()).whiteboard.welcome).toEqual(before.whiteboard.welcome);
  await shot(t.page, 'teacher-large-screen.png');
  await t.page.setViewportSize({ width: 768, height: 1024 });
  await noHorizontalOverflow(t.page);
  await shot(t.page, 'teacher-tablet-portrait.png');
  await t.page.reload();
  await expect(t.page.getByTestId('whiteboard-canvas')).toBeVisible();
  const after = await (await t.context.request.get(`/api/sessions/${sid}`)).json();
  expect(after.whiteboard.welcome).toEqual(before.whiteboard.welcome);
  const pixels = await t.page.getByTestId('whiteboard-canvas').evaluate((element: HTMLCanvasElement) => {
    const data = element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data;
    let visible = 0; for (let i = 3; i < data.length; i += 4) if (data[i] > 0) visible++;
    return visible;
  });
  expect(pixels).toBeGreaterThan(50);
  await t.page.getByTestId('draw-seat').tap();
  await expect(t.page.locator('.draw-result')).toBeVisible();
  await t.page.getByTestId('buzz-open').tap();
  const s = await surface(browser, 768, 1024, true);
  await loginStudent(s.page, 2);
  await s.page.getByTestId('buzz-button').tap();
  await expect(t.page.locator('.buzz-panel')).toContainText('2');
  await expect(t.page.locator('.buzz-panel')).toContainText('搶答成功');
  await t.page.getByTestId('tool-laser').tap();
  await expect(t.page.getByTestId('tool-laser')).toHaveAttribute('aria-pressed', 'true');
  await t.page.getByTestId('tool-spotlight').tap();
  await expect(t.page.getByTestId('tool-spotlight')).toHaveAttribute('aria-pressed', 'true');
  await t.page.getByRole('button', { name: '全螢幕', exact: true }).tap();
  await expect.poll(() => t.page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await t.page.getByRole('button', { name: '全螢幕', exact: true }).tap();
  await expect.poll(() => t.page.evaluate(() => !!document.fullscreenElement)).toBe(false);
});

test('teacher imports, edits, saves and exports a reusable lesson, with mock AI clearly labelled', async ({ browser }) => {
  const t = await surface(browser);
  await loginTeacher(t.page);
  const sample = JSON.parse(await readFile(resolve('content/demo.json'), 'utf8'));
  sample.title = `匯入測試 ${Date.now()}`;
  const chooser = t.page.waitForEvent('filechooser');
  await t.page.getByTestId('import-lesson').click();
  await (await chooser).setFiles({ name: 'lesson.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(sample)) });
  const card = t.page.getByTestId('lesson-card').filter({ hasText: sample.title });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: '編輯教材' }).click();
  const id = t.page.url().split('/lesson/')[1];
  cleanup.push({ context: t.context, type: 'lessons', id });
  await t.page.getByLabel('課程名稱', { exact: true }).fill(`${sample.title}・已修訂`);
  await t.page.getByTestId('save-lesson').click();
  await expect(t.page.locator('#toast')).toContainText('教材已儲存');
  await t.page.reload();
  await expect(t.page.getByLabel('課程名稱', { exact: true })).toHaveValue(`${sample.title}・已修訂`);
  const downloaded = t.page.waitForEvent('download');
  await t.page.getByRole('button', { name: '匯出課程 JSON', exact: true }).click();
  const path = await (await downloaded).path();
  const exported = JSON.parse(await readFile(path!, 'utf8'));
  expect(exported.id).toBe(id);
  expect(exported.title).toBe(`${sample.title}・已修訂`);
  await t.page.getByRole('button', { name: 'AI 檢查課程邏輯', exact: true }).click();
  await expect(t.page.getByRole('dialog')).toContainText('模擬分析・未呼叫外部 API');
  await expect(t.page.getByRole('dialog')).toContainText('未呼叫 AI');
});

test('an offline student answer is retried once after connectivity returns', async ({ browser }) => {
  const t = await surface(browser);
  const s = await surface(browser, 1024, 768, true);
  await loginTeacher(t.page);
  const sid = await start(t.page, t.context);
  await loginStudent(s.page, 3);
  await slide(t.page, 2);
  await openActivity(t.page);
  await expect(s.page.getByTestId('poll-option-0')).toBeEnabled();
  await s.page.getByTestId('poll-option-0').tap();
  await s.context.setOffline(true);
  await s.page.getByTestId('submit-answer').tap();
  await expect(s.page.locator('#answer-status')).toContainText('待送出');
  await s.context.setOffline(false);
  await expect(s.page.getByText('已儲存你的回答', { exact: true })).toBeVisible();
  await expect(t.page.locator('#answer-count')).toHaveText('1 / 40');
  const view = await (await t.context.request.get(`/api/sessions/${sid}`)).json();
  expect(view.answers).toHaveLength(1);
  await s.page.reload();
  await expect(s.page.getByText('已儲存你的回答', { exact: true })).toBeVisible();
});
