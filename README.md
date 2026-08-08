# Flyday 機票低價監控

Flyday 是手機優先、可安裝的機票巡價網站。使用者以 Email 安全連結登入後，監控清單會透過 Supabase 在手機和電腦間同步；GitHub Actions 每天透過 SerpApi Google Flights 查詢真實票價，並將私人結果寫回受 RLS 保護的資料列。

## 現有功能

- Google Flights 真實來回票價，每天約台北時間 07:17 更新
- Email magic link 登入與跨裝置同步
- 新增、編輯、刪除、暫停與恢復監控
- 三欄極簡建單：出發地、目的地、日期
- 系統建議價：先依航線與季節估算，巡價後依 Google Flights 真實區間自動校正
- 達標通知中心與瀏覽器前景通知
- 每條監控直接開啟 Google Flights
- 手機底部導覽、PWA 安裝與安全離線外殼
- Row Level Security：使用者只能讀寫自己的行程
- 相同行程共用一次 API 搜尋，節省免費查詢額度

## 系統架構

1. GitHub Pages 提供靜態 PWA。
2. Supabase Auth 使用 Email magic link 登入。
3. `flight_watches`、`watch_prices` 與 `user_preferences` 由 RLS 保護。
4. GitHub Actions 每天讀取啟用中的雲端監控，呼叫 SerpApi，再將價格寫回 Supabase。
5. 公開的 `data/latest.json` 只包含示範用公開航線，不會寫入私人行程。

資料庫結構保存在 [`supabase/schema.sql`](supabase/schema.sql)。

## GitHub 設定

必要 Secrets：

- `SERPAPI_API_KEY`
- `SUPABASE_SECRET_KEY`

必要 Variables：

- `SUPABASE_URL`

選用通知 Secrets：

- `LINE_CHANNEL_ACCESS_TOKEN`、`LINE_USER_ID`
- `RESEND_API_KEY`、`ALERT_EMAIL`

前端只包含 Supabase publishable key；可繞過 RLS 的 secret key 僅存放於 GitHub Actions Secret。

## 免費測試限制

SerpApi 免費方案每月 250 次搜尋且限非商業用途。每日最多執行 8 組不重複搜尋；相同航線與日期會合併查詢。前端目前限制每個帳號 5 條監控。正式商業上架前必須改用允許商業用途的航班資料方案。

## 本機預覽

```powershell
node server.js
```

開啟 `http://127.0.0.1:4173/`。