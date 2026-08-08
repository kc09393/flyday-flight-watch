import fs from 'node:fs/promises';

const CONFIG_PATH = new URL('../config/watches.json', import.meta.url);
const LATEST_PATH = new URL('../data/latest.json', import.meta.url);
const HISTORY_PATH = new URL('../data/history.json', import.meta.url);
const API_BASE = process.env.SERPAPI_API_BASE || 'https://serpapi.com/search.json';
const MAX_DAILY_SEARCHES = Math.max(1, Number(process.env.SERPAPI_MAX_DAILY_WATCHES) || 8);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const ROUTE_BASELINES = {
  NRT:7000, KIX:6800, NGO:7200, CTS:9200, FUK:6500, OKA:6200,
  ICN:6000, PUS:6500, BKK:8500, CNX:9000, HKT:9500,
  HKG:5000, MFM:5200, SIN:9000, KUL:8500, HAN:7800, DAD:7600,
  SGN:7600, MNL:6500, CEB:7200, CKG:9500, PVG:7500, PEK:9500,
  CTU:10000, CAN:8000, SZX:8000, HGH:8500, NKG:8800, WUH:9000,
  XIY:10000, XMN:7200, TAO:9000
};

function roundPrice(value) {
  return Math.max(1000, Math.round(Number(value) / 100) * 100);
}

function seasonalMultiplier(dateValue) {
  if (!dateValue) return 1;
  const date = new Date(`${dateValue}T00:00:00`);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  if ((month === 12 && day >= 20) || (month === 1 && day <= 5)) return 1.3;
  if (month === 7 || month === 8) return 1.15;
  if (month === 4 && day <= 10) return 1.12;
  return 1;
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * ratio)];
}

function estimateTargetPrice(watch) {
  const current = Number(watch.currentPrice);
  const insights = watch.priceInsights || {};
  const typicalLow = Number(insights.typical_price_range?.[0]);
  const history = (insights.price_history || []).map(item => Number(Array.isArray(item) ? item[1] : item?.price)).filter(Number.isFinite);
  const level = String(insights.price_level || '').toLowerCase();
  if (Number.isFinite(current) && current > 0) {
    if (level === 'low' || (Number.isFinite(typicalLow) && current <= typicalLow * 1.05)) return roundPrice(current);
    const lowerQuartile = percentile(history, .25);
    let estimate = Math.min(Number.isFinite(lowerQuartile) ? lowerQuartile : current * .92, current * .92);
    if (Number.isFinite(typicalLow)) estimate = Math.max(typicalLow, estimate);
    return roundPrice(estimate);
  }
  const originMultiplier = watch.origin === 'KHH' ? 1.15 : watch.origin === 'RMQ' ? 1.18 : 1;
  return roundPrice((ROUTE_BASELINES[watch.destination] || 9000) * originMultiplier * seasonalMultiplier(watch.departureDate));
}

const readJson = async (path, fallback) => {
  try { return JSON.parse(await fs.readFile(path, 'utf8')); }
  catch { return fallback; }
};
const writeJson = (path, data) => fs.writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) throw new Error('Supabase backend is not configured');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...options, headers:supabaseHeaders(options.headers) });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Supabase request failed (${response.status}): ${details.slice(0, 240)}`);
  }
  if (response.status === 204) return null;
  return response.json().catch(() => null);
}

async function loadCloudWatches() {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) return [];
  const rows = await supabaseRequest('flight_watches?active=eq.true&select=*&order=created_at.asc');
  return (rows || []).map(row => ({
    id: row.id,
    origin: row.origin,
    originCity: row.origin_city,
    destination: row.destination,
    destinationCity: row.destination_city,
    departureDate: row.departure_date,
    returnDate: row.return_date,
    targetPrice: row.target_price,
    nonStop: row.nonstop,
    adults: row.adults || 1,
    userId: row.user_id,
    previousCloudPrice: row.current_price,
    source: 'cloud'
  }));
}

async function searchWatch(apiKey, watch, settings) {
  const query = new URLSearchParams({
    engine: 'google_flights',
    api_key: apiKey,
    departure_id: watch.origin,
    arrival_id: watch.destination,
    outbound_date: watch.departureDate,
    return_date: watch.returnDate,
    adults: String(watch.adults || settings.adults || 1),
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
  if (!response.ok) throw new Error(`${watch.origin}-${watch.destination} search failed (${response.status}): ${payload.error || 'SerpApi request failed'}`);
  if (payload.error) throw new Error(`${watch.origin}-${watch.destination} search failed: ${payload.error}`);

  const groups = [...(payload.best_flights || []), ...(payload.other_flights || [])];
  const offers = groups.map((offer, index) => ({
    id: offer.departure_token || offer.booking_token || `${watch.origin}-${watch.destination}-${index + 1}`,
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
    currentPrice: cheapest?.price ?? null,
    currency: cheapest?.currency || settings.currency || 'TWD',
    offerCount: offers.length,
    cheapestOffer: cheapest || null,
    priceInsights: payload.price_insights || null,
    searchUrl: payload.search_metadata?.google_flights_url || null,
    checkedAt: new Date().toISOString()
  };
}

function watchKey(watch) {
  return [watch.origin, watch.destination, watch.departureDate, watch.returnDate, watch.nonStop ? 1 : 0, watch.adults || 1].join('|');
}

function groupWatches(watches) {
  const groups = new Map();
  for (const watch of watches) {
    const key = watchKey(watch);
    if (!groups.has(key)) groups.set(key, { query:watch, members:[] });
    groups.get(key).members.push(watch);
  }
  return [...groups.values()];
}

function expandResult(group, searchResult) {
  return group.members.map(member => {
    const result = { ...member, ...searchResult };
    const targetPrice = estimateTargetPrice(result);
    return {
      ...result,
      targetPrice,
      recommendedTargetPrice: targetPrice,
      estimateBasis: result.priceInsights?.typical_price_range ? 'google_price_range' : 'route_baseline',
      targetHit: result.currentPrice ? result.currentPrice <= targetPrice : false
    };
  });
}

function addInsights(results, history) {
  return results.map(result => {
    const routeHistory = history.filter(item => item.watchId === result.id && Number.isFinite(item.price));
    const recent = routeHistory.slice(-30);
    const average = recent.length ? recent.reduce((sum, item) => sum + item.price, 0) / recent.length : null;
    const priceVsAveragePct = average && result.currentPrice ? Number((((result.currentPrice - average) / average) * 100).toFixed(1)) : null;
    const previous = routeHistory.at(-1)?.price;
    const changePct = previous && result.currentPrice ? Number((((result.currentPrice - previous) / previous) * 100).toFixed(1)) : null;
    return { ...result, average30d: average ? Math.round(average) : null, priceVsAveragePct, changePct };
  });
}

async function syncCloudSuccess(result) {
  const checkedAt = result.checkedAt || new Date().toISOString();
  await supabaseRequest(`flight_watches?id=eq.${encodeURIComponent(result.id)}`, {
    method:'PATCH',
    headers:{ Prefer:'return=minimal' },
    body:JSON.stringify({
      previous_price: result.previousCloudPrice,
      current_price: result.currentPrice,
      target_price: result.targetPrice,
      offer_count: result.offerCount,
      provider: 'Google Flights via SerpApi',
      search_url: result.searchUrl,
      last_checked_at: checkedAt,
      last_error: null
    })
  });
  if (result.currentPrice) {
    await supabaseRequest('watch_prices', {
      method:'POST',
      headers:{ Prefer:'return=minimal' },
      body:JSON.stringify({ watch_id:result.id, user_id:result.userId, price:result.currentPrice, checked_at:checkedAt, provider:'Google Flights via SerpApi' })
    });
  }
}

async function syncCloudFailure(watch, message) {
  await supabaseRequest(`flight_watches?id=eq.${encodeURIComponent(watch.id)}`, {
    method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ last_error:message, last_checked_at:new Date().toISOString() })
  });
}

async function sendLine(message) {
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN || !process.env.LINE_USER_ID) return;
  await fetch('https://api.line.me/v2/bot/message/push', { method:'POST', headers:{ Authorization:`Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`, 'Content-Type':'application/json' }, body:JSON.stringify({ to:process.env.LINE_USER_ID, messages:[{ type:'text', text:message }] }) });
}
async function sendEmail(subject, html) {
  if (!process.env.RESEND_API_KEY || !process.env.ALERT_EMAIL) return;
  await fetch('https://api.resend.com/emails', { method:'POST', headers:{ Authorization:`Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type':'application/json' }, body:JSON.stringify({ from:process.env.ALERT_FROM || 'Flyday <onboarding@resend.dev>', to:[process.env.ALERT_EMAIL], subject, html }) });
}
async function createGitHubIssue(result) {
  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPOSITORY) return;
  const title = `[低價通知] ${result.origin} → ${result.destination} NT$ ${result.currentPrice.toLocaleString('zh-TW')}`;
  const api = `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}`;
  const headers = { Authorization:`Bearer ${process.env.GITHUB_TOKEN}`, Accept:'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28' };
  await fetch(`${api}/labels`, { method:'POST', headers:{ ...headers, 'Content-Type':'application/json' }, body:JSON.stringify({ name:'price-alert', color:'ff6a45', description:'Flyday 自動低價通知' }) });
  const existing = await fetch(`${api}/issues?state=open&labels=price-alert&per_page=30`, { headers }).then(response => response.ok ? response.json() : []);
  if (existing.some(issue => issue.title === title)) return;
  await fetch(`${api}/issues`, { method:'POST', headers:{ ...headers, 'Content-Type':'application/json' }, body:JSON.stringify({ title, labels:['price-alert'], body:`## Flyday 找到低價\n\n- 航線：${result.origin} → ${result.destination}\n- 日期：${result.departureDate} ～ ${result.returnDate}\n- 目前最低：**NT$ ${result.currentPrice.toLocaleString('zh-TW')}**\n- 目標價格：NT$ ${result.targetPrice.toLocaleString('zh-TW')}\n\n[打開 Flyday](https://kc09393.github.io/flyday-flight-watch/)` }) });
}
async function notify(results, previousLatest) {
  for (const result of results) {
    if (!result.currentPrice) continue;
    const old = previousLatest.results?.find(item => item.id === result.id);
    const newlyHit = result.targetHit && (!old?.targetHit || result.currentPrice < old.currentPrice);
    const exceptionalDrop = result.priceVsAveragePct !== null && result.priceVsAveragePct <= -10 && (!old?.currentPrice || result.currentPrice < old.currentPrice);
    if (!newlyHit && !exceptionalDrop) continue;
    const message = `✈️ Flyday 低價通知\n${result.origin} → ${result.destination}\n${result.departureDate} ～ ${result.returnDate}\n目前 NT$ ${result.currentPrice.toLocaleString('zh-TW')}\nhttps://kc09393.github.io/flyday-flight-watch/`;
    await Promise.allSettled([createGitHubIssue(result), sendLine(message), sendEmail(`Flyday 低價：${result.origin} → ${result.destination}`, `<h2>${result.origin} → ${result.destination}</h2><p>目前最低 <strong>NT$ ${result.currentPrice.toLocaleString('zh-TW')}</strong></p>`)]);
  }
}

async function main() {
  const config = await readJson(CONFIG_PATH, { watches:[] });
  const previousLatest = await readJson(LATEST_PATH, { results:[] });
  const history = await readJson(HISTORY_PATH, []);
  if (!process.env.SERPAPI_API_KEY) {
    console.log('SerpApi credentials are not configured.');
    return;
  }

  const publicWatches = (Array.isArray(config.watches) ? config.watches : []).map(watch => ({ ...watch, source:'public' }));
  let cloudWatches = [];
  try { cloudWatches = await loadCloudWatches(); }
  catch (error) { console.warn(`Cloud watches unavailable: ${error.message}`); }

  const groups = groupWatches([...publicWatches, ...cloudWatches]);
  const activeGroups = groups.slice(0, MAX_DAILY_SEARCHES);
  const skippedGroups = groups.slice(MAX_DAILY_SEARCHES);
  const settled = await Promise.allSettled(activeGroups.map(async group => ({ group, search:await searchWatch(process.env.SERPAPI_API_KEY, group.query, config) })));
  const fulfilled = settled.filter(item => item.status === 'fulfilled').map(item => item.value);
  const failed = settled.filter(item => item.status === 'rejected').map((item, index) => ({ group:activeGroups[settled.indexOf(item)], message:item.reason.message || String(item.reason), index }));
  const expanded = fulfilled.flatMap(item => expandResult(item.group, item.search));
  const publicRaw = expanded.filter(result => result.source === 'public');
  const cloudResults = expanded.filter(result => result.source === 'cloud');
  const errors = [
    ...failed.flatMap(item => item.group.members.filter(member => member.source === 'public').map(() => item.message)),
    ...skippedGroups.flatMap(group => group.members.filter(member => member.source === 'public').map(member => `${member.id} skipped to protect the free monthly quota`))
  ];

  let publicResultsWithInsights = addInsights(publicRaw, history);
  const checkedAt = new Date().toISOString();
  const newHistory = [...history, ...publicResultsWithInsights.filter(result => result.currentPrice).map(result => ({ watchId:result.id, price:result.currentPrice, checkedAt }))].slice(-1500);
  const latest = { status:errors.length ? 'partial' : 'live', provider:'Google Flights via SerpApi', updatedAt:checkedAt, errors, results:publicResultsWithInsights };

  const cloudSyncTasks = [
    ...cloudResults.map(syncCloudSuccess),
    ...failed.flatMap(item => item.group.members.filter(member => member.source === 'cloud').map(member => syncCloudFailure(member, item.message))),
    ...skippedGroups.flatMap(group => group.members.filter(member => member.source === 'cloud').map(member => syncCloudFailure(member, '今日免費巡價額度已滿，明天會再嘗試')))
  ];
  const cloudSync = await Promise.allSettled(cloudSyncTasks);
  const cloudSyncErrors = cloudSync.filter(item => item.status === 'rejected');
  if (cloudSyncErrors.length) console.warn(`${cloudSyncErrors.length} cloud updates failed`);

  await Promise.all([writeJson(LATEST_PATH, latest), writeJson(HISTORY_PATH, newHistory)]);
  await notify(publicResultsWithInsights, previousLatest);
  console.log(`Updated ${publicResultsWithInsights.length} public and ${cloudResults.length} cloud watches using ${activeGroups.length} searches at ${checkedAt}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });