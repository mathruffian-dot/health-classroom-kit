# Agent 接手規則

此專案為繁體中文互動教學框架。目標是讓教材可替換、授課核心可離線於 AI 運作、正式資料由各部署者管理。

## 閱讀順序

1. `README.md`、`docs/VALIDATION.md`：啟動與實際驗證邊界。
2. `shared/types.ts`、`schemas/lesson.schema.json`：教材及資料契約。
3. `docs/AUTHORING.md`、`docs/HTML-BRIDGE.md`：填課及 HTML 擴充。
4. 涉及後端時讀 `docs/ARCHITECTURE.md`、`docs/SECURITY.md`、`worker/` 與 `supabase/`。
5. 需要部署時，先讀 `docs/SUPABASE-AGENT-SETUP.md` 接手授權流程，再讀 `docs/DEPLOYMENT.md` 查設定細節；不要為了填教材啟用雲端或消耗 AI 額度。

## 工作範圍

- 只填教材時，優先修改 `content/` 中的 JSON；不要為了換一堂課改寫登入、資料庫權限或 API。
- 保持 `schemaVersion: 1`，課程、投影片與活動 ID 穩定且唯一；已使用的題目語意改變時建立新 ID。
- 範例均為虛構。健康知識應附可查證來源及教材頁碼；無法核實的內容標成「待教師確認」，不可發明醫療事實或來源。
- 預設避免蒐集個人健康史等私密資訊。敏感題標 `sensitive: true` 且 `aiAllowed: false`；提供不回答的教學替代。
- `notes`、`correct`、`explanation` 不可為了便利直接送給尚未揭露結果的學生。
- 自訂 HTML 遵守 sandbox 與 bridge 契約。不要加入 `allow-same-origin`、金鑰、直接資料庫請求或跨站追蹤。
- AI key、Supabase secret／service-role key、cookie、學生識別碼與作答匯出檔不得提交 Git。
- 正式模式不得在設定或連線失敗時退回 demo；demo 不得被描述為正式身分驗證。
- 原生 Realtime、正式資料庫、真實 AI 呼叫、40 人實機課堂等，只有實際驗證才能標為通過。

## 修改與驗證

1. 先確認目前程式與設定，不靠文件猜測環境狀態。
2. 修改契約時，同步更新型別、schema、伺服器驗證、消費端、文件與相關測試。
3. 執行 `npm run check`。互動流程變更再執行 `npm run test:e2e`，並實際查看桌面及平板／手機尺寸。
4. 測試學生操作使用獨立 browser context，不能只看教師預覽就聲稱學生提交正常。
5. 對登入、跨班讀取、結果揭露、AI 傳送、備份與還原等更動，加入能抓到權限退化的測試。
6. 更新 `docs/VALIDATION.md`，清楚區分本機通過、雲端未驗證、已知限制。
7. 最後回報修改、測試、剩餘限制與可重現步驟。使用繁體中文，公開文件不含私人路徑或帳號資料。

## 部署原則

使用部署者自己的 Cloudflare 和 Supabase。遵守使用者既有授權；對已授權的部署不重複詢問。使用安全登入或秘密設定機制，不要求將金鑰貼入聊天、程式或 GitHub issue。未取得服務登入或設定時，保留可運作的本機示範，明確交付待設定項目。

預設採用「使用者在 agent 客戶端完成官方 OAuth，agent 接手建置」；不要把 SQL 操作、公開連線設定和一般驗證交回給使用者。優先重用已連線的 Supabase MCP／connector。登入 Dashboard 不代表 MCP 已連線，MCP OAuth 也不代表 CLI 或 Cloudflare 已授權。

先確認目標專案與授權範圍，再讀取 migrations 與既有結構；遠端建置使用提供的 migration，不重設資料庫、不盲目重複套用、不以新增公開 policy 解決私密表的權限問題。新建專案前取得組織選擇及平台要求的費用確認。

MCP 可取 URL 和 publishable key，不能假設它能取得 server secret 或管理 Auth 使用者。缺少工具時，只請使用者完成必要的安全介面操作，完成後繼續；不從瀏覽器、客戶端或憑證檔擷取 OAuth token。教師 Auth 密碼由本人安全設定，不能直接修改 `auth.users` 建立帳號。
