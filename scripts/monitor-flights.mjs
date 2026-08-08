import fs from 'node:fs/promises';

const CONFIG_PATH = new URL('../config/watches.json', import.meta.url);
const LATEST_PATH = new URL('../data/latest.json', import.meta.url);
const HISTORY_PATH = new URL('../data/history.json', import.meta.url);
const API_BASE = process.env.SERPAPI_API_BASE || 'https://serpapi.com/search.json';
const MAX_DAILY_WATCHES = Math.max(1, Number(process.env.SERPAPI_MAX_DAILY_WATCHES) || 8);

const readJson = async (path, fallback) => {
  try { return JSON.parse(await fs.readFile(path, 'utf8')); }
  catch { return fallback; }
};

const writeJson = (path, data) => fs.writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');

async function searchWatch(apiKey, watch, settings) {
  const query = new URLSearchParams({
    engine: 'google_flights',
    api_key: apiKey,
    departure_id: watch.origin,
    arrival_id: watch.destination,
    outbound_date: watch.departureDate,
    return_date: watch.returnDate,
    adults: String(settings.adults || 1),
    currency: settings.currency || 'TWD',
    gl: 'tw',
    hl: 'zh-tw',
    type: '1',
    travel_class: '1',
    sort_by: '2',
    stops: watch.nonStop ? '1' : '0'
  });
  const response = await fetch(`${API_BASE}?${query}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${watch.id} search failed (${response.status}): ${payload.error || 'SerpApi request failed'}`);
  }
  if (payload.error) throw new Error(`${watch.id} search failed: ${payload.error}`);

  const groups = [...(payload.best_flights || []), ...(payload.other_flights || [])];
  const offers = groups.map((offer, index) => ({
    id: offer.departure_token || offer.booking_token || `${watch.id}-${index + 1}`,
    price: Number(offer.price),
    currency: settings.currency || 'TWD',
    validatingAirlines: [...new Set((offer.flights || []).map(segment => segment.airline).filter(Boolean))],
    itineraries: [{
      durationMinutes: offer.total_duration || null,
      segments: (offer.flights || []).map(segment => ({
        carrier: segment.airline,
        number: segment.flight_number,
        from: segment.departure_airport?.id,
        departureAt: segment.departure_airport?.time,
        to: segment.arrival_airport?.id,
        arrivalAt: segment.arrival_airport?.time,
        durationMinutes: segment.duration,
        travelClass: segment.travel_class
      }))
    }]
  })).filter(offer => Number.isFinite(offer.price)).sort((a, b) => a.price - b.price);

  const cheapest = offers[0];
  return {
    ...watch,
    currentPrice: cheapest?.price ?? null,
    currency: cheapest?.currency || settings.currency || 'TWD',
    offerCount: offers.length,
    cheapestOffer: cheapest || null,
    priceInsights: payload.price_insights || null,
    searchUrl: payload.search_metadata?.google_flights_url || null,
    targetHit: cheapest ? cheapest.price <= watch.targetPrice : false,
    checkedAt: new Date().toISOString()
  };
}

function addInsights(results, history) {
  return results.map(result => {
    const routeHistory = history.filter(item => item.watchId === result.id && Number.isFinite(item.price));
    const recent = routeHistory.slice(-30);
    const average = recent.length ? recent.reduce((sum, item) => sum + item.price, 0) / recent.length : null;
    const priceVsAveragePct = average && result.currentPrice
      ? Number((((result.currentPrice - average) / average) * 100).toFixed(1))
      : null;
    const previous = routeHistory.at(-1)?.price;
    const changePct = previous && result.currentPrice
      ? Number((((result.currentPrice - previous) / previous) * 100).toFixed(1))
      : null;
    return { ...result, average30d: average ? Math.round(average) : null, priceVsAveragePct, changePct };
  });
}

async function explainWithAI(results) {
  if (!process.env.OPENAI_API_KEY) return results;
  const model = process.env.OPENAI_MODEL || 'gpt-5.6-terra';
  const compact = results.map(({ id, origin, destination, currentPrice, targetPrice, average30d, priceVsAveragePct, targetHit }) => ({ id, origin, destination, currentPrice, targetPrice, average30d, priceVsAveragePct, targetHit }));
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      input: `你是台灣旅客的機票價格分析助手。請根據以下真實 API 數字，為每個 id 各寫一句 35 字內繁體中文購買建議。不得捏造價格。只輸出 JSON 物件，鍵為 id，值為建議。資料：${JSON.stringify(compact)}`,
      max_output_tokens: 350
    })
  });
  if (!response.ok) return results;
  const payload = await response.json();
  const text = payload.output_text || payload.output?.flatMap(item => item.content || []).find(item => item.type === 'output_text')?.text;
  try {
    const advice = JSON.parse(text.replace(/^```json\s*|\s*```$/g, ''));
    return results.map(result => ({ ...result, aiAdvice: advice[result.id] || null }));
  } catch { return results; }
}

async function sendLine(message) {
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN || !process.env.LINE_USER_ID) return;
  await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: process.env.LINE_USER_ID, messages: [{ type: 'text', text: message }] })
  });
}

async function sendEmail(subject, html) {
  if (!process.env.RESEND_API_KEY || !process.env.ALERT_EMAIL) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.ALERT_FROM || 'Flyday <onboarding@resend.dev>', to: [process.env.ALERT_EMAIL], subject, html })
  });
}

async function createGitHubIssue(result) {
  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPOSITORY) return;
  const title = `[低價通知] ${result.origin} → ${result.destination} NT$ ${result.currentPrice.toLocaleString('zh-TW')}`;
  const api = `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}`;
  const headers = { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  await fetch(`${api}/labels`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'price-alert', color: 'ff6a45', description: 'Flyday 自動低價通知' })
  });
  const existing = await fetch(`${api}/issues?state=open&labels=price-alert&per_page=30`, { headers }).then(r => r.ok ? r.json() : []);
  if (existing.some(issue => issue.title === title)) return;
  await fetch(`${api}/issues`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, labels: ['price-alert'], body: `## Flyday 找到低價\n\n- 航線：${result.origin} → ${result.destination}\n- 日期：${result.departureDate} ～ ${result.returnDate}\n- 目前最低：**NT$ ${result.currentPrice.toLocaleString('zh-TW')}**\n- 目標價格：NT$ ${result.targetPrice.toLocaleString('zh-TW')}\n- 航班選項：${result.offerCount} 個\n\n${result.aiAdvice || '價格已達到你設定的條件，建議重新查價確認後決定。'}\n\n[打開 Flyday](https://kc09393.github.io/flyday-flight-watch/)` })
  });
}

async function notify(results, previousLatest) {
  for (const result of results) {
    if (!result.currentPrice) continue;
    const old = previousLatest.results?.find(item => item.id === result.id);
    const newlyHit = result.targetHit && (!old?.targetHit || result.currentPrice < old.currentPrice);
    const exceptionalDrop = result.priceVsAveragePct !== null && result.priceVsAveragePct <= -10 && (!old?.currentPrice || result.currentPrice < old.currentPrice);
    if (!newlyHit && !exceptionalDrop) continue;
    const message = `✈️ Flyday 低價通知\n${result.origin} → ${result.destination}\n${result.departureDate} ～ ${result.returnDate}\n目前 NT$ ${result.currentPrice.toLocaleString('zh-TW')}\n${result.aiAdvice || '已達到你的低價條件。'}\nhttps://kc09393.github.io/flyday-flight-watch/`;
    await Promise.allSettled([
      createGitHubIssue(result),
      sendLine(message),
      sendEmail(`Flyday 低價：${result.origin} → ${result.destination}`, `<h2>${result.origin} → ${result.destination}</h2><p>目前最低 <strong>NT$ ${result.currentPrice.toLocaleString('zh-TW')}</strong></p><p>${result.aiAdvice || ''}</p>`)
    ]);
  }
}

async function main() {
  const config = await readJson(CONFIG_PATH, { watches: [] });
  const previousLatest = await readJson(LATEST_PATH, { results: [] });
  const history = await readJson(HISTORY_PATH, []);
  if (!process.env.SERPAPI_API_KEY) {
    console.log('SerpApi credentials are not configured; workflow wiring is ready.');
    return;
  }

  const configuredWatches = Array.isArray(config.watches) ? config.watches : [];
  const activeWatches = configuredWatches.slice(0, MAX_DAILY_WATCHES);
  const skippedErrors = configuredWatches.slice(MAX_DAILY_WATCHES).map(watch => `${watch.id} skipped to protect the free monthly search quota`);
  const settled = await Promise.allSettled(activeWatches.map(watch => searchWatch(process.env.SERPAPI_API_KEY, watch, config)));
  const rawResults = settled.filter(item => item.status === 'fulfilled').map(item => item.value);
  const errors = [...settled.filter(item => item.status === 'rejected').map(item => item.reason.message), ...skippedErrors];
  let results = addInsights(rawResults, history);
  results = await explainWithAI(results);
  const checkedAt = new Date().toISOString();
  const newHistory = [...history, ...results.filter(r => r.currentPrice).map(r => ({ watchId: r.id, price: r.currentPrice, checkedAt }))].slice(-1500);
  const latest = { status: errors.length ? 'partial' : 'live', provider: 'Google Flights via SerpApi', updatedAt: checkedAt, errors, results };
  await Promise.all([writeJson(LATEST_PATH, latest), writeJson(HISTORY_PATH, newHistory)]);
  await notify(results, previousLatest);
  console.log(`Updated ${results.length} routes at ${checkedAt}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
