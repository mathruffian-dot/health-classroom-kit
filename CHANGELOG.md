# 版本紀錄

## 0.1.1 — 2026-10-14

- 將建置流程改以「使用者 OAuth 登入授權，agent 接手 Supabase 設定」為優先方式。
- 新增最簡設定指南、專案限定 MCP 範本、README 短提示詞與完整部署接手提示詞。
- 說明 MCP／CLI／Cloudflare 的授權差異、server secret 安全傳遞、教師 Auth 帳號與允許名單。
- 補上 migration 重跑檢查、沿用既有 session secret、實際完成狀態與未驗證邊界。
- 本次為文件與設定範本更新，未替取用者建立雲端專案；授課互動及資料契約不變。

## 0.1.0 — 2026-10-14

首個可運作框架版本，介面名稱為「青禾課堂」。

- 教師工作台、學生作答介面、大螢幕授課模式與平板版面。
- 七頁原創虛構情境示範、四種 IRS 活動、隔離的 HTML 擴充模組。
- 課程 JSON 匯入／編輯／匯出、班級與識別碼、QR Code 學生入口。
- 場次快照、作答去重、筆跡保存、CSV／JSON 匯出及教師備份還原。
- 觸控畫筆、橡皮擦、復原／重做、雷射筆、聚光燈、抽籤與後端裁決搶答。
- 斷線作答重送、每 2 秒課堂同步、大屏隱藏個別短答及教師備註。
- Cloudflare Worker／Durable Object 與 Supabase 儲存／Auth 接口，服務由使用者自行設定。
- 可選 OpenAI 相容 AI API；未設定 key 使用明示模擬回覆。
- 部署指南、agent 接手提示詞、資料格式、觸控實機驗收與公開 GitHub CI。

本機測試及模擬裝置驗證結果見 [驗收紀錄](docs/VALIDATION.md)。正式 Cloudflare／Supabase／AI、實體 iPad Safari 和觸控大屏仍須由部署者完成驗收。
