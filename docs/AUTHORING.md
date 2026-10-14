# 教材格式與填課方式

格式來源是 [`shared/types.ts`](../shared/types.ts) 與 [`lesson.schema.json`](../schemas/lesson.schema.json)。課程匯入後仍由後端驗證，不能靠前端 JSON 編輯器繞過限制。

## 最小可用課程

```json
{
  "schemaVersion": 1,
  "id": "my-health-lesson",
  "title": "資訊判讀練習",
  "description": "以虛構情境練習閱讀資訊與說明理由。",
  "subject": "健康教育",
  "duration": 45,
  "objectives": ["能說明判讀資訊前要確認的線索"],
  "slides": [
    {
      "id": "observe",
      "title": "先觀察，再判斷",
      "eyebrow": "情境練習",
      "body": "小禾看到一則沒有標明出處的健康貼文。他可以先做什麼？",
      "bullets": ["看看作者與出處", "確認發布時間", "比較可靠來源"],
      "visual": "cards",
      "source": "本專案虛構示範；正式內容請由教師依教材核對。",
      "notes": "這是資訊判讀示範，不評估學生個人健康狀況。",
      "activity": {
        "id": "observe-choice",
        "type": "single",
        "prompt": "哪個行動最能幫助小禾確認資訊來源？",
        "options": ["追查原始出處", "只看按讚數", "先轉傳給全班"],
        "correct": [0],
        "explanation": "原始出處能提供後續核對的線索。",
        "sensitive": false,
        "aiAllowed": false
      }
    }
  ]
}
```

## 欄位對照

| 層級 | 必填 | 選填 |
| --- | --- | --- |
| 課程 | `schemaVersion`、`id`、`title`、`description`、`subject`、`duration`、`objectives`、`slides` | `updatedAt` |
| 投影片 | `id`、`title`、`body` | `eyebrow`、`bullets`、`visual`、`activity`、`notes`、`source`、`customHtml` |
| 活動 | `id`、`type`、`prompt` | `options`、`correct`、`min`、`max`、`minLabel`、`maxLabel`、`explanation`、`sensitive`、`aiAllowed` |

`visual` 接受 `balance`、`steps`、`cards`、`bars`，選擇適合教學結構的樣式。`duration` 為分鐘。`source` 可記錄書名、版次、頁碼或公開網址；網頁只顯示引用文字，不保證已查核來源。

| 活動型別 | 設定 | 提交值 |
| --- | --- | --- |
| `single` | `options`；需要標準答案時設 `correct: [索引]` | 單一數字，例如 `0` |
| `multiple` | `options`；需要標準答案時設 `correct: [索引, 索引]` | 索引陣列，例如 `[0, 2]` |
| `scale` | `min`、`max`；可設 `minLabel`、`maxLabel` | 範圍內數字 |
| `short` | 開放式 `prompt` | 字串 |

選項索引從 **0** 開始。單選與多選也可作為沒有標準答案的意見調查；量尺不應把個人態度自動判成對錯。`sensitive` 用於敏感題提示與 AI 排除，`aiAllowed` 只表示此活動是否允許納入教師 AI 摘要，仍受後端限制。

## 設計與版本

1. 一頁聚焦一個操作或一個討論問題；內容多時拆頁。
2. 用虛構角色、情境和答案展示功能；正式健康知識需教師核對教材與來源。
3. 短答避免誘導學生填姓名、電話、疾病或其他私密資料。敏感題保留跳過方式。
4. 教師備註與正解放在對應欄位，不藏在 `body`、`customHtml` 或公開素材中。
5. 同一課程中投影片 ID 與活動 ID 不重複。修改既有題意時換活動 ID。
6. 開課時建立課程快照；修改課程後，既有場次使用原版本，新場次才使用新版。

## 匯入與分享

教師介面匯入課程 JSON；檢查標題、目標、各頁內容、選項及答案後儲存。匯出課程 JSON 適合分享教材，**不包含學生作答**。作答匯出與教師完整備份是另一種資料，詳見 [備份說明](BACKUP.md)。

課程匯入檔案約以 1 MiB 為限，且受各欄位與最多 60 頁的限制。大量內嵌圖片／HTML 可能超限；將教材拆成適合一堂課的單元。`bars` 的內建數字是版型示意，不能當作健康統計或學生真實數據；真實作答分布使用 IRS 統計。

自訂圖像、影片及可執行視覺化可透過擴充框架加入。本版沒有完整素材上傳／Storage 管理介面；`customHtml` 預設禁止網路，可使用內嵌 SVG、Canvas 或 data URL 圖片。[HTML bridge 規格](HTML-BRIDGE.md)
