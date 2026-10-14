import './styles.css';
import { api, download, escape as esc } from './api';
import { icon } from './icons';
import { Whiteboard, type Tool } from './board';
import type {
  AppConfig,
  User,
  Dashboard,
  Lesson,
  Slide,
  SessionView,
  Activity,
  Answer,
} from '../shared/types';
import demo from '../content/demo.json';
import QRCode from 'qrcode';

const app = document.querySelector<HTMLDivElement>('#app')!;
let config: AppConfig = { mode: 'demo', aiConfigured: false, version: '0.1.1' };
let user: User | null = null,
  dashboard: Dashboard | null = null,
  view: SessionView | null = null;
let board: Whiteboard | null = null,
  poll: ReturnType<typeof setInterval> | undefined;
let currentTool: Tool = 'cursor',
  color = '#dc795d',
  draft: string | number | number[] = [],
  studentSlide = 0;
let pollBusy = false,
  routeVersion = 0,
  lastSync = Date.now(),
  formBusy = false;
let currentRoute = '',
  modalReturnFocus: HTMLElement | null = null;
let touchTap: {
  el: HTMLElement;
  x: number;
  y: number;
  pointerId: number;
  handled: boolean;
  fallback: boolean;
  at: number;
} | null = null;
const pendingPrefix = 'healthkit.pending.';
const btn = (label: string, action: string, style = 'primary', glyph = '', attrs = '') =>
  `<button class="btn ${style}" data-action="${action}" ${attrs}>${glyph ? icon(glyph) : ''}<span>${label}</span></button>`;
const tag = (label: string, cls = '') => `<span class="tag ${cls}">${label}</span>`;
function toast(message: string, error = false) {
  const el = document.querySelector<HTMLElement>('#toast')!;
  el.textContent = message;
  el.className = `visible${error ? ' error' : ''}`;
  setTimeout(() => (el.className = ''), 4400);
}
function modal(title: string, body: string, wide = false) {
  modalReturnFocus = document.activeElement as HTMLElement;
  document.querySelector('#modal-root')!.innerHTML =
    `<div class="modal-backdrop"><section class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header><h2 id="modal-title">${title}</h2>${btn('關閉', 'close-modal', 'icon-btn', 'close', 'aria-label="關閉對話框"')}</header><div class="modal-body">${body}</div></section></div>`;
  document.querySelector<HTMLElement>('.modal input, .modal textarea, .modal button')?.focus();
}
function closeModal() {
  document.querySelector('#modal-root')!.innerHTML = '';
  modalReturnFocus?.focus();
}
function navigate(path: string) {
  if (location.hash === `#${path}`) void renderRoute();
  else location.hash = path;
}
function brand(small = false) {
  return `<a class="brand ${small ? 'small' : ''}" href="#/dashboard"><span class="brand-mark">${icon('leaf')}</span><span>青禾課堂<small>HEALTH CLASSROOM KIT</small></span></a>`;
}
function modeBadge() {
  return `<span class="mode-badge"><i></i>${config.mode === 'demo' ? '示範模式 · 虛構資料' : '私人課堂'}</span>`;
}
function sidebar(active: string) {
  return `<aside class="sidebar">${brand()}<div class="nav-label">我的教學空間</div><nav>${[
    ['dashboard', 'grid', '課程工作台'],
    ['classes', 'users', '班級與學生'],
    ['records', 'chart', '課堂紀錄'],
    ['settings', 'settings', '設定與部署'],
  ]
    .map(
      ([id, glyph, label]) =>
        `<a href="#/${id}" class="nav-item ${active === id ? 'active' : ''}">${icon(glyph)}${label}${active === id ? '<span class="nav-dot"></span>' : ''}</a>`,
    )
    .join(
      '',
    )}</nav><div class="sidebar-note">${icon('leaf')}<strong>讓每個想法，都有位置。</strong><p>一份可延伸的課堂框架，<br>一段一起參與的學習。</p></div><div class="sidebar-user"><span class="avatar">師</span><span><strong>${esc(user?.name || '示範教師')}</strong><small>教師工作空間</small></span><button class="icon-btn" data-action="logout" aria-label="登出">${icon('logout')}</button></div></aside>`;
}
function shell(active: string, title: string, body: string, actions = '') {
  app.className = 'workspace';
  app.innerHTML = `${sidebar(active)}<main class="workspace-main"><header class="workspace-top"><span class="breadcrumb">教學空間 <span>/</span> ${title}</span><div class="top-actions">${modeBadge()}${btn('使用說明', 'guide', 'quiet', 'book')}</div></header><div class="workspace-content"><div class="page-title"><div><p class="eyebrow">YOUR TEACHING SPACE</p><h1>${title}</h1></div><div class="actions">${actions}</div></div>${body}</div><footer class="workspace-footer">青禾課堂 <span>開放框架・共同成長</span><span>v${esc(config.version)}</span></footer></main>`;
}
function landing(role = 'teacher') {
  app.className = 'landing';
  app.innerHTML = `<header class="landing-header">${brand()}${tag('開放原始碼・為互動而設計')}</header><main class="landing-grid"><section class="landing-intro"><p class="eyebrow">LESS PRESENTING. MORE PARTICIPATING.</p><h1>讓每一次回應，<br>成為學習的<span>開始。</span></h1><p class="intro-copy">把教材、提問與全班的想法放在一起。<br>講師觸控大屏 × 學生 iPad，讓課堂自然互動。</p><div class="intro-chips">${tag(`${icon('screen')} 觸控授課`)}${tag(`${icon('chart')} 即時回饋`)}${tag(`${icon('shield')} 自行部署`)}</div><div class="landing-art"><div class="art-label">TODAY'S CLASSROOM</div><div class="art-quote">好問題，<br><span>讓思考發生。</span></div><div class="orbit o1"></div><div class="orbit o2"></div><div class="art-card ac1">${icon('check')} 一個選擇</div><div class="art-card ac2">${icon('spark')} 很多種想法</div><div class="art-card ac3">${icon('users')} 一起參與</div></div></section><section class="login-card"><p class="eyebrow">WELCOME TO CLASS</p><h2>準備好，一起上課。</h2><p class="muted">選擇你的身分，進入課堂。</p><div class="segmented" role="group" aria-label="登入身分"><button class="${role === 'teacher' ? 'selected' : ''}" data-action="login-tab" data-role="teacher">${icon('book')}我是教師</button><button class="${role === 'student' ? 'selected' : ''}" data-action="login-tab" data-role="student">${icon('users')}我是學生</button></div><form id="login-form" data-role="${role}">${role === 'teacher' ? (config.mode === 'demo' ? `<div class="soft-notice">${icon('leaf')}<div><strong>先體驗，再放入你的教材。</strong><p>示範資料保存在本機服務。請只使用虛構資料。</p></div></div>` : `<label>教師電子郵件<input name="email" type="email" autocomplete="username" required placeholder="teacher@example.com"></label><label>密碼<input name="password" type="password" autocomplete="current-password" required></label>`) : `<label>班級代碼<input name="classCode" autocomplete="off" value="${config.mode === 'demo' ? 'DEMO801' : ''}" required placeholder="由老師提供"></label><div class="field-row"><label>座號<input name="seat" type="number" inputmode="numeric" min="1" max="100" value="1" required></label><label>識別碼<input name="code" autocomplete="off" autocapitalize="characters" value="${config.mode === 'demo' ? 'DEMO01' : ''}" required placeholder="個人識別碼"></label></div>`}<button type="submit" class="btn primary full">${icon('arrow')}<span>${config.mode === 'demo' ? (role === 'teacher' ? '教師示範' : '學生示範') : '登入課堂'}</span></button><p id="login-error" class="form-error" role="alert"></p></form><div class="login-foot">${icon('shield')} ${config.mode === 'demo' ? '示範班級 DEMO801 · 座號 1–40 · 識別碼 DEMO01–DEMO40' : '課堂資料只開放給有權限的師生。'}</div><button class="text-button" data-action="guide">第一次使用？查看開始指南 ${icon('arrow')}</button></section></main><footer class="landing-footer">青禾課堂 / Health Classroom Kit <span>教材可以不同，參與始終重要。</span></footer>`;
}
async function loadDashboard() {
  dashboard = await api<Dashboard>('/dashboard');
  return dashboard;
}
function courseArt(index: number) {
  return `<div class="course-art tone-${index % 3}"><span class="art-mini">HEALTH & LIFE</span><div class="course-shape shape-one"></div><div class="course-shape shape-two"></div><div class="course-shape shape-three"></div><strong>觀察。比較。<br>然後，做選擇。</strong><span class="art-corner">${icon('leaf')}</span></div>`;
}
function renderDashboard() {
  const d = dashboard!;
  const active = d.sessions.filter((s) => !s.ended);
  const body = `<section class="welcome-banner"><div><span class="tag light">一堂課，從好奇開始</span><h2>今天，一起把課上得更好。</h2><p>準備教材、開啟互動，讓每位學生的想法被看見。</p></div><div class="banner-symbol">${icon('leaf')}<span>GROW<br>TOGETHER</span></div></section><section class="stats-grid"><div class="stat"><span class="stat-icon sage">${icon('book')}</span><div><span>我的課程</span><strong>${d.lessons.length}<small>份教材</small></strong></div></div><div class="stat"><span class="stat-icon lavender">${icon('users')}</span><div><span>教學班級</span><strong>${d.classes.length}<small>個班級</small></strong></div></div><div class="stat"><span class="stat-icon peach">${icon('chart')}</span><div><span>課堂紀錄</span><strong>${d.sessions.length}<small>次共同學習</small></strong></div></div></section>${
    active.length
      ? `<section class="active-sessions"><span class="live-dot"></span><strong>進行中的課堂</strong>${active
          .slice(-3)
          .map((s) =>
            btn(
              `${esc(s.className)}・繼續授課`,
              'resume',
              'quiet',
              'arrow',
              `data-id="${esc(s.id)}"`,
            ),
          )
          .join('')}</section>`
      : ''
  }<div class="section-top"><div><h2>我的課程<span class="count">${d.lessons.length}</span></h2><p>選擇一份教材，開始今天的互動。</p></div>${tag('支援 HTML 互動模組')}</div><div class="course-grid">${d.lessons.map((l, i) => `<article class="course-card" data-testid="lesson-card">${courseArt(i)}<div class="course-details"><div class="course-meta">${tag(esc(l.subject))}<span>${l.slides.length} 頁</span></div><h3>${esc(l.title)}</h3><p>${esc(l.description)}</p><div class="course-bottom"><span>${icon('clock')}${l.duration} 分鐘</span><button class="text-button" data-action="edit" data-id="${esc(l.id)}">編輯教材 ${icon('pen')}</button></div>${btn('開始上課', 'start', 'primary full', 'play', `data-id="${esc(l.id)}"`)}</div></article>`).join('')}<button class="new-course-card" data-action="new-lesson"><span class="new-circle">${icon('plus')}</span><strong>留一個位置，給新想法。</strong><p>建立課程，或讓你的 agent<br>依照規格放入教材。</p><span class="text-link">建立新課程 ${icon('arrow')}</span></button></div><div class="info-strip">${icon('spark')}<span><strong>有自己的教材？</strong> 匯入課程 JSON，或讓 agent 閱讀專案內的接手提示詞。</span>${btn('匯入課程', 'import', 'quiet', 'upload', 'data-testid="import-lesson"')}</div>`;
  shell(
    'dashboard',
    '課程工作台',
    body,
    `${btn('匯入課程', 'import', 'secondary', 'upload')}${btn('新增課程', 'new-lesson', 'primary', 'plus')}`,
  );
}
function renderClasses() {
  shell(
    'classes',
    '班級與學生',
    `<p class="page-description">學生使用班級代碼、座號與個人識別碼登入。每個班級的課堂紀錄獨立保存。</p><div class="class-grid">${dashboard!.classes.map((c) => `<article class="class-card"><span class="stat-icon lavender">${icon('users')}</span><h2>${esc(c.name)}</h2><p>${c.seats} 位學生・班級代碼</p><code class="class-code">${esc(c.code)}</code><p class="muted">${config.mode === 'demo' && c.code === 'DEMO801' ? '示範識別碼：DEMO01–DEMO40' : '個人識別碼僅在建立時提供，請妥善保存。'}</p>${btn('複製學生入口', 'copy-student', 'secondary', 'arrow', `data-code="${esc(c.code)}"`)}${btn('重發個人識別碼', 'reset-code', 'quiet full', 'shield', `data-id="${esc(c.id)}" data-seats="${c.seats}"`)}</article>`).join('')}</div><div class="soft-notice">${icon('shield')}<div><strong>只收集上課需要的資料。</strong><p>不需要姓名、電話或健康狀況。請勿把班級名冊或個人識別碼放入公開 GitHub。</p></div></div>`,
    btn('建立班級', 'new-class', 'primary', 'plus'),
  );
}
function renderRecords() {
  const rows = dashboard!.sessions.slice().reverse();
  shell(
    'records',
    '課堂紀錄',
    `<p class="page-description">每一次上課都有自己的教材版本與作答紀錄。備份檔含學生作答，請妥善保存。</p><section class="panel"><div class="table-wrap"><table><thead><tr><th>課程與班級</th><th>上課時間</th><th>狀態</th><th>操作</th></tr></thead><tbody>${rows.map((s) => `<tr><td><strong>${esc(s.title)}</strong><small>${esc(s.className)}</small></td><td>${new Date(s.createdAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td><td>${tag(s.ended ? '已結束' : '進行中', s.ended ? '' : 'green')}</td><td><div class="actions">${btn('查看', 'resume', 'quiet', 'eye', `data-id="${s.id}"`)}${btn('CSV', 'export-session', 'quiet', 'download', `data-id="${s.id}"`)}${btn('刪除', 'delete-session', 'quiet danger', 'trash', `data-id="${s.id}"`)}</div></td></tr>`).join('') || '<tr><td colspan="4" class="empty-state">還沒有課堂紀錄。從工作台開啟第一堂課吧。</td></tr>'}</tbody></table></div></section>`,
    `${btn('還原備份', 'restore', 'secondary', 'upload')}${btn('下載完整備份', 'backup', 'primary', 'download')}`,
  );
}
function renderSettings() {
  shell(
    'settings',
    '設定與部署',
    `<div class="settings-grid"><section class="panel settings-panel"><span class="stat-icon sage">${icon('settings')}</span><h2>你的服務，你的資料。</h2><p>這份框架可以由每位老師或學校自行部署。</p><dl class="setting-list"><div><dt>目前模式</dt><dd>${config.mode === 'demo' ? '本機功能示範' : 'Supabase 雲端資料'}</dd></div><div><dt>課堂同步</dt><dd>每 2 秒更新</dd></div><div><dt>AI 狀態</dt><dd>${config.aiConfigured ? '已設定服務' : '模擬分析・不呼叫外部 API'}</dd></div><div><dt>版本</dt><dd>${esc(config.version)}</dd></div></dl></section><section class="panel settings-panel"><span class="stat-icon peach">${icon('spark')}</span><h2>AI 是助手，教師做決定。</h2><p>金鑰由部署者放在 Cloudflare Secrets。系統會在伺服器端呼叫 AI；瀏覽器不保存金鑰。</p><div class="soft-notice compact"><p>只傳送允許分析的教材或去識別回答。學生的原始作答會保留，AI 分析供教師覆核。</p></div><p class="muted">設定步驟、支援的 API 格式與用量上限，請見專案部署文件。</p></section><section class="panel settings-panel"><h2>適合觸控的課堂。</h2><p>講師使用「大屏授課」開啟大工具列。學生使用 iPad 的 Safari 開啟入口，支援橫向與直向操作。</p><p>使用畫筆時單指書寫；選擇游標後操作頁面。雷射與聚光燈只在講師畫面顯示。</p>${btn('課堂操作指南', 'guide', 'secondary', 'book')}</section><section class="panel settings-panel"><h2>把教材交給 agent。</h2><p>先閱讀 AGENTS.md，再依課程 Schema 編寫 JSON。新增互動模組時，沿用框架的提交與儲存接口。</p><p class="muted">GitHub 原始碼包含部署說明、可複製提示詞與驗收清單。</p></section></div>`,
  );
}
function editLesson(lesson: Lesson) {
  shell(
    'dashboard',
    '編輯教材',
    `<div class="editor-grid"><section class="panel editor-main"><label>課程名稱<input id="lesson-title" value="${esc(lesson.title)}" maxlength="120"></label><label>課程內容 JSON<textarea id="lesson-json" class="code-editor" spellcheck="false">${esc(JSON.stringify(lesson, null, 2))}</textarea></label><p class="muted">保留 schemaVersion 與穩定 ID。每張投影片可以有自己的互動活動與來源。</p></section><aside class="panel editor-help"><span class="stat-icon lavender">${icon('book')}</span><h2>內容自由，接口一致。</h2><p>標題、內文與視覺化決定怎麼呈現；activity 決定怎麼互動。</p><ol><li>填入目標與教材來源。</li><li>選擇單選、多選、量尺或短答。</li><li>保存後回工作台開始上課。</li></ol><p>正式課程的健康資訊，請由教師依可信教材核對。</p>${btn('匯出課程 JSON', 'export-lesson', 'secondary full', 'download', `data-id="${esc(lesson.id)}"`)}${btn('AI 檢查課程邏輯', 'review-lesson', 'quiet full', 'spark', `data-id="${esc(lesson.id)}"`)}<p class="muted">AI 會分析已儲存的版本。</p></aside></div>`,
    `${btn('返回', 'dashboard', 'secondary', 'back')}${btn('儲存教材', 'save-lesson', 'primary', 'save', 'data-testid="save-lesson"')}`,
  );
}
function visual(slide: Slide) {
  if (slide.visual === 'bars')
    return `<div class="visual demo-bars" role="img" aria-label="示範比例圖，非健康或評量數據">${(
      slide.bullets || ['觀察', '比較', '調整']
    )
      .slice(0, 5)
      .map(
        (label, i) =>
          `<div class="demo-bar"><span>${esc(label)}</span><div><i style="width:${35 + i * 12}%"></i></div></div>`,
      )
      .join('')}<p>示範比例・非健康或評量數據<br>實際資料圖表可透過自訂 HTML 模組加入。</p></div>`;
  if (slide.visual === 'balance')
    return `<div class="visual balance"><div class="balance-ring"><div><small>A LITTLE SPACE</small><strong>剛剛好的<br>學習節奏</strong>${icon('leaf')}</div></div><span class="float-label fl1">觀察</span><span class="float-label fl2">調整</span><span class="float-label fl3">選擇</span><p>示意圖・不代表健康數據</p></div>`;
  if (slide.visual === 'steps')
    return `<div class="visual steps">${(slide.bullets || ['看見情境', '提出選擇', '調整想法']).map((x, i) => `<div class="step-card"><span>0${i + 1}</span><strong>${esc(x)}</strong>${icon(i === 2 ? 'check' : 'arrow')}</div>`).join('')}</div>`;
  return `<div class="visual visual-cards">${(slide.bullets || ['留一點時間思考', '說出你的理由', '聽聽不同的想法']).map((x, i) => `<div class="idea-card idea-${i % 3}">${icon(['eye', 'spark', 'leaf'][i % 3])}<strong>${esc(x)}</strong><span>0${i + 1}</span></div>`).join('')}</div>`;
}
function aggregateHtml(v: SessionView) {
  const a = v.lesson.slides[v.session.slideIndex]?.activity;
  if (!a) return '';
  if (!v.session.resultsVisible && user?.role === 'student')
    return `<p class="muted">結果由教師決定何時公布。</p>`;
  if (a.type === 'short') {
    if (user?.role === 'student')
      return `<div class="response-total">${v.aggregate.submitted}<span>份想法，已被收集</span></div><p class="muted">個別文字回答只提供教師檢視。</p>`;
    return `<div class="short-responses">${
      v.answers
        .filter((x) => x.activityId === a.id)
        .map((x) => `<div><span class="seat-tag">${x.seat} 號</span><p>${esc(x.value)}</p></div>`)
        .join('') || '<p class="muted">等待第一個想法。</p>'
    }</div>`;
  }
  const labels =
    a.options ||
    Array.from({ length: (a.max || 5) - (a.min || 1) + 1 }, (_, i) => String(i + (a.min || 1)));
  return `<div class="result-bars">${labels
    .map((label, i) => {
      const value = Number(
        v.aggregate.counts[String(a.type === 'scale' ? i + (a.min || 1) : i)] || 0,
      );
      const percent = v.aggregate.submitted ? Math.round((value / v.aggregate.submitted) * 100) : 0;
      return `<div class="result-row"><div><span>${esc(label)}</span><strong>${value}<small> / ${percent}%</small></strong></div><div class="bar-track"><span style="width:${percent}%"></span></div></div>`;
    })
    .join(
      '',
    )}</div>${v.session.resultsVisible && a.explanation ? `<p class="explanation">${icon('leaf')}${esc(a.explanation)}</p>` : ''}`;
}
function currentStudentAnswer(a: Activity) {
  return view?.answers.find((x) => x.userId === user?.id && x.activityId === a.id);
}
function answerForm(a: Activity) {
  const answered = currentStudentAnswer(a),
    open = view!.session.activityOpen && !view!.session.ended,
    disabled = answered || !open;
  let fields = '';
  if (a.type === 'single' || a.type === 'multiple')
    fields = `<div class="answer-options">${a.options!.map((o, i) => `<button class="answer-option ${draft === i || (Array.isArray(draft) && draft.includes(i)) ? 'chosen' : ''}" data-testid="poll-option-${i}" data-action="choose" data-index="${i}" aria-pressed="${draft === i || (Array.isArray(draft) && draft.includes(i))}" ${disabled ? 'disabled' : ''}><span class="option-letter">${String.fromCharCode(65 + i)}</span><span>${esc(o)}</span><span class="option-check">${icon('check')}</span></button>`).join('')}</div>`;
  if (a.type === 'scale')
    fields = `<div class="scale-options">${Array.from(
      { length: (a.max || 5) - (a.min || 1) + 1 },
      (_, i) => i + (a.min || 1),
    )
      .map(
        (n) =>
          `<button class="scale-option ${draft === n ? 'chosen' : ''}" data-action="scale" data-value="${n}" aria-pressed="${draft === n}" ${disabled ? 'disabled' : ''}>${n}</button>`,
      )
      .join(
        '',
      )}</div><div class="scale-labels"><span>${esc(a.minLabel)}</span><span>${esc(a.maxLabel)}</span></div>`;
  if (a.type === 'short')
    fields = `<label class="sr-only" for="short-answer">你的回答</label><textarea id="short-answer" maxlength="800" placeholder="我建議……，因為……" ${disabled ? 'disabled' : ''}>${typeof draft === 'string' ? esc(draft) : ''}</textarea><p class="muted small-text">請勿輸入健康隱私或個人聯絡資訊。最多 800 字。</p>`;
  return `<div class="activity-prompt"><span class="tag">${{ single: '單選', multiple: '多選', scale: '量尺', short: '短答' }[a.type]}</span><h2>${esc(a.prompt)}</h2></div>${fields}<div class="submit-area">${answered ? `<div class="saved-answer">${icon('check')}已儲存你的回答</div>` : btn(open ? '送出回答' : '等待教師開放', 'submit-answer', 'primary full', 'check', `data-testid="submit-answer" ${!open ? 'disabled' : ''}`)}<p id="answer-status" role="status" class="muted small-text">${answered ? '重新整理也能找回這次作答。' : open ? '送出後會顯示儲存結果。' : '可以先閱讀情境，想一想理由。'}</p></div>`;
}
function screenMode() {
  return currentRoute.startsWith('/screen/');
}
function renderSession() {
  if (!view || !user) return;
  board?.destroy();
  board = null;
  const teacher = user.role === 'teacher',
    s = view.session,
    screen = screenMode();
  const index = teacher || s.followTeacher ? s.slideIndex : studentSlide;
  const slide = view.lesson.slides[index] || view.lesson.slides[0];
  const a = !teacher && index !== s.slideIndex ? undefined : slide.activity;
  const own = a ? currentStudentAnswer(a) : undefined;
  if (own) draft = own.value;
  app.className = `classroom ${teacher ? 'teacher-room' : 'student-room'} ${screen ? 'big-screen' : ''}`;
  app.innerHTML = `<header class="room-header"><div class="room-identity">${teacher ? btn('返回工作台', 'dashboard', 'icon-btn', 'back', 'aria-label="返回工作台"') : brand(true)}<div><span class="eyebrow">${teacher ? 'LIVE CLASSROOM' : 'YOUR LEARNING SPACE'}</span><strong>${esc(teacher ? s.title : s.className + '・' + user.seat + ' 號')}</strong></div></div><div class="room-header-actions"><span id="sync-status" class="sync-status"><i></i>已連線</span>${teacher ? `${btn(screen ? '標準授課' : '大屏授課', 'screen', 'secondary', 'screen')}${btn('全螢幕', 'fullscreen', 'secondary', 'expand')}` : btn('登出', 'logout', 'quiet', 'logout')}${modeBadge()}</div></header><div class="room-layout"><main class="presentation"><div class="slide-topline"><span>${esc(view.lesson.subject)}</span><span>${String(index + 1).padStart(2, '0')} / ${String(view.lesson.slides.length).padStart(2, '0')}</span></div><article class="slide-stage" data-testid="session-slide" id="slide-stage"><div class="slide-copy"><p class="eyebrow">${esc(slide.eyebrow || `SLIDE ${index + 1}`)}</p><h1>${esc(slide.title)}</h1><p class="slide-body">${esc(slide.body)}</p>${slide.source ? `<p class="slide-source">${esc(slide.source)}</p>` : ''}</div>${slide.customHtml ? `<iframe id="custom-activity" class="custom-activity" title="自訂互動教材" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>` : visual(slide)}<div class="slide-brand">青禾課堂 ${icon('leaf')}</div></article>${teacher ? toolbar() : ''}<div class="slide-navigation"><div class="slide-dots">${view.lesson.slides.map((_, i) => `<button class="${i === index ? 'active' : ''}" data-action="go-slide" data-index="${i}" aria-label="第 ${i + 1} 頁" ${!teacher && s.followTeacher ? 'disabled' : ''}><span></span></button>`).join('')}</div><div class="actions">${btn('上一頁', 'prev-slide', 'secondary', 'back', index === 0 || (!teacher && s.followTeacher) ? 'disabled' : '')}${btn('下一頁', 'next-slide', 'primary', 'arrow', `data-testid="next-slide" ${index === view.lesson.slides.length - 1 || (!teacher && s.followTeacher) ? 'disabled' : ''}`)}</div></div>${teacher && !screen && slide.notes ? `<details class="teacher-notes"><summary>教師備註・學生不會看到</summary><p>${esc(slide.notes)}</p></details>` : ''}</main><aside class="interaction-panel"><div class="interaction-header"><span>${icon(teacher ? 'chart' : 'pen')} ${teacher ? '課堂互動' : '輪到你想一想'}</span><span id="answer-count" class="tag">${view.aggregate.submitted} / ${view.aggregate.total}</span></div>${s.ended ? '<div class="soft-notice compact"><p>課堂已結束，紀錄已保存。</p></div>' : ''}${a ? (teacher ? `<div class="teacher-activity"><span class="tag">${{ single: '單選活動', multiple: '多選活動', scale: '量尺活動', short: '短答活動' }[a.type]}</span><h2>${esc(a.prompt)}</h2><div class="activity-actions">${btn(s.activityOpen ? '結束作答' : '開放作答', 'toggle-activity', s.activityOpen ? 'secondary' : 'primary', 'play', s.ended ? 'disabled' : '')}${btn(s.resultsVisible ? '隱藏統計' : '公布統計', 'toggle-results', 'secondary', 'chart')}</div><div id="aggregate">${aggregateHtml(view)}</div>${a.type === 'short' ? btn('AI 整理回答', 'summarize', 'quiet full', 'spark') : ''}<p class="privacy-hint">${icon('shield')}投影只顯示統計；個別回答留在教師端。</p></div>` : `<div id="student-answer">${answerForm(a)}</div>${s.resultsVisible ? `<details class="student-results" open><summary>全班回饋</summary><div id="aggregate">${aggregateHtml(view)}</div></details>` : ''}`) : `<div class="quiet-moment"><span>${icon('leaf')}</span><h2>留一點時間，<br>讓想法慢慢長出來。</h2><p>${teacher ? '這一頁沒有題目。可以使用白板整理觀點，或抽籤邀請分享。' : '先閱讀畫面，聽聽老師與同學的想法。'}</p></div>`}<div id="class-events">${eventsHtml()}</div>${teacher ? `<div class="room-options">${btn(s.followTeacher ? '教師同步翻頁' : '學生自主瀏覽', 'toggle-follow', 'quiet full', s.followTeacher ? 'screen' : 'book', s.ended ? 'disabled' : '')}${btn('學生加入資訊', 'join-info', 'quiet full', 'users')}${btn('結束這堂課', 'end-session', 'quiet full danger', 'logout', s.ended ? 'disabled' : '')}</div>` : ''}</aside></div>`;
  if (screen && teacher && a?.type === 'short') {
    document.querySelector('#aggregate')!.innerHTML =
      `<div class="response-total">${view.aggregate.submitted}<span>份想法已收集</span></div><p class="muted">個別回答請在標準授課模式檢視。</p>`;
    document.querySelector('[data-action="summarize"]')?.remove();
  }
  if (!teacher && index !== s.slideIndex) {
    const panel = document.querySelector('.quiet-moment');
    if (panel)
      panel.innerHTML = `<h2>自主閱讀中</h2><p>作答只開放在教師目前的活動頁。</p>${btn('回到目前活動', 'go-slide', 'primary', 'arrow', `data-index="${s.slideIndex}"`)}`;
  }
  const stage = document.querySelector<HTMLElement>('#slide-stage')!;
  board = new Whiteboard(
    stage,
    view.whiteboard[slide.id] || [],
    async (strokes) => {
      await api(`/sessions/${s.id}/whiteboard`, 'PUT', { slideId: slide.id, strokes });
      toast('筆跡已儲存');
    },
    (m) => toast(m, true),
  );
  if (teacher) {
    board.color = color;
    board.setTool(currentTool);
  } else board.setTool('cursor');
  const frame = document.querySelector<HTMLIFrameElement>('#custom-activity');
  if (frame && slide.customHtml)
    frame.src = `/api/sessions/${encodeURIComponent(s.id)}/slides/${encodeURIComponent(slide.id)}/html`;
}
function toolbar() {
  return `<div class="teaching-toolbar" role="toolbar" aria-label="白板與課堂工具">${[
    ['cursor', 'cursor', '操作'],
    ['pen', 'pen', '畫筆'],
    ['erase', 'erase', '橡皮擦'],
    ['laser', 'laser', '雷射筆'],
    ['spot', 'spot', '聚光燈'],
  ]
    .map(([tool, glyph, label]) =>
      btn(
        label,
        'tool',
        `tool-button ${currentTool === tool ? 'selected' : ''}`,
        glyph,
        `data-tool="${tool}" data-testid="tool-${tool === 'spot' ? 'spotlight' : tool}" aria-pressed="${currentTool === tool}"`,
      ),
    )
    .join(
      '',
    )}<span class="toolbar-divider"></span><label class="color-picker" title="畫筆顏色"><input type="color" id="pen-color" value="${color}" aria-label="畫筆顏色"><span>顏色</span></label>${btn('復原', 'undo', 'tool-button', 'undo')}${btn('重做', 'redo', 'tool-button', 'redo')}${btn('清空', 'clear-board', 'tool-button', 'trash')}<span class="toolbar-divider"></span>${btn('抽籤', 'draw', 'tool-button', 'dice', 'data-testid="draw-seat"')}${btn('搶答', 'buzz-open', 'tool-button', 'bolt', 'data-testid="buzz-open"')}</div>`;
}
function eventsHtml() {
  if (!view) return '';
  const s = view.session;
  return `${s.drawnSeat ? `<div class="draw-result">${icon('dice')}<div><small>這次邀請</small><strong>${s.drawnSeat}<span>號同學</span></strong></div></div>` : ''}${s.buzzOpen || s.buzzWinner ? `<div class="buzz-panel">${s.buzzWinner ? `<span>${icon('bolt')}搶答成功</span><strong>${s.buzzWinner.seat}<small> 號同學</small></strong>` : `<span class="pulse">${icon('bolt')}搶答已開放</span>${user?.role === 'student' ? btn('我要搶答', 'buzz', 'primary full', 'bolt', 'data-testid="buzz-button"') : '<p>等待同學按下搶答。</p>'}`}${user?.role === 'teacher' ? btn('重設搶答', 'buzz-reset', 'quiet', 'undo') : ''}</div>` : ''}`;
}
async function control(action: string, extra: Record<string, unknown> = {}) {
  if (!view) return;
  await board?.flush();
  view = await api<SessionView>(`/sessions/${view.session.id}/control`, 'POST', {
    action,
    ...extra,
  });
  draft = [];
  renderSession();
}
function viewSignature(v: SessionView) {
  const s = v.session;
  return [s.id, s.slideIndex, s.activityOpen, s.resultsVisible, s.followTeacher, s.ended].join(':');
}
async function refreshSession() {
  if (pollBusy || !user || !view) return;
  pollBusy = true;
  const route = currentRoute;
  try {
    const next = await api<SessionView | { session: null }>(
      user.role === 'student' ? '/student/session' : `/sessions/${view.session.id}`,
    );
    if (route !== currentRoute) return;
    if (!next.session) {
      view = null;
      studentWaiting();
      return;
    }
    const n = next as SessionView;
    lastSync = Date.now();
    if (viewSignature(n) !== viewSignature(view)) {
      await board?.flush();
      const changedSlide = n.session.slideIndex !== view.session.slideIndex;
      view = n;
      if (changedSlide) draft = [];
      renderSession();
    } else {
      view = n;
      const count = document.querySelector('#answer-count');
      if (count) count.textContent = `${n.aggregate.submitted} / ${n.aggregate.total}`;
      const agg = document.querySelector('#aggregate');
      if (agg)
        agg.innerHTML =
          screenMode() && n.lesson.slides[n.session.slideIndex]?.activity?.type === 'short'
            ? `<div class="response-total">${n.aggregate.submitted}<span>份想法已收集</span></div>`
            : aggregateHtml(n);
      const events = document.querySelector('#class-events');
      if (events) events.innerHTML = eventsHtml();
      const idx =
        user.role === 'teacher' || n.session.followTeacher ? n.session.slideIndex : studentSlide;
      board?.setRemote(n.whiteboard[n.lesson.slides[idx]?.id] || []);
    }
    await retryPending();
    updateSync(true);
  } catch (e) {
    if ((e as { status?: number }).status === 401) {
      clearInterval(poll);
      user = null;
      view = null;
      board?.destroy();
      board = null;
      toast('登入已到期，請重新登入。', true);
      landing(currentRoute.startsWith('/student') ? 'student' : 'teacher');
    } else updateSync(false);
  } finally {
    pollBusy = false;
  }
}
function updateSync(online: boolean) {
  const el = document.querySelector<HTMLElement>('#sync-status');
  if (el) {
    el.className = `sync-status ${online ? '' : 'offline'}`;
    el.innerHTML = `<i></i>${online ? '已連線 · 自動同步' : '連線中斷 · 正在重試'}`;
  }
}
function studentWaiting() {
  app.className = 'waiting-room';
  app.innerHTML = `<header>${brand()}${btn('登出', 'logout', 'quiet', 'logout')}</header><main><div class="waiting-leaf">${icon('leaf')}</div><p class="eyebrow">YOU ARE IN THE RIGHT PLACE</p><h1>你已入座，<br>等老師開啟這堂課。</h1><p>${esc(user?.name)} · 作答會保存在你的課堂紀錄裡。</p><div class="waiting-dots"><i></i><i></i><i></i></div><p class="muted">每 2 秒自動更新，不需要一直重新整理。</p></main>`;
}
async function loadStudent() {
  const result = await api<SessionView | { session: null }>('/student/session');
  if (result.session) {
    view = result as SessionView;
    studentSlide = view.session.slideIndex;
    draft = [];
    renderSession();
  } else studentWaiting();
  clearInterval(poll);
  poll = setInterval(() => {
    if (view) void refreshSession();
    else void loadStudent().catch(() => {});
  }, 2000);
}
async function renderRoute() {
  const version = ++routeVersion;
  currentRoute = location.hash.slice(1) || '/dashboard';
  clearInterval(poll);
  await board?.flush().catch((e) => toast(e.message, true));
  board?.destroy();
  board = null;
  if (!user) {
    landing(currentRoute.startsWith('/student') ? 'student' : 'teacher');
    return;
  }
  try {
    if (user.role === 'student') {
      await loadStudent();
      return;
    }
    if (currentRoute.startsWith('/session/') || currentRoute.startsWith('/screen/')) {
      view = await api<SessionView>(`/sessions/${currentRoute.split('/')[2]}`);
      if (version !== routeVersion) return;
      renderSession();
      poll = setInterval(() => void refreshSession(), 2000);
      return;
    }
    view = null;
    await loadDashboard();
    if (version !== routeVersion) return;
    if (currentRoute === '/classes') renderClasses();
    else if (currentRoute === '/records') renderRecords();
    else if (currentRoute === '/settings') renderSettings();
    else if (currentRoute.startsWith('/lesson/')) {
      const lesson = dashboard!.lessons.find((l) => l.id === currentRoute.split('/')[2]);
      if (lesson) editLesson(lesson);
      else navigate('/dashboard');
    } else renderDashboard();
  } catch (e) {
    toast((e as Error).message, true);
    if (!app.innerHTML) app.innerHTML = '<p>讀取失敗，請重新整理。</p>';
  }
}
async function submitAnswer(value = draft) {
  if (!view || user?.role !== 'student') return;
  const a = view.lesson.slides[view.session.slideIndex].activity;
  if (!a) return;
  if ((Array.isArray(value) && !value.length) || (typeof value === 'string' && !value.trim())) {
    toast('先留下一個想法，再送出。', true);
    return;
  }
  if (!view.session.activityOpen || view.session.ended) {
    toast('請等待教師開放作答。', true);
    return;
  }
  const key = `${pendingPrefix}${user.id}.${view.session.id}.${a.id}`;
  const existing = localStorage.getItem(key),
    payload = existing
      ? JSON.parse(existing)
      : { submissionId: crypto.randomUUID(), activityId: a.id, value };
  const packageData = { sessionId: view.session.id, ...payload };
  localStorage.setItem(key, JSON.stringify(packageData));
  const status = document.querySelector('#answer-status');
  if (status) status.textContent = '正在儲存…';
  try {
    await api(`/sessions/${view.session.id}/answers`, 'POST', payload);
    localStorage.removeItem(key);
    view = await api(`/sessions/${view.session.id}`);
    renderSession();
    toast('回答已儲存');
  } catch (e) {
    const code = (e as { status?: number }).status;
    if (code && code < 500) {
      localStorage.removeItem(key);
      toast((e as Error).message, true);
    } else {
      if (status) status.textContent = '待送出：恢復連線後會自動重試。';
      toast('回答已暫存，正在等待連線。');
    }
  }
}
async function retryPending() {
  if (user?.role !== 'student') return;
  for (const key of Object.keys(localStorage).filter((k) =>
    k.startsWith(`${pendingPrefix}${user!.id}.`),
  )) {
    try {
      const p = JSON.parse(localStorage.getItem(key)!);
      await api(`/sessions/${p.sessionId}/answers`, 'POST', p);
      localStorage.removeItem(key);
      toast('暫存回答已送達');
      if (view?.session.id === p.sessionId) {
        view = await api(`/sessions/${p.sessionId}`);
        renderSession();
      }
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status && status < 500) {
        localStorage.removeItem(key);
        toast('暫存回答未被接受：' + (e as Error).message, true);
      }
    }
  }
}
async function analyze(task: 'lesson-review' | 'response-summary', lessonId?: string) {
  modal(
    'AI 教學助手',
    `<div class="ai-loading">${icon('spark')}正在整理想法…</div><p class="muted">輸出是教學建議，請核對原文後採用。</p>`,
  );
  try {
    const result = await api('/ai', 'POST', {
      task,
      lessonId,
      sessionId: view?.session.id,
      activityId: view?.lesson.slides[view.session.slideIndex].activity?.id,
    });
    modal(
      'AI 教學助手',
      `${tag(result.mode === 'mock' ? '模擬分析・未呼叫外部 API' : 'AI 分析草稿')}<div class="ai-output">${esc(result.text)}</div><div class="soft-notice compact"><p>請以教材與學生原始回答為依據，教師覆核後再採用。</p></div>`,
      true,
    );
  } catch (e) {
    modal(
      'AI 暫時無法使用',
      `<p>${esc((e as Error).message)}</p><p class="muted">其他課堂功能仍可正常使用。</p>`,
    );
  }
}
async function chooseFile(handler: (data: any) => Promise<void>, maxBytes = 1_048_000) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > maxBytes)
        throw new Error(`檔案超過 ${Math.ceil(maxBytes / 1048576)} MB 限制。`);
      await handler(JSON.parse(await file.text()));
    } catch (e) {
      toast((e as Error).message, true);
    }
  });
  input.click();
}
async function showJoinInfo(code: string) {
  const url = new URL(location.href);
  url.hash = '/student';
  url.search = '';
  url.searchParams.set('class', code);
  const qr = await QRCode.toDataURL(url.href, {
    width: 260,
    margin: 3,
    errorCorrectionLevel: 'M',
    color: { dark: '#173f38ff', light: '#ffffffff' },
  });
  modal(
    '讓學生加入課堂',
    `<p>學生以 iPad 掃描 QR Code 或開啟連結，再輸入座號與個人識別碼。</p><div class="join-qr"><img src="${qr}" width="260" height="260" alt="學生入口 QR Code" data-testid="join-qr"></div><label>班級代碼<code class="class-code">${esc(code)}</code></label><label>學生入口<input readonly value="${esc(url.href)}" aria-label="學生入口連結"></label>${btn('複製學生入口', 'copy-student', 'primary full', 'arrow', `data-code="${esc(code)}"`)}<p class="muted small-text">${['127.0.0.1', 'localhost'].includes(location.hostname) ? '目前為本機入口，其他裝置無法連到這個網址。正式部署後會產生可跨裝置使用的 QR Code。' : '每位學生使用自己的識別碼。請個別提供，不要投影完整名冊。'}</p>`,
  );
}
async function action(el: HTMLElement) {
  const act = el.dataset.action,
    id = el.dataset.id;
  if (act === 'close-modal') {
    closeModal();
    return;
  }
  if (act === 'login-tab') {
    landing(el.dataset.role);
    return;
  }
  if (act === 'logout') {
    await board?.flush();
    await api('/logout', 'POST', {});
    for (const key of Object.keys(localStorage).filter((k) => k.startsWith(pendingPrefix)))
      localStorage.removeItem(key);
    user = null;
    view = null;
    navigate('/dashboard');
    return;
  }
  if (act === 'dashboard') {
    navigate('/dashboard');
    return;
  }
  if (act === 'guide') {
    modal(
      '開始一堂互動課',
      `<ol class="guide-steps"><li><strong>教師準備</strong><p>登入教師端，選教材，按「開始上課」。</p></li><li><strong>學生入座</strong><p>以學生入口、班級代碼、座號與識別碼登入。示範班為 DEMO801，1 號識別碼 DEMO01。</p></li><li><strong>觸控授課</strong><p>大屏模式有較大的工具列。選畫筆直接書寫，選「操作」再點選頁面。手寫時不啟用滑動翻頁。</p></li><li><strong>一起互動</strong><p>教師開放作答，學生送出。教師可公布統計、抽籤、開放搶答或使用 AI 整理短答。</p></li><li><strong>課後帶走</strong><p>結束課堂後，從課堂紀錄下載作答與備份。iPad 橫直向皆可；瀏覽器全螢幕支援依裝置而異。</p></li></ol>`,
      true,
    );
    return;
  }
  if (act === 'edit') {
    navigate(`/lesson/${id}`);
    return;
  }
  if (act === 'new-lesson') {
    const l: Lesson = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      title: '我的新課程',
      description: '在這裡寫下課程簡介。',
      subject: '健康教育',
      duration: 20,
      objectives: ['填入學習目標'],
      slides: [
        {
          id: 'intro',
          title: '從一個好問題開始',
          body: '填入你的教學內容。',
          visual: 'steps',
          bullets: ['觀察', '比較', '調整'],
        },
      ],
    };
    await api(`/lessons/${l.id}`, 'PUT', { lesson: l });
    navigate(`/lesson/${l.id}`);
    return;
  }
  if (act === 'save-lesson') {
    const l = JSON.parse(document.querySelector<HTMLTextAreaElement>('#lesson-json')!.value);
    l.title = document.querySelector<HTMLInputElement>('#lesson-title')!.value;
    await api(`/lessons/${l.id}`, 'PUT', { lesson: l });
    toast('教材已儲存');
    await loadDashboard();
    editLesson(l);
    return;
  }
  if (act === 'import') {
    await chooseFile(async (lesson) => {
      if (!lesson.slides) throw new Error('這不是課程 JSON，請確認檔案。');
      lesson.id = crypto.randomUUID();
      await api(`/lessons/${lesson.id}`, 'PUT', { lesson });
      toast('已匯入為新的課程');
      navigate('/dashboard');
    });
    return;
  }
  if (act === 'export-lesson') {
    const l = dashboard?.lessons.find((l) => l.id === id);
    if (l) download(`${l.id}.json`, JSON.stringify(l, null, 2));
    return;
  }
  if (act === 'review-lesson') {
    await analyze('lesson-review', id);
    return;
  }
  if (act === 'start') {
    if (!dashboard!.classes.length) {
      modal(
        '先建立授課班級',
        `<p>建立班級並下載個人識別碼後，就可以開始上課。</p>${btn('建立班級', 'new-class', 'primary', 'users')}`,
      );
      return;
    }
    modal(
      '開啟今天的課堂',
      `<p>選擇班級後，學生會自動進入這次課堂。</p><form id="start-form" data-lesson="${esc(id)}"><label>授課班級<select name="classId">${dashboard!.classes.map((c) => `<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.code)}</option>`).join('')}</select></label><button class="btn primary full" type="submit">${icon('play')}開始上課</button></form>`,
    );
    return;
  }
  if (act === 'resume') {
    navigate(`/session/${id}`);
    return;
  }
  if (act === 'new-class') {
    modal(
      '建立新的班級',
      `<form id="class-form"><label>班級名稱<input name="name" required maxlength="60" placeholder="例如：八年一班"></label><label>學生人數<input name="seats" type="number" min="1" max="60" value="30" required></label><p class="muted">建立後會提供每個座號的隨機識別碼。請下載並個別發給學生。</p><button type="submit" class="btn primary full">建立班級與識別碼</button></form>`,
    );
    return;
  }
  if (act === 'reset-code') {
    modal(
      '重發個人識別碼',
      `<p>重發後，該座號的舊識別碼及現有登入會失效。請個別交給學生。</p><label>學生座號<input id="reset-seat" type="number" min="1" max="${el.dataset.seats}" value="1" inputmode="numeric"></label>${btn('確認重發', 'confirm-reset', 'primary', 'shield', `data-id="${id}"`)}`,
    );
    return;
  }
  if (act === 'confirm-reset') {
    const seat = Number(document.querySelector<HTMLInputElement>('#reset-seat')!.value);
    const result = await api(`/classes/${id}/credentials`, 'POST', { seat });
    modal(
      '新的個人識別碼',
      `<p>${seat} 號同學的新識別碼只會在此提供。請先記下並妥善交付。</p><code class="class-code">${esc(result.credential.code)}</code>`,
    );
    return;
  }
  if (act === 'copy-student') {
    const url = new URL(location.href);
    url.hash = '/student';
    url.searchParams.set('class', el.dataset.code!);
    try {
      await navigator.clipboard.writeText(url.href);
      toast('學生入口已複製');
    } catch {
      modal('學生入口', `<input readonly value="${esc(url.href)}"><p>請複製連結後分享給學生。</p>`);
    }
    return;
  }
  if (act === 'backup') {
    const b = await api('/backup');
    download('classroom-backup.json', JSON.stringify(b, null, 2));
    toast('備份已下載，含作答資料，請妥善保存。');
    return;
  }
  if (act === 'restore') {
    modal(
      '還原備份',
      `<p>匯入會依系統規則合併資料。建議先下載目前的完整備份。</p><p>只匯入你信任的課堂備份；個人識別碼不包含在公開課程檔中。</p>${btn('選擇備份 JSON', 'restore-file', 'primary', 'upload')}`,
    );
    return;
  }
  if (act === 'restore-file') {
    await chooseFile(
      async (backup) => {
        await api('/restore', 'POST', { backup });
        closeModal();
        toast('備份已匯入');
        await renderRoute();
      },
      9 * 1024 * 1024,
    );
    return;
  }
  if (act === 'export-session') {
    const r = await fetch(`/api/sessions/${id}/export?format=csv`);
    if (!r.ok) throw new Error('無法匯出資料');
    download(`classroom-${id}.csv`, '\uFEFF' + (await r.text()), 'text/csv;charset=utf-8');
    return;
  }
  if (act === 'delete-session') {
    modal(
      '刪除這次課堂？',
      `<p>這會刪除該場次的作答與筆跡。請先確認已保留需要的備份。</p>${btn('確認刪除', 'confirm-delete', 'danger-fill', 'trash', `data-id="${id}"`)}`,
    );
    return;
  }
  if (act === 'confirm-delete') {
    await api(`/sessions/${id}`, 'DELETE');
    closeModal();
    await renderRoute();
    toast('課堂紀錄已刪除');
    return;
  }
  if (!view) return;
  const s = view.session,
    a = view.lesson.slides[s.slideIndex]?.activity;
  if (act === 'screen') {
    await board?.flush();
    navigate(`/${screenMode() ? 'session' : 'screen'}/${s.id}`);
    return;
  }
  if (act === 'fullscreen') {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen)
        await document.documentElement.requestFullscreen();
      else toast('此瀏覽器請使用加入主畫面或瀏覽器的全螢幕功能。');
    } catch {
      toast('此裝置無法切換全螢幕，仍可使用大屏模式。');
    }
    return;
  }
  if (act === 'tool') {
    currentTool = el.dataset.tool as Tool;
    board?.setTool(currentTool);
    document.querySelectorAll('[data-action="tool"]').forEach((b) => {
      b.classList.toggle('selected', (b as HTMLElement).dataset.tool === currentTool);
      b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.tool === currentTool));
    });
    return;
  }
  if (act === 'undo') {
    board?.undo();
    return;
  }
  if (act === 'redo') {
    board?.redo();
    return;
  }
  if (act === 'clear-board') {
    modal(
      '清空這頁的筆跡？',
      `<p>只清空目前這一頁；你仍可在本次操作中按「復原」。</p>${btn('清空筆跡', 'confirm-clear', 'danger-fill', 'trash')}`,
    );
    return;
  }
  if (act === 'confirm-clear') {
    board?.clear();
    closeModal();
    return;
  }
  if (['prev-slide', 'next-slide', 'go-slide'].includes(act || '')) {
    const current = user!.role === 'teacher' || s.followTeacher ? s.slideIndex : studentSlide;
    const index =
      act === 'go-slide' ? Number(el.dataset.index) : current + (act === 'next-slide' ? 1 : -1);
    if (index < 0 || index >= view.lesson.slides.length) return;
    if (user!.role === 'teacher') await control('slide', { index });
    else if (!s.followTeacher) {
      studentSlide = index;
      draft = [];
      renderSession();
    }
    return;
  }
  if (act === 'toggle-activity') {
    await control('activity', { value: !s.activityOpen });
    return;
  }
  if (act === 'toggle-results') {
    await control('results', { value: !s.resultsVisible });
    return;
  }
  if (act === 'toggle-follow') {
    await control('mode', { value: !s.followTeacher });
    return;
  }
  if (act === 'draw') {
    await control('draw');
    toast(`邀請 ${view.session.drawnSeat} 號同學分享`);
    return;
  }
  if (act === 'buzz-open') {
    await control('buzz-open');
    return;
  }
  if (act === 'buzz-reset') {
    await control('buzz-reset');
    return;
  }
  if (act === 'buzz') {
    await api(`/sessions/${s.id}/buzz`, 'POST', { submissionId: crypto.randomUUID() });
    await refreshSession();
    return;
  }
  if (act === 'choose' && a) {
    const n = Number(el.dataset.index);
    draft =
      a.type === 'single'
        ? n
        : Array.isArray(draft)
          ? draft.includes(n)
            ? draft.filter((x) => x !== n)
            : [...draft, n]
          : [n];
    document.querySelector('#student-answer')!.innerHTML = answerForm(a);
    return;
  }
  if (act === 'scale' && a) {
    draft = Number(el.dataset.value);
    document.querySelector('#student-answer')!.innerHTML = answerForm(a);
    return;
  }
  if (act === 'submit-answer') {
    await submitAnswer();
    return;
  }
  if (act === 'summarize') {
    await analyze('response-summary');
    return;
  }
  if (act === 'end-session') {
    modal(
      '結束這堂課？',
      `<p>學生將停止作答，所有已儲存的回答與筆跡會保留。</p>${btn('結束並保存紀錄', 'confirm-end', 'primary', 'check')}`,
    );
    return;
  }
  if (act === 'confirm-end') {
    closeModal();
    await control('end');
    toast('課堂已結束，紀錄已保留');
    return;
  }
  if (act === 'join-info') {
    const c =
      dashboard?.classes.find((c) => c.id === s.classId) ||
      (await loadDashboard()).classes.find((c) => c.id === s.classId);
    if (c) await showJoinInfo(c.code);
    return;
  }
}
document.addEventListener('click', (e) => {
  const el = (e.target as Element).closest<HTMLElement>('[data-action]');
  if (!el || el.hasAttribute('disabled')) return;
  if (touchTap?.el === el) {
    if (e.isTrusted && e.detail !== 0 && touchTap.fallback && Date.now() - touchTap.at < 650)
      return;
    touchTap.handled = true;
  }
  const button = el as HTMLButtonElement;
  button.disabled = true;
  void action(el)
    .catch((e) => toast(e.message, true))
    .finally(() => (button.disabled = false));
});
// Some touch browsers suppress the first compatibility click after canvas capture.
// A short pointer-up fallback handles an intentional tap once, without double firing.
document.addEventListener('pointerdown', (e) => {
  touchTap = null;
  if (e.pointerType === 'mouse') return;
  const el = (e.target as Element).closest<HTMLElement>('.classroom button[data-action]');
  touchTap =
    el && !el.hasAttribute('disabled')
      ? {
          el,
          x: e.clientX,
          y: e.clientY,
          pointerId: e.pointerId,
          handled: false,
          fallback: false,
          at: Date.now(),
        }
      : null;
});
document.addEventListener('pointercancel', () => {
  touchTap = null;
});
document.addEventListener('pointerup', (e) => {
  const tap = touchTap;
  if (!tap || e.pointerId !== tap.pointerId) return;
  if (
    Date.now() - tap.at > 800 ||
    (e.target as Element).closest('.classroom button[data-action]') !== tap.el ||
    Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 12
  ) {
    touchTap = null;
    return;
  }
  setTimeout(() => {
    if (
      touchTap === tap &&
      !tap.handled &&
      tap.el.isConnected &&
      !tap.el.hasAttribute('disabled')
    ) {
      tap.fallback = true;
      tap.el.click();
    }
  }, 40);
});
document.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id === 'short-answer') draft = el.value;
  if (el.id === 'pen-color') {
    color = el.value;
    if (board) board.color = color;
  }
});
document.addEventListener('submit', (e) => {
  const form = e.target as HTMLFormElement;
  if (!['login-form', 'start-form', 'class-form'].includes(form.id)) return;
  e.preventDefault();
  if (formBusy) return;
  formBusy = true;
  const data = new FormData(form),
    submit = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
  submit.disabled = true;
  void (async () => {
    if (form.id === 'login-form') {
      const result = await api('/login', 'POST', {
        role: form.dataset.role,
        email: data.get('email'),
        password: data.get('password'),
        classCode: data.get('classCode'),
        seat: Number(data.get('seat')),
        code: data.get('code'),
      });
      user = result.user;
      const requestedClass = new URLSearchParams(location.search).get('class');
      if (requestedClass) history.replaceState(null, '', location.pathname + location.hash);
      navigate(user!.role === 'teacher' ? '/dashboard' : '/student');
    }
    if (form.id === 'start-form') {
      const result = await api('/sessions', 'POST', {
        lessonId: form.dataset.lesson,
        classId: data.get('classId'),
      });
      closeModal();
      navigate(`/session/${result.session.id}`);
    }
    if (form.id === 'class-form') {
      const result = await api('/classes', 'POST', {
        name: data.get('name'),
        seats: Number(data.get('seats')),
      });
      closeModal();
      download(`${result.classroom.code}-credentials.json`, JSON.stringify(result, null, 2));
      toast('班級已建立，識別碼檔案已下載。');
      await renderRoute();
    }
  })()
    .catch((e) => {
      const error = form.querySelector('#login-error');
      if (error) error.textContent = e.message;
      else toast(e.message, true);
    })
    .finally(() => {
      formBusy = false;
      submit.disabled = false;
    });
});
window.addEventListener('hashchange', () => void renderRoute());
window.addEventListener('online', () => {
  void refreshSession();
  void retryPending();
});
window.addEventListener('message', (e) => {
  const frame = document.querySelector<HTMLIFrameElement>('#custom-activity');
  if (!frame || e.source !== frame.contentWindow || !view || !e.data || typeof e.data !== 'object')
    return;
  const a = view.lesson.slides[view.session.slideIndex]?.activity;
  if (!a) return;
  if (e.data.type === 'health-classroom:ready') {
    frame.contentWindow?.postMessage(
      {
        type: 'health-classroom:state',
        activityId: a.id,
        open:
          view.session.activityOpen &&
          (user?.role === 'teacher' ||
            view.session.followTeacher ||
            studentSlide === view.session.slideIndex),
        role: user?.role,
      },
      '*',
    );
  }
  if (
    e.data.type === 'health-classroom:submit' &&
    user?.role === 'student' &&
    e.data.activityId === a.id &&
    view.session.activityOpen &&
    (view.session.followTeacher || studentSlide === view.session.slideIndex)
  )
    void submitAnswer(e.data.value).catch((err) => toast(err.message, true));
});
document.addEventListener('keydown', (e) => {
  const dialog = document.querySelector<HTMLElement>('.modal');
  if (dialog) {
    if (e.key === 'Escape') closeModal();
    if (e.key === 'Tab') {
      const items = Array.from(
        dialog.querySelectorAll<HTMLElement>('button,input,select,textarea,[tabindex="0"]'),
      ).filter((x) => !(x as HTMLButtonElement).disabled);
      const first = items[0],
        last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    return;
  }
  if ((e.target as HTMLElement).matches('input,textarea,select') || !view) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const next = document.querySelector<HTMLElement>(
      `[data-action="${e.key === 'ArrowRight' ? 'next-slide' : 'prev-slide'}"]`,
    );
    if (next && !next.hasAttribute('disabled')) {
      e.preventDefault();
      next.click();
    }
  }
});
async function boot() {
  try {
    config = await api<AppConfig>('/config');
    user = (await api<{ user: User | null }>('/me')).user;
    await renderRoute();
    const classCode = new URLSearchParams(location.search).get('class');
    if (!user && classCode) {
      landing('student');
      const input = document.querySelector<HTMLInputElement>('[name="classCode"]');
      if (input) input.value = classCode;
    }
  } catch (e) {
    app.className = 'boot-error';
    app.innerHTML = `${brand()}<h1>課堂服務尚未就緒。</h1><p>${esc((e as Error).message)}</p><p>請依 README 啟動本機服務，或檢查部署設定。</p>${btn('重新連線', 'reload', 'primary', 'arrow')}`;
    document
      .querySelector('[data-action="reload"]')
      ?.addEventListener('click', () => location.reload());
  }
}
void boot();
