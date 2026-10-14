# 部署到自己的 Cloudflare ＋ Supabase

本專案預設提供本機 demo。正式環境使用 **Cloudflare Worker＋靜態資產＋Durable Object**，搭配 **Supabase Auth 與 Postgres**。AI 是可選功能。

此文件描述專案部署方法；公開原始碼不代表已替你建立服務。請依 [驗收紀錄](VALIDATION.md) 區分本機已測與雲端待測。首次部署先用虛構班級與測試答案。

**建議直接讓 agent 接手。** 使用者完成 Supabase 官方 OAuth、選定專案與教師信箱，再登入自己的 Cloudflare；agent 接手下列建置、設定與驗收。[最簡設定流程](SUPABASE-AGENT-SETUP.md) 包含可做／需本人操作的分工，[完整部署提示詞](AGENT-PROMPTS.md#提示詞二設定並部署到自己的帳號) 可直接貼上。本文件的 CLI 與 SQL 細節供 agent 執行及維護者查閱。

## 1. 先在本機跑通

使用 Node.js 22.12+，在專案根目錄執行：

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:e2e
npm run dev
```

開啟 http://127.0.0.1:8787。驗證教師和獨立學生瀏覽器可以完成開課、作答與匯出。測試過程不必填任何真實金鑰。

## 2. 建立 Supabase 專案

1. 使用者在 agent 客戶端連接 Supabase，於官方瀏覽器畫面完成 OAuth。Agent 確認目標專案；已有專案就沿用，沒有專案才先確認組織、區域及費用再建立。選定後盡量將 MCP 限定於該專案。
2. Agent 檢查遠端 migration 紀錄與資料表，透過 `apply_migration` 套用 [`20261014002627_classroom_framework.sql`](../supabase/migrations/20261014002627_classroom_framework.sql)，已套用則驗證後略過。現有專案先檢查衝突及備份；不能只因檔名不同就重複執行。沒有 MCP 時，才使用已授權 CLI；SQL Editor 是最後的手動替代。
3. Agent 取得專案 HTTPS URL 與 publishable key，自動填入 Worker 設定。Server-side secret key 透過安全通道送進 Cloudflare Secret；MCP 不提供此 key，必要時由本人在 Cloudflare 介面輸入一次。不要把 key 印在聊天、日誌、`VITE_*` 變數或課程 JSON。
4. Agent 檢查教師 Auth 帳號與登入設定。現有 MCP 沒有 Auth 使用者管理工具；若需要建立帳號，透過已授權 Dashboard／Admin API 處理，或只引導本人完成該步，密碼由本人安全設定。不得直接往 `auth.users` 插入資料。專用新專案建議關閉公開註冊；共用專案保留其他應用需求。
5. Agent 將教師信箱加入 Worker 的 `TEACHER_EMAILS`。Supabase 管理帳號的 OAuth 不會自動建立課堂教師身分；只有成功通過 Supabase Auth **且在允許名單中**的帳號才有教師權限。

publishable key 與 secret key 用途不同；後者有較高權限，只能放伺服器端。[Supabase API key 說明](https://supabase.com/docs/guides/getting-started/api-keys)

本版將課堂資料放在 `classroom_state` 的 JSON snapshot，由 Worker 以私密 key 操作；資料表不開放學生或匿名前端直接讀取。教師、班級與作答隔離由 Worker 執行。它適合小型單一部署；不是跨校多租戶資料平台。

Supabase 原生 Realtime 與 Storage 並未在本版接通，不必為了啟動框架開放資料表 Realtime publication 或建立公開 bucket。[官方 RLS 說明](https://supabase.com/docs/guides/database/postgres/row-level-security)

## 3. 設定 Cloudflare

先確認本機 Wrangler 指令與帳號：

```sh
npx wrangler --help
npx wrangler login
npx wrangler whoami
```

編輯根目錄 `wrangler.jsonc`，將 Worker `name` 改為自己的站名，保留程式提供的 assets、Durable Object binding 及 migration 設定。將 `vars` 調整為正式環境：

```json
{
  "APP_MODE": "supabase",
  "ALLOW_PUBLIC_DEMO": "false",
  "APP_INSTANCE": "default",
  "SUPABASE_URL": "https://YOUR_PROJECT.supabase.co",
  "SUPABASE_PUBLISHABLE_KEY": "YOUR_PUBLISHABLE_KEY",
  "TEACHER_EMAILS": "teacher@example.org",
  "AI_BASE_URL": "https://api.openai.com/v1",
  "AI_MODEL": "YOUR_COMPATIBLE_MODEL",
  "AI_DAILY_LIMIT": "20"
}
```

這是 `vars` 內容，**不要用它取代整份 Wrangler 設定**。`teacher@example.org` 是文件佔位符，改為自己的教師帳號。`APP_INSTANCE` 是資料集合識別；正式使用後不要隨意更改。不同部署若使用同一個 Supabase，應使用不同 instance，並了解共同持有 secret key 的部署仍具有資料庫權限。

| 設定                       | 位置         | 用途                                                               |
| -------------------------- | ------------ | ------------------------------------------------------------------ |
| `APP_MODE`                 | vars         | 正式部署填 `supabase`；本機示範填 `demo`                           |
| `ALLOW_PUBLIC_DEMO`        | vars         | 正式部署維持 `false`                                               |
| `APP_INSTANCE`             | vars         | 此部署使用的資料集合，預設 `default`                               |
| `SUPABASE_URL`             | vars         | 專案 HTTPS origin                                                  |
| `SUPABASE_PUBLISHABLE_KEY` | vars         | Supabase Auth 使用的公開連線 key                                   |
| `TEACHER_EMAILS`           | vars         | 以逗號分隔的教師電子郵件允許名單                                   |
| `SESSION_SECRET`           | Secret       | 至少 32 字元的強隨機值，用於簽署登入狀態                           |
| `SUPABASE_SECRET_KEY`      | Secret       | 伺服器專用 secret key；可相容舊 service-role JWT                   |
| `AI_API_KEY`               | Secret，選填 | AI 服務 key                                                        |
| `AI_BASE_URL`              | vars，選填   | OpenAI 相容 API 基底網址，包含 `/v1` 等必要路徑                    |
| `AI_MODEL`                 | vars，選填   | 該供應商確實支援的模型名稱                                         |
| `AI_DAILY_LIMIT`           | vars         | 每位教師每 UTC 日 AI 呼叫次數，預設 20；失敗也計次，不等於費用上限 |

以互動方式加入 Secrets，不要把值直接寫在指令裡：

```sh
npx wrangler secret put SESSION_SECRET
npx wrangler secret put SUPABASE_SECRET_KEY
```

新部署的 `SESSION_SECRET` 可由 agent 在本機封閉程序中用密碼學安全亂數產生，直接傳入 Wrangler stdin，只回報設定結果；或由本人用密碼管理器產生並在安全介面輸入。既有部署沿用原值，不能每次部署重新生成。不要透過聊天或會回傳給模型的終端輸入秘密；若客戶端沒有私人終端，使用 Cloudflare Dashboard 的 Secret 輸入欄。若要 AI，再執行：

```sh
npx wrangler secret put AI_API_KEY
```

未設定 AI key 時，分析入口顯示模擬結果。設定真實 key 後，呼叫的是你指定服務的 `/chat/completions`；供應商必須相容該格式。不能只改網址就保證任意 AI API 可用。

`SESSION_SECRET` 同時參與學生識別碼驗證。輪替後既有登入失效，學生也需重發識別碼；請安排在下課時進行，並確認重新登入流程。

本機測試正式服務時可複製 `.dev.vars.example` 為 `.dev.vars`，僅在本機填值。確認 `.dev.vars` 被 Git 忽略，且不會被附進問題回報或下載包。[Cloudflare Secrets 官方說明](https://developers.cloudflare.com/workers/configuration/secrets/)

## 4. 部署

```sh
npm run deploy
```

記錄 Wrangler 回傳的 HTTPS 網址。Cloudflare Workers 同一次部署提供 `dist/` 靜態資產和 API；本專案不是只上傳 HTML 到 GitHub Pages。[Cloudflare 靜態資產說明](https://developers.cloudflare.com/workers/static-assets/)

若 CLI 首次建立 Worker 時要求確認名稱或帳號，核對目標是自己的專案。若先執行 Secrets 指令建立 Worker，後續仍以這個 Worker 名称部署。

## 5. 部署後驗收

- 讀取 `/api/config`，確認 `mode` 為 `supabase`。
- 教師以 Supabase 帳號登入，建立測試班級，保存首次顯示的學生識別碼。
- 從班級頁顯示學生入口 QR Code，確認編碼的是正式 HTTPS 網址；用 iPad 掃描後可進入該班登入畫面。
- 使用兩個獨立瀏覽器登入不同學生，完成開題、提交、揭露統計與重新整理。
- 確認另一班的學生不能讀取此場次、學生不能呼叫教師 API。
- 教師登出／重新登入後，課程、場次及答案仍存在。
- 讓兩位學生幾乎同時搶答，只接受一位勝出者；時間依後端接受順序。
- 匯出課程、作答與備份；在獨立測試環境驗證還原，不直接覆寫正式課堂。
- AI 先用虛構內容測一次；關閉或使 AI 失敗時，正常授課仍可繼續。
- 實際拿教師大觸控螢幕及學生 iPad 測試，見 [裝置清單](DEVICE-CHECKLIST.md)。

服務帳號、方案配額與網路會影響表現。1 位教師＋40 位學生是驗收目標；應以自己的教室 Wi-Fi 實測，不能從本機測試推定負載能力。

## 常見問題

| 現象                              | 檢查                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| localhost 無法開啟                | `npm run dev` 是否仍執行；8787 是否被其他服務佔用                                            |
| 改了 HTML／CSS 沒生效             | 開發指令會先 build，再啟動 Worker；重新啟動後再刷新                                          |
| 師生登入互相覆蓋                  | 同一瀏覽器分頁共用 cookie；改用獨立瀏覽器工作階段                                            |
| 正式網站拒絕 demo                 | 這是預期保護；正式部署設定 `APP_MODE=supabase` 並補齊服務設定                                |
| 已登入 Supabase 但 agent 沒有工具 | Dashboard 登入與 MCP 授權不同；在 agent 客戶端完成 Connect／Authenticate，必要時重新載入工具 |
| MCP 能查詢卻不能建表              | 檢查指定專案、資料庫寫入權限、`read_only` 與 `database` 工具群；正式唯讀維護連線應保留唯讀   |
| OAuth 完成卻還需要輸入 key        | MCP 管理授權不等於 Worker 的 server secret；只在受保護介面輸入，不貼聊天                     |
| 教師密碼正確仍登入失敗            | Auth 使用者是否確認、`TEACHER_EMAILS` 是否包含該信箱、Supabase URL/key 是否屬同專案          |
| Supabase 讀寫失敗                 | SQL 是否執行成功、secret key 是否正確、Data API 是否啟用、表及 RPC 權限是否保留              |
| 學生等待課堂                      | 班級是否正確、教師是否為該班開啟未結束場次                                                   |
| iPad 掃碼無法開啟                 | QR Code 是否仍是 `127.0.0.1`／`localhost`；本機網址不能跨裝置，需使用正式部署網址            |
| 還原後學生不能登入                | 新匯入班級沒有可用識別碼；在班級頁依座號重發後個別交付                                       |
| 備份大小合格卻還原失敗            | 還原請求上限 9 MiB，合併後整體 snapshot 仍受 8 MiB 上限限制                                  |
| 送出被拒絕                        | 教師是否已關題／換頁、場次是否結束；先重新整理狀態                                           |
| AI 仍為模擬                       | 部署的 `AI_API_KEY` 是否存在，是否部署到另一個 Worker 名稱                                   |
| AI 呼叫失敗                       | base URL、模型、供應商 chat/completions 相容性、key 額度與每日次數限制                       |
| iPad 回來後頁面落後               | 從背景喚回、重新連線，等待同步；仍異常時重新整理並核對保存狀態                               |

平台管理介面可能改版，設定名稱以程式與官方文件為準。本文件依 2026-10-14 可取得的官方文件核對；本次未替部署者執行真實雲端建置。
