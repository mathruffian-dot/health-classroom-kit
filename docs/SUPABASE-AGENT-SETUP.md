# 登入授權後，交給 Agent 完成設定

建議由使用者完成帳號授權與秘密輸入，再讓 Agent 接手建表、設定、部署及驗收。使用者不必自行貼 SQL 或逐項修改程式。這份文件是操作流程；新增文件並不代表已連接或部署任何人的雲端專案。

可直接搭配 [部署提示詞](AGENT-PROMPTS.md#提示詞二設定並部署到自己的帳號) 使用，詳細設定名稱見 [部署說明](DEPLOYMENT.md)。

## 使用者主要完成三件事

1. **在使用的 Agent 工具內連接 Supabase，完成瀏覽器 OAuth 授權。** 授權成功後回到 Agent；只有在 Supabase 網站登入，未必已授權該 Agent。已連接成功時不用重做。官方 Hosted MCP 支援 OAuth，不必為這條路徑另外提供 PAT。[Supabase MCP](https://supabase.com/docs/guides/ai-tools/mcp)
2. **指定部署目標與教師信箱，完成 Cloudflare 登入。** 告知要用哪個 Supabase 專案、站名、教師 email；尚無專案時提供要建立的組織與區域。Agent 可引導 Cloudflare 登入。帳號密碼與 MFA 由使用者在服務本身的安全畫面輸入；首次建立課堂教師帳號時，也由使用者在 Auth 管理介面設定密碼。
3. **只有缺少伺服器秘密時，完成一次安全輸入。** Agent 指出確切服務、Worker 名稱和 Secret 名稱，使用者把 Supabase server secret 直接存入 Cloudflare Secret；不要貼回聊天。已有正確 Secret 或已有受授權的安全 CLI 傳遞管道時，可以略過。AI key 為選用，不影響先完成部署。

「管理 Supabase 的 OAuth 授權」與「登入課堂的教師帳號」是兩件事。本框架的教師登入仍使用該專案的 **Supabase Auth email／密碼，加上 `TEACHER_EMAILS` 允許名單**。學生維持班級、座號、識別碼登入，不需要 Supabase 管理帳號。

## Agent 接手程序

### 1. 確認工具與授權目標

先讀 `AGENTS.md`、本文件、`DEPLOYMENT.md`、`SECURITY.md` 及實際程式。列出當前可用的 Supabase 工具；不同 Agent 客戶端、連接器與權限的工具可能不同。既有授權足以涵蓋的步驟繼續執行，不要逐項要求使用者重複批准。

對已有專案，核對 project ref、名稱與使用者指定的目標。可設定自訂 MCP 的客戶端，使用下列 URL 限定專案與必要工具群組，將佔位符換成真實 project ref：

```text
https://mcp.supabase.com/mcp?project_ref=YOUR_PROJECT_REF&features=database,debugging,development,docs
```

專案附有 [`.mcp.json.example`](../.mcp.json.example)，供 Claude Code 等支援 `mcpServers` JSON 格式的客戶端使用：由 Agent 複製為 `.mcp.json`、替換 project ref，再由使用者完成客戶端的 Authenticate。若已有 `.mcp.json`，只合併 Supabase 項目，不覆蓋其他服務。`.mcp.json` 已排除 Git；範本不含 token，複製後不會自動完成授權。其他客戶端使用各自的 MCP 連線設定；已有可用 Supabase connector 時不必另建連線。

專案限定模式會停用帳號層級的列舉／建專案工具。若尚不知道 project ref，先從使用者提供的專案連結取得，或在具帳號權限的連線選定目標，再限定專案。不要因列舉工具不存在就另建重複專案。`read_only=true` 適合診斷，不能執行建表；實際初始化須有目標專案的寫入授權。[MCP 設定](https://supabase.com/docs/guides/ai-tools/mcp#configuration-options)

尚無專案時，依 `create_project` 等實際工具要求選擇組織、查明費用並完成必要確認；OAuth 登入本身不代表同意新增付費資源。不假設免費額度或指定區域一定可用。若選擇既有含資料專案，先盤點相關 schema，依 [備份說明](BACKUP.md) 準備回復方式，不修改無關服務。

### 2. 建立資料結構並檢查權限

先執行 `list_migrations` 並檢查現有 `classroom_state`、RPC 定義與權限，避免重複套用或覆蓋同名但不同用途的物件。

對遠端目標，以 `apply_migration` 套用專案既有的 [`20261014002627_classroom_framework.sql`](../supabase/migrations/20261014002627_classroom_framework.sql)。已套用且結構一致則跳過；有衝突時先完成差異檢查與可審閱的修正，不使用 reset、drop 或清空資料解決。不要為部署重建一份語意不同的初始化 SQL。

完成後使用唯讀查詢與 advisors 核對：

- `public.classroom_state` 的欄位與約束符合 migration，且 RLS 已開啟。
- `anon`、`authenticated` 與 `PUBLIC` 都沒有資料表讀寫及 RPC 執行權限。
- `service_role` 具有資料表的 SELECT／INSERT／UPDATE／DELETE，及 `classroom_compare_and_swap(text,bigint,jsonb)` 的 EXECUTE。
- RPC 維持 `SECURITY INVOKER` 與固定空 search path；不為修補權限錯誤改成 `SECURITY DEFINER`。
- Data API 已啟用且能解析對應表／函式。不得以對學生開放表存取來修復 Worker 連線。

本框架由 Worker 以伺服器 key 操作 snapshot，學生與教師都不直接讀資料表。新式 secret key 對應 `service_role`，仍須有正確 GRANT；只確認 RLS 存在不足以證明服務可用。[Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)

### 3. 取得設定，安全處理秘密與教師帳號

| 項目              | Agent 的處理方式                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| Supabase URL      | 使用 `get_project_url`，確認是選定專案的 HTTPS origin                                                            |
| Publishable key   | 使用 `get_publishable_keys`，選擇未停用的新式 publishable key                                                    |
| Server secret key | MCP 的公開 key 工具不提供此值；沿用既有 Cloudflare Secret，或走下方安全輸入／CLI 路徑                            |
| 教師帳號          | MCP 不提供一般 Auth 使用者管理工具；使用者在 Dashboard 建立或確認帳號，必要時使用已有授權的伺服器 Admin API 流程 |
| `TEACHER_EMAILS`  | 設定使用者指定的教師信箱；不能把任意登入者自動提升成教師                                                         |
| `SESSION_SECRET`  | 首次部署產生強隨機值並直接存入 Secret；後續部署保留既有值                                                        |

最通用的秘密輸入路徑是：使用者從 Supabase 的 API Keys 頁取得 server secret，直接存入 **目標 Cloudflare Worker 的 `SUPABASE_SECRET_KEY` Secret**。Agent 只核對 Secret 名稱存在及功能測試結果，不要求回傳值。也可讓使用者在自己控制的互動終端執行 `npx wrangler secret put SUPABASE_SECRET_KEY`，依提示輸入。不要把值當命令參數。[Cloudflare Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

若使用者已授權且登入 Supabase CLI，可考慮本機程序取得 key 後直接傳給 Wrangler 的安全 stdin。先查實際 CLI 的 `--help`、支援格式及 key 是否存在；MCP OAuth 不保證 CLI 同時登入。程序只回報是否成功，不把 key 印到 stdout／日誌、寫入明文暫存檔或傳進模型內容；不要擷取瀏覽器 cookie、OAuth token 或客戶端憑證來繞過登入。未具備這條管道時，使用上段一次安全輸入即可。[CLI API keys](https://supabase.com/docs/reference/cli/supabase-projects-api-keys)

教師密碼只由使用者在受控安全畫面輸入。不要直接以 SQL 插入 `auth.users`；需要程式化建立時，使用正式 Auth Admin API 並保持秘密、密碼不進入聊天或日誌。OAuth 的 Supabase 管理信箱不能視為已存在的課堂教師帳號。確認 Auth 帳號可用且 email 在允許名單中，並依使用範圍關閉公開註冊。

`SESSION_SECRET` 同時影響學生識別碼，重新執行設定不得自動輪替；否則既有登入與學生代碼會失效。AI key 先略過即可，核心授課不依賴 AI。

### 4. 完成 Cloudflare 部署

由 Agent 完成登入檢查、設定與部署，保留專案提供的 assets、Durable Object binding 及 migration。設定 `APP_MODE=supabase`、`ALLOW_PUBLIC_DEMO=false`、正確 URL／publishable key、`TEACHER_EMAILS` 與固定 `APP_INSTANCE`。只修改確定的目標 Worker；不要把另一個站點的秘密或資料集合直接套用。

執行 [部署說明](DEPLOYMENT.md) 的本機檢查與部署指令。正式設定不足時保留可用的本機示範，報告缺漏；不要將正式站自動降級成公開 demo。

### 5. 驗證後交付

Agent 在部署的 HTTPS 網址驗證 `/api/config` 為 `supabase`，再以教師及獨立學生工作階段完成登入、建班、開題、作答、揭露、重新整理與登出重登。確認答案持續保存、其他班級與他人答案不可讀、學生不可呼叫教師 API；至少以兩位學生驗證搶答只產生一名勝出者。檢查 QR Code 指向正式網址。

完成課程／作答匯出與白板保存；還原只在獨立測試環境驗證。從資料庫核對專案指定 instance 的 revision 確實遞增，不需讀出整班答案供模型檢視。觸控大屏與真實 iPad 的驗收依 [裝置清單](DEVICE-CHECKLIST.md) 進行；瀏覽器模擬不能取代實機結果。

交付正式網址、非秘密的專案／Worker 識別、完成項目、實測結果、未完成項目及回復方式，更新 `VALIDATION.md`。只有工具連線、SQL 成功或本機測試通過時，要如實標成該階段完成；若缺少 Secret、Auth 帳號、Cloudflare 登入或實機，列出唯一仍需使用者完成的動作，不宣稱端到端部署已驗證。

本流程於 2026-10-14 依官方文件及本專案程式核對。服務工具與介面可能更新；執行時以當前工具能力、官方文件與實測為準。
