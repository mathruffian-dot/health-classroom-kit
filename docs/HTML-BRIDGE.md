# 自訂 HTML 互動接口

`slide.customHtml` 可承載一個 HTML 互動片段。框架透過經過身分驗證的 HTML 端點提供完整頁面，它在 `iframe` 中執行，使用 `sandbox="allow-scripts"`，不含 `allow-same-origin`。

內容安全政策預設為 `default-src 'none'`，允許內嵌 script、style 與 data 圖片；不允許遠端腳本、API 連線、表單提交或任意跳頁。把必要 HTML／CSS／JavaScript 寫在同一份內容中。

## 事件契約

| 方向 | 事件 | 資料 |
| --- | --- | --- |
| iframe → host | `health-classroom:ready` | 無其他必要欄位 |
| host → iframe | `health-classroom:state` | `activityId`、`open`、`role` |
| iframe → host | `health-classroom:submit` | `activityId`、`value` |

`value` 必須符合該頁 `activity.type` 的原生答案格式。框架檢查訊息的 `event.source`、目前 iframe、活動 ID、學生角色及開题狀態，再透過正常 API 送出。後端仍做完整驗證。

此橋接不傳 cookie、token、金鑰、其他學生答案或教師備註，也不提供 iframe 直接呼叫 AI 的能力。AI 由教師介面發起。

**`customHtml` 的 HTML／JavaScript 會送到學生瀏覽器，學生可以讀取原始碼。** 不可在其中放正解、教師私密備註或任何秘密；只有結構化 `notes`、`activity.correct` 等欄位受伺服器角色過濾。

## 最小互動頁

以下適用於 `activity.id = "observe-choice"`、`type = "single"`、至少有兩個選項的投影片。

```html
<style>
  body { font: 18px system-ui; padding: 1rem; color: #173c37; }
  button { min-height: 48px; padding: 12px 18px; margin: 8px; }
</style>
<h2>你會先做哪一步？</h2>
<p id="status" role="status">等待老師開放活動</p>
<button disabled data-value="0">追查原始出處</button>
<button disabled data-value="1">只看按讚數</button>
<script>
  let classroomState = { activityId: null, open: false, role: null };
  addEventListener('message', (event) => {
    if (event.source !== parent) return;
    if (event.data?.type !== 'health-classroom:state') return;
    classroomState = event.data;
    const enabled = classroomState.open && classroomState.role === 'student';
    document.querySelectorAll('button').forEach((button) => {
      button.disabled = !enabled;
    });
    document.querySelector('#status').textContent = enabled
      ? '活動開放，可以作答' : '等待老師開放活動';
  });
  document.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => {
      if (!classroomState.open || classroomState.role !== 'student') return;
      parent.postMessage({
        type: 'health-classroom:submit',
        activityId: 'observe-choice',
        value: Number(button.dataset.value)
      }, '*');
    });
  });
  parent.postMessage({ type: 'health-classroom:ready' }, '*');
</script>
```

此 iframe 使用不透明來源，範例使用 `'*'` 作為訊息目的來源；安全邊界是固定 parent、接收端 `event.source` 核驗、最小資料與伺服器權限驗證，不能只依訊息名稱信任任意發送者。不要把機密資料加入此通道。

## 擴充界線

- 自訂 HTML 不等於新的資料模型；它提交的是已有的四種答案。
- 要保存拖曳歷程、圖形座標或多步解題，需擴充型別、schema、後端驗證、資料保存、匯出與測試。
- UI 顯示「已點擊」不代表儲存成功；以框架作答狀態為準。
- 教師、投影與學生角色都可能呈現同一段 HTML。請依 `role` 和 `open` 顯示狀態。
- 嵌入內容不可直接加入正解，否則學生可閱讀原始碼。正解放原生 `activity.correct`。
- 對自訂 HTML 的隔離測試與正式雲端安全稽核是不同層級；框架不是任意惡意程式的執行服務。
