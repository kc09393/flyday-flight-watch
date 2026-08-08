# Flyday 機票智慧監控

Flyday 是手機優先的機票巡價 PWA。網站由 GitHub Pages 提供，GitHub Actions 每天透過 SerpApi Google Flights API 查詢真實價格；達到目標價或低於近期平均 10% 時，可建立 GitHub Issue，並選擇發送 LINE 或 Email。

## 已完成

- 可安裝到手機主畫面的 PWA 與離線外殼
- 桌機／手機響應式介面
- 監控條件、目標價與歷史價格資料格式
- SerpApi Google Flights API 整合
- 每天自動巡價的 GitHub Actions
- 目標價、近期平均與跌幅判斷
- GitHub Issue、LINE Messaging API、Resend Email 通知
- 選用 OpenAI Responses API 產生依據真實數字的簡短建議
- GitHub Pages 自動更新最新價格

## 必要 GitHub Secrets

到 Repository → Settings → Secrets and variables → Actions 新增：

- `SERPAPI_API_KEY`

通知管道至少選一個：

- GitHub Issue：不用設定，使用 Actions 內建的 `GITHUB_TOKEN`
- LINE：`LINE_CHANNEL_ACCESS_TOKEN`、`LINE_USER_ID`
- Email：`RESEND_API_KEY`、`ALERT_EMAIL`

選用 AI：

- `OPENAI_API_KEY`
- Repository variable `OPENAI_MODEL`，預設為 `gpt-5.6-terra`

所有 API 金鑰只放在 GitHub Secrets，不可寫入前端或提交到儲存庫。

SerpApi 免費方案每月 250 次搜尋且限非商業用途。預設每日執行一次、最多處理 8 條監控航線，以避免超過免費額度；正式公開或上架 App 前需改用可商業使用的方案。

## 調整監控航線

編輯 [`config/watches.json`](config/watches.json)，每條航線包含出發地、目的地、日期與目標價格。修改後可在 Actions 頁手動執行 `Flight price monitor`，之後會按照排程自動更新。

## 本機預覽

```powershell
node server.js
```

然後開啟 `http://127.0.0.1:4173`。
