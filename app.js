const SUPABASE_URL = 'https://gumnsikbwvhogzawaoww.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_D7IATHoOU3zjQhpx8tFipQ_uld80_x6';
const MAX_CLOUD_WATCHES = 5;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHTML = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
const hasRealPrice = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) > 0;
const money = value => hasRealPrice(value) ? `NT$ ${Number(value).toLocaleString('zh-TW')}` : '正在查最新票價';
const dateLabel = value => value ? new Intl.DateTimeFormat('zh-TW', { month:'numeric', day:'numeric' }).format(new Date(`${value}T00:00:00`)) : '';
const fullDateLabel = value => value ? new Intl.DateTimeFormat('zh-TW', { year:'numeric', month:'numeric', day:'numeric' }).format(new Date(`${value}T00:00:00`)) : '';

const cityCodes = {
  台北:'TPE', 桃園:'TPE', 台中:'RMQ', 高雄:'KHH',
  東京:'NRT', 大阪:'KIX', 京都:'KIX', 名古屋:'NGO', 札幌:'CTS', 福岡:'FUK', 沖繩:'OKA',
  首爾:'ICN', 釜山:'PUS', 曼谷:'BKK', 清邁:'CNX', 普吉島:'HKT',
  香港:'HKG', 澳門:'MFM', 新加坡:'SIN', 吉隆坡:'KUL',
  河內:'HAN', 峴港:'DAD', 胡志明:'SGN', 馬尼拉:'MNL', 宿霧:'CEB',
  重慶:'CKG', 上海:'PVG', 北京:'PEK', 成都:'CTU', 廣州:'CAN', 深圳:'SZX',
  杭州:'HGH', 南京:'NKG', 武漢:'WUH', 西安:'XIY', 廈門:'XMN', 青島:'TAO'
};
const cityByCode = Object.entries(cityCodes).reduce((map, [city, code]) => { if (!map[code]) map[code] = city; return map; }, {});
const routeIcons = { NRT:'🇯🇵', KIX:'🇯🇵', FUK:'🇯🇵', OKA:'🇯🇵', CTS:'🇯🇵', NGO:'🇯🇵', ICN:'🇰🇷', PUS:'🇰🇷', BKK:'🇹🇭', CNX:'🇹🇭', HKT:'🇹🇭', HKG:'🇭🇰', MFM:'🇲🇴', SIN:'🇸🇬', KUL:'🇲🇾', HAN:'🇻🇳', DAD:'🇻🇳', SGN:'🇻🇳', MNL:'🇵🇭', CEB:'🇵🇭', CKG:'🇨🇳', PVG:'🇨🇳', PEK:'🇨🇳', CTU:'🇨🇳', CAN:'🇨🇳', SZX:'🇨🇳', HGH:'🇨🇳', NKG:'🇨🇳', WUH:'🇨🇳', XIY:'🇨🇳', XMN:'🇨🇳', TAO:'🇨🇳' };
const routePriceBaselines = {
  NRT:7000, KIX:6800, NGO:7200, CTS:9200, FUK:6500, OKA:6200,
  ICN:6000, PUS:6500, BKK:8500, CNX:9000, HKT:9500,
  HKG:5000, MFM:5200, SIN:9000, KUL:8500,
  HAN:7800, DAD:7600, SGN:7600, MNL:6500, CEB:7200,
  CKG:9500, PVG:7500, PEK:9500, CTU:10000, CAN:8000, SZX:8000,
  HGH:8500, NKG:8800, WUH:9000, XIY:10000, XMN:7200, TAO:9000
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
  const current = Number(watch.current_price ?? watch.currentPrice);
  const insights = watch.price_insights || watch.priceInsights || {};
  const range = insights.typical_price_range || [];
  const typicalLow = Number(range[0]);
  const history = (insights.price_history || []).map(item => Number(Array.isArray(item) ? item[1] : item?.price)).filter(Number.isFinite);
  const level = String(insights.price_level || '').toLowerCase();

  if (Number.isFinite(current) && current > 0) {
    if (level === 'low' || (Number.isFinite(typicalLow) && current <= typicalLow * 1.05)) return roundPrice(current);
    const lowerQuartile = percentile(history, .25);
    let estimate = Math.min(Number.isFinite(lowerQuartile) ? lowerQuartile : current * .92, current * .92);
    if (Number.isFinite(typicalLow)) estimate = Math.max(typicalLow, estimate);
    return roundPrice(estimate);
  }

  const baseline = routePriceBaselines[watch.destination] || 9000;
  const originMultiplier = watch.origin === 'KHH' ? 1.15 : watch.origin === 'RMQ' ? 1.18 : 1;
  return roundPrice(baseline * originMultiplier * seasonalMultiplier(watch.departure_date || watch.departureDate));
}

function estimateReason(watch) {
  const insights = watch.price_insights || watch.priceInsights;
  const current = Number(watch.current_price ?? watch.currentPrice);
  if (insights?.typical_price_range?.length) return '依 Google Flights 常見區間與近期走勢估算';
  if (Number.isFinite(current) && current > 0) return '依目前真實票價保守下修估算';
  return '依航線與出發月份先估，首次巡價後會校正';
}

let publicResults = [];
let cloudWatches = [];
let currentSession = null;
let cloudClient = null;
let activeView = 'home';
let installPrompt = null;
let publicUpdatedAt = null;

function formatInputDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function defaultDates(daysAway = 30, nights = 5) {
  const departure = new Date();
  departure.setDate(departure.getDate() + daysAway);
  const returning = new Date(departure);
  returning.setDate(returning.getDate() + nights);
  return { departureDate: formatInputDate(departure), returnDate: formatInputDate(returning) };
}

function monthDateRange(monthValue) {
  const [year, month] = String(monthValue || '').split('-').map(Number);
  if (!year || !month) return null;
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return { start:formatInputDate(start), end:formatInputDate(end) };
}

function isMonthWatch(watch) {
  return (watch.search_mode || watch.searchMode) === 'month';
}

function monthWatchLabel(watch, hasPrice = false) {
  const monthValue = String(watch.travel_month || watch.travelMonth || '').slice(0, 7);
  const [year, month] = monthValue.split('-');
  const minDays = Number(watch.trip_days_min ?? watch.tripDaysMin);
  const maxDays = Number(watch.trip_days_max ?? watch.tripDaysMax);
  if (hasPrice) return `${Number(month)}月目前最便宜：${dateLabel(watch.departure_date)}－${dateLabel(watch.return_date)}`;
  return `${year}年${Number(month)}月・玩 ${minDays}～${maxDays} 天`;
}

function parseLocation(value) {
  const cleaned = String(value || '').trim().replace(/[()]/g, ' ');
  const codeMatch = cleaned.toUpperCase().match(/\b([A-Z]{3})\b/);
  const city = cleaned.replace(/\b[A-Za-z]{3}\b/, '').trim() || cityByCode[codeMatch?.[1]] || codeMatch?.[1] || '';
  const matchedCity = Object.keys(cityCodes).find(name => name.toLowerCase() === city.toLowerCase());
  const code = codeMatch?.[1] || cityCodes[matchedCity];
  return code ? { city: cityByCode[code] || city || code, code } : null;
}

function googleFlightsUrl(watch) {
  if (watch.search_url || watch.searchUrl) return watch.search_url || watch.searchUrl;
  const query = `Flights from ${watch.origin} to ${watch.destination} ${watch.departure_date || watch.departureDate} to ${watch.return_date || watch.returnDate}`;
  return `https://www.google.com/travel/flights?hl=zh-TW&curr=TWD&q=${encodeURIComponent(query)}`;
}

function normalizePublic(item, index) {
  const watch = {
    id: item.id || `public-${index}`,
    origin: item.origin,
    origin_city: item.originCity || cityByCode[item.origin] || item.origin,
    destination: item.destination,
    destination_city: item.destinationCity || cityByCode[item.destination] || item.destination,
    departure_date: item.departureDate,
    return_date: item.returnDate,
    current_price: hasRealPrice(item.currentPrice) ? Number(item.currentPrice) : null,
    previous_price: null,
    offer_count: Number(item.offerCount || 0),
    provider: 'Google Flights via SerpApi',
    search_url: item.searchUrl,
    last_checked_at: item.checkedAt,
    nonstop: Boolean(item.nonStop),
    active: true,
    public: true,
    price_insights: item.priceInsights || null,
    search_mode: item.searchMode || 'exact',
    travel_month: item.travelMonth || null,
    trip_days_min: item.tripDaysMin || null,
    trip_days_max: item.tripDaysMax || null,
  };
  watch.target_price = Number(item.recommendedTargetPrice) || estimateTargetPrice(watch);
  return watch;
}

function visibleWatches() {
  return currentSession ? cloudWatches : [];
}

function watchHit(watch) {
  return hasRealPrice(watch.current_price) && Number(watch.current_price) <= estimateTargetPrice(watch);
}

function setPageClock() {
  $('#todayLabel').textContent = new Intl.DateTimeFormat('zh-TW', { year:'numeric', month:'long', day:'numeric', weekday:'long' }).format(new Date());
}

function showToast(title, message = '', type = 'success') {
  $('#toastIcon').textContent = type === 'error' ? '!' : '✓';
  $('#toastTitle').textContent = title;
  $('#toastMessage').textContent = message;
  const toast = $('#toast');
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 3400);
}

function setSyncState() {
  const card = $('#syncCard');
  card.classList.toggle('offline', !navigator.onLine);
  if (!navigator.onLine) {
    $('#syncTitle').textContent = '目前離線';
    $('#syncDetail').textContent = '恢復網路後會自動同步';
    return;
  }
  if (currentSession) {
    $('#syncTitle').textContent = '已連上雲端';
    $('#syncDetail').textContent = currentSession.user.email || '監控清單已同步';
    return;
  }
  $('#syncTitle').textContent = '真實票價已連線';
  $('#syncDetail').textContent = publicUpdatedAt ? `最後更新 ${new Intl.DateTimeFormat('zh-TW', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' }).format(new Date(publicUpdatedAt))}` : 'Google Flights 每天更新';
}

function updateAccountUI() {
  const email = currentSession?.user?.email;
  const isAnonymous = Boolean(currentSession?.user?.is_anonymous);
  $('#accountLabel').textContent = '設定';
  $('.avatar').textContent = '⚙';
  $('#cloudAccountText').textContent = email
    ? `已使用 ${email} 備份，手機和電腦可以共用監控清單。`
    : isAnonymous
      ? '現在不用登入就能使用。若要換手機或電腦，再用 Email 備份即可。'
      : '目前先保存在這台裝置；需要時可用 Email 備份。';
  $('#cloudAccountButton').textContent = email ? '登出這台裝置' : '用 Email 備份';
  setSyncState();
}

function renderWatches() {
  const watches = visibleWatches();
  $('#watchGrid').innerHTML = watches.map(watch => {
    const hit = watchHit(watch);
    const hasPrice = hasRealPrice(watch.current_price);
    const recommendedPrice = estimateTargetPrice(watch);
    const exactRoutePrices = isMonthWatch(watch)
      ? watches.filter(item => !isMonthWatch(item) && item.origin === watch.origin && item.destination === watch.destination && hasRealPrice(item.current_price)).map(item => Number(item.current_price))
      : [];
    const flexibleSavings = hasPrice && exactRoutePrices.length ? Math.max(0, Math.min(...exactRoutePrices) - Number(watch.current_price)) : 0;
    const queued = !hasPrice && /排入|額度|下一輪/.test(String(watch.last_error || ''));
    const lookupFailed = !hasPrice && Boolean(watch.last_error) && !queued;
    const statusClass = hit ? 'hit' : hasPrice ? 'live' : '';
    const statusText = !watch.active ? '已暫停' : hit ? '建議可以買' : flexibleSavings > 0 ? `比固定日期省 ${money(flexibleSavings)}` : hasPrice ? '每日巡價中' : queued ? '排隊中，下一輪會查' : lookupFailed ? '暫時查不到，會再重試' : '正在取得第一次票價';
    const pendingPriceText = queued ? '已排入下一輪' : lookupFailed ? '稍後自動重試' : '通常幾分鐘內完成';
    const editAction = isMonthWatch(watch) ? '' : `<button data-action="edit" data-id="${escapeHTML(watch.id)}">編輯</button>`;
    const ownerActions = currentSession && !watch.public ? `
      <div class="card-menu">${editAction}<button class="danger" data-action="delete" data-id="${escapeHTML(watch.id)}">刪除</button></div>` : '';
    const secondaryAction = currentSession && !watch.public
      ? `<button class="pause-button" data-action="pause" data-id="${escapeHTML(watch.id)}">${watch.active ? '暫停' : '啟用'}</button>`
      : `<button class="pause-button" data-action="copy-public" data-id="${escapeHTML(watch.id)}">加入我的</button>`;
    return `<article class="watch-card ${watch.active ? '' : 'paused'}">
      <div class="watch-status-row"><span class="status-pill ${statusClass}">${statusText}</span>${ownerActions}</div>
      <div class="route-title"><span class="flag">${routeIcons[watch.destination] || '🌏'}</span><div><h3>${escapeHTML(watch.origin_city)} → ${escapeHTML(watch.destination_city)}</h3><p>${isMonthWatch(watch) ? escapeHTML(monthWatchLabel(watch, hasPrice)) : `${escapeHTML(watch.origin)} → ${escapeHTML(watch.destination)}・${dateLabel(watch.departure_date)}－${dateLabel(watch.return_date)}`}</p></div></div>
      <div class="price-row"><div class="price-main"><span>${hasPrice ? (isMonthWatch(watch) ? '本月找到最低・來回含稅' : '目前最低・來回含稅') : '價格狀態'}</span><strong class="${hasPrice ? '' : 'pending'}">${hasPrice ? money(watch.current_price) : pendingPriceText}</strong></div><div class="target-price"><span>系統建議價</span><strong>${money(recommendedPrice)}</strong><small class="estimate-note">${escapeHTML(estimateReason(watch))}</small></div></div>
      <div class="card-actions"><a class="flight-link" href="${escapeHTML(googleFlightsUrl(watch))}" target="_blank" rel="noopener">查看 Google Flights</a>${secondaryAction}</div>
    </article>`;
  }).join('');
  $('#emptyState').hidden = watches.length > 0;
  $('.watch-section').classList.toggle('has-watches', watches.length > 0);
  const hitCount = watches.filter(watchHit).length;
  $('#welcomeSummary').textContent = watches.length
    ? `${watches.length} 個行程正在追蹤${hitCount ? `，${hitCount} 個已到建議入手價。` : '。'}`
    : '選地點和日期，按一次就完成。';
  renderAlerts();
}

function renderAlerts() {
  const hits = visibleWatches().filter(watch => watch.active && watchHit(watch));
  $('#alertList').innerHTML = hits.map(watch => `<article class="alert-card"><span class="alert-icon">✦</span><div class="alert-copy"><strong>${escapeHTML(watch.origin_city)} → ${escapeHTML(watch.destination_city)} 已到建議價</strong><span>${fullDateLabel(watch.departure_date)} 出發・目前 ${money(watch.current_price)}・建議入手 ${money(estimateTargetPrice(watch))}</span></div><a href="${escapeHTML(googleFlightsUrl(watch))}" target="_blank" rel="noopener">查看航班</a></article>`).join('');
  $('#alertEmpty').hidden = hits.length > 0;
  $('#alertCount').hidden = hits.length === 0;
  $('#mobileAlertCount').hidden = hits.length === 0;
  $('#notificationDot').hidden = hits.length === 0;
  $('#alertCount').textContent = hits.length;
  $('#mobileAlertCount').textContent = hits.length;
  maybeNotify(hits);
}

function maybeNotify(hits) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const seen = new Set(JSON.parse(localStorage.getItem('flyday-notified') || '[]'));
  const next = [...seen];
  hits.forEach(watch => {
    const key = `${watch.id}:${watch.current_price}:${watch.last_checked_at || ''}`;
    if (seen.has(key)) return;
    new Notification(`Flyday：${watch.destination_city} 已到建議價`, { body:`目前 ${money(watch.current_price)}，系統建議價是 ${money(estimateTargetPrice(watch))}`, icon:'./icon.svg' });
    next.push(key);
  });
  localStorage.setItem('flyday-notified', JSON.stringify(next.slice(-50)));
}

function switchView(view) {
  activeView = view;
  $$('[data-view-panel]').forEach(panel => { panel.hidden = panel.dataset.viewPanel !== view; panel.classList.toggle('active', panel.dataset.viewPanel === view); });
  $$('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  if (history.replaceState) history.replaceState(null, '', `#${view}`);
  window.scrollTo({ top:0, behavior:'smooth' });
}

async function loadPublicData() {
  try {
    const response = await fetch('./data/latest.json', { cache:'no-store' });
    if (!response.ok) throw new Error('票價資料讀取失敗');
    const payload = await response.json();
    publicResults = (payload.results || []).map(normalizePublic);
    publicUpdatedAt = payload.updatedAt;
  } catch (error) {
    publicResults = [];
    $('#syncTitle').textContent = '暫時無法取得票價';
    $('#syncDetail').textContent = '請稍後重新整理';
  }
  renderWatches();
  setSyncState();
}

function cloudPayloadFromWatch(watch) {
  return {
    origin: watch.origin,
    origin_city: watch.origin_city,
    destination: watch.destination,
    destination_city: watch.destination_city,
    departure_date: watch.departure_date,
    return_date: watch.return_date,
    search_mode: watch.search_mode || 'exact',
    travel_month: watch.travel_month || null,
    trip_days_min: watch.trip_days_min || null,
    trip_days_max: watch.trip_days_max || null,
    target_price: Number(watch.target_price),
    currency: 'TWD',
    adults: 1,
    cabin: 'economy',
    nonstop: Boolean(watch.nonstop),
    active: watch.active !== false,
    current_price: hasRealPrice(watch.current_price) ? Number(watch.current_price) : null,
    offer_count: Number(watch.offer_count || 0),
    provider: watch.provider || null,
    search_url: watch.search_url || null,
    last_checked_at: watch.last_checked_at || null
  };
}

async function loadCloudWatches() {
  if (!currentSession) return;
  const { data, error } = await cloudClient.from('flight_watches').select('*').order('created_at', { ascending:true });
  if (error) throw error;
  cloudWatches = (data || []).map(watch => ({ ...watch, target_price:estimateTargetPrice(watch) }));
  renderWatches();
}

async function flushPendingWatch() {
  const raw = localStorage.getItem('flyday-pending-watch');
  if (!raw || !currentSession) return;
  const pending = JSON.parse(raw);
  localStorage.removeItem('flyday-pending-watch');
  await saveCloudWatch(pending);
  showToast('已同步到雲端', `${pending.origin_city} → ${pending.destination_city}`);
}

async function handleSession(session) {
  currentSession = session;
  updateAccountUI();
  if (!session) {
    cloudWatches = [];
    renderWatches();
    return;
  }
  closeAuthModal();
  try {
    await loadCloudWatches();
    await flushPendingWatch();
  } catch (error) {
    showToast('雲端同步失敗', error.message, 'error');
  }
}

async function initCloud() {
  if (!window.supabase?.createClient) {
    showToast('雲端元件載入失敗', '請確認網路後重新整理', 'error');
    return;
  }
  cloudClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true } });
  const { data } = await cloudClient.auth.getSession();
  let session = data.session;
  if (!session) {
    const { data:guestData, error:guestError } = await cloudClient.auth.signInAnonymously();
    if (guestError) throw guestError;
    session = guestData.session;
  }
  await handleSession(session);
  cloudClient.auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION') return;
    setTimeout(() => handleSession(session), 0);
  });
}

function openAuthModal() {
  $('#authModal').hidden = false;
  $('#authMessage').hidden = true;
  setTimeout(() => $('#emailInput').focus(), 60);
}
function closeAuthModal() { $('#authModal').hidden = true; }

async function sendLoginLink(event) {
  event.preventDefault();
  const button = $('#authSubmitButton');
  const email = $('#emailInput').value.trim();
  button.disabled = true;
  button.textContent = '寄送中…';
  const redirect = `${location.origin}${location.pathname}`;
  const isAnonymous = Boolean(currentSession?.user?.is_anonymous);
  const { error } = isAnonymous
    ? await cloudClient.auth.updateUser({ email }, { emailRedirectTo:redirect })
    : await cloudClient.auth.signInWithOtp({ email, options:{ emailRedirectTo:redirect, shouldCreateUser:true } });
  button.disabled = false;
  button.textContent = '重新寄送登入連結';
  if (error) {
    showToast('登入信寄送失敗', error.message, 'error');
    return;
  }
  $('#authMessage').hidden = false;
  $('#authMessage').innerHTML = `確認信已寄到 <strong>${escapeHTML(email)}</strong>。打開信件中的按鈕，就能在其他裝置使用同一份監控。`;
}

function setQuickDateMode(mode) {
  const isMonth = mode === 'month';
  $$('[data-date-mode]').forEach(button => {
    const active = button.dataset.dateMode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $$('.exact-date-field').forEach(field => { field.hidden = isMonth; });
  $$('.month-date-field').forEach(field => { field.hidden = !isMonth; });
  $('#quickDepartInput').required = !isMonth;
  $('#quickReturnInput').required = !isMonth;
  $('#quickMonthInput').required = isMonth;
  $('#quickWatchButton').textContent = isMonth ? '找這個月最便宜' : '開始幫我找';
}

function setupQuickWatchForm() {
  const defaults = defaultDates(30, 5);
  $('#quickDepartInput').min = formatInputDate(new Date());
  $('#quickDepartInput').value = defaults.departureDate;
  $('#quickReturnInput').min = defaults.departureDate;
  $('#quickReturnInput').value = defaults.returnDate;
  $('#quickMonthInput').min = formatInputDate(new Date()).slice(0, 7);
  const latestFlexibleMonth = new Date();
  latestFlexibleMonth.setMonth(latestFlexibleMonth.getMonth() + 5);
  $('#quickMonthInput').max = formatInputDate(latestFlexibleMonth).slice(0, 7);
  $('#quickMonthInput').value = defaults.departureDate.slice(0, 7);
  setQuickDateMode('exact');
}

function readQuickWatchForm() {
  const origin = parseLocation($('#quickFromInput').value);
  const destination = parseLocation($('#quickToInput').value);
  if (!origin || !destination) {
    const invalid = !origin ? $('#quickFromInput') : $('#quickToInput');
    invalid.setCustomValidity('請輸入城市名稱，並從建議中選擇');
    invalid.reportValidity();
    return null;
  }
  const mode = $('[data-date-mode].active')?.dataset.dateMode || 'exact';
  let departureDate;
  let returnDate;
  let travelMonth = null;
  let tripDaysMin = null;
  let tripDaysMax = null;
  if (mode === 'month') {
    travelMonth = $('#quickMonthInput').value;
    const range = monthDateRange(travelMonth);
    if (!range) {
      $('#quickMonthInput').setCustomValidity('請選擇月份');
      $('#quickMonthInput').reportValidity();
      return null;
    }
    [tripDaysMin, tripDaysMax] = $('#quickTripLengthInput').value.split(',').map(Number);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    departureDate = range.start > formatInputDate(tomorrow) ? range.start : formatInputDate(tomorrow);
    if (departureDate > range.end) {
      $('#quickMonthInput').setCustomValidity('這個月份已經過了，請選下一個月份');
      $('#quickMonthInput').reportValidity();
      return null;
    }
    const provisionalReturn = new Date(`${departureDate}T00:00:00`);
    provisionalReturn.setDate(provisionalReturn.getDate() + tripDaysMin);
    returnDate = formatInputDate(provisionalReturn);
  } else {
    departureDate = $('#quickDepartInput').value;
    returnDate = $('#quickReturnInput').value;
    if (!departureDate || !returnDate || returnDate <= departureDate) {
      $('#quickReturnInput').setCustomValidity('回程日期必須晚於去程日期');
      $('#quickReturnInput').reportValidity();
      return null;
    }
  }
  const reference = publicResults.find(item => item.origin === origin.code && item.destination === destination.code);
  const estimateSource = reference
    ? { ...reference, origin:origin.code, destination:destination.code, departure_date:departureDate }
    : { origin:origin.code, destination:destination.code, departure_date:departureDate };
  return {
    origin:origin.code,
    origin_city:origin.city,
    destination:destination.code,
    destination_city:destination.city,
    departure_date:departureDate,
    return_date:returnDate,
    search_mode:mode,
    travel_month:travelMonth ? `${travelMonth}-01` : null,
    trip_days_min:tripDaysMin,
    trip_days_max:tripDaysMax,
    target_price:estimateTargetPrice(estimateSource),
    nonstop:false,
    active:true
  };
}

async function handleQuickWatchSubmit(event) {
  event.preventDefault();
  const watch = readQuickWatchForm();
  if (!watch) return;
  const button = $('#quickWatchButton');
  button.disabled = true;
  button.textContent = '儲存中…';
  try {
    await saveCloudWatch(watch);
    showToast('好了，我會每天幫你看', watch.origin_city + ' → ' + watch.destination_city);
    $('#quickToInput').value = '';
  } catch (error) {
    showToast('儲存失敗', error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = watch.search_mode === 'month' ? '找這個月最便宜' : '開始幫我找';
  }
}

function openWatchModal(prefill = {}, editing = false) {
  const defaults = defaultDates();
  $('#watchId').value = prefill.id || '';
  $('#fromInput').value = prefill.origin ? `${prefill.origin_city || cityByCode[prefill.origin] || prefill.origin} ${prefill.origin}` : '台北 TPE';
  $('#toInput').value = prefill.destination ? `${prefill.destination_city || cityByCode[prefill.destination] || prefill.destination} ${prefill.destination}` : '';
  $('#departInput').value = prefill.departure_date || defaults.departureDate;
  $('#returnInput').value = prefill.return_date || defaults.returnDate;
  $('#priceInput').value = '';
  $('#nonstopInput').checked = Boolean(prefill.nonstop);
  $('#departInput').min = formatInputDate(new Date());
  $('#returnInput').min = $('#departInput').value;
  $('#watchModalEyebrow').textContent = editing ? '編輯監控' : '新增監控';
  $('#watchModalTitle').textContent = editing ? '調整行程' : '想去哪裡？';
  $('#watchSubmitButton').textContent = editing ? '儲存變更' : '開始監控';
  updateEstimatedPrice();
  $('#watchModal').hidden = false;
  setTimeout(() => $('#toInput').focus(), 60);
}
function closeWatchModal() { $('#watchModal').hidden = true; }

function updateEstimatedPrice() {
  const destination = parseLocation($('#toInput').value);
  if (!destination) {
    $('#priceInput').value = '';
    $('#estimatedPriceLabel').textContent = '選擇目的地後自動估算';
    $('#estimateReason').textContent = '第一次巡價後會再依真實票價自動校正';
    return;
  }
  const origin = parseLocation($('#fromInput').value);
  const editingWatch = cloudWatches.find(item => String(item.id) === $('#watchId').value);
  const matchingPublic = publicResults.find(item => item.origin === origin?.code && item.destination === destination.code);
  const priceReference = editingWatch || matchingPublic;
  const estimateSource = priceReference
    ? { ...priceReference, origin:origin?.code, destination:destination.code, departure_date:$('#departInput').value }
    : { origin:origin?.code, destination:destination.code, departure_date:$('#departInput').value };
  const estimate = estimateTargetPrice(estimateSource);
  $('#priceInput').value = estimate;
  $('#estimatedPriceLabel').textContent = money(estimate);
  $('#estimateReason').textContent = estimateReason(estimateSource);
}

function readWatchForm() {
  const origin = parseLocation($('#fromInput').value);
  const destination = parseLocation($('#toInput').value);
  if (!origin || !destination) {
    const invalid = !origin ? $('#fromInput') : $('#toInput');
    invalid.setCustomValidity('找不到這個城市，請從建議中點選');
    invalid.reportValidity();
    return null;
  }
  if ($('#returnInput').value <= $('#departInput').value) {
    $('#returnInput').setCustomValidity('回程日期必須晚於去程日期');
    $('#returnInput').reportValidity();
    return null;
  }
  return {
    id: $('#watchId').value || undefined,
    origin: origin.code,
    origin_city: origin.city,
    destination: destination.code,
    destination_city: destination.city,
    departure_date: $('#departInput').value,
    return_date: $('#returnInput').value,
    target_price: Number($('#priceInput').value) || estimateTargetPrice({ destination:destination.code, departure_date:$('#departInput').value }),
    nonstop: $('#nonstopInput').checked,
    active: true
  };
}

async function saveCloudWatch(watch) {
  const payload = cloudPayloadFromWatch(watch);
  if (watch.id) {
    const { error } = await cloudClient.from('flight_watches').update(payload).eq('id', watch.id);
    if (error) throw error;
  } else {
    if (cloudWatches.length >= MAX_CLOUD_WATCHES) throw new Error(`免費測試版最多 ${MAX_CLOUD_WATCHES} 條監控`);
    const { error } = await cloudClient.from('flight_watches').insert(payload);
    if (error) throw error;
  }
  await loadCloudWatches({ seed:false });
}

async function submitWatch(event) {
  event.preventDefault();
  const watch = readWatchForm();
  if (!watch) return;
  if (!currentSession) {
    localStorage.setItem('flyday-pending-watch', JSON.stringify(watch));
    closeWatchModal();
    openAuthModal();
    showToast('差最後一步', '登入後會自動把這條監控存到雲端');
    return;
  }
  const button = $('#watchSubmitButton');
  button.disabled = true;
  button.textContent = '同步中…';
  try {
    await saveCloudWatch(watch);
    closeWatchModal();
    showToast(watch.id ? '監控已更新' : '監控已建立', '第一次取得真實票價後會自動校正');
  } catch (error) {
    showToast('儲存失敗', error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = watch.id ? '儲存變更' : '開始監控';
  }
}

async function handleWatchAction(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const watch = [...cloudWatches, ...publicResults].find(item => String(item.id) === button.dataset.id);
  if (!watch) return;
  const action = button.dataset.action;
  if (action === 'copy-public') {
    if (currentSession) {
      try { await saveCloudWatch({ ...watch, id:undefined }); showToast('已加入我的監控', `${watch.origin_city} → ${watch.destination_city}`); }
      catch (error) { showToast('無法加入', error.message, 'error'); }
    } else {
      localStorage.setItem('flyday-pending-watch', JSON.stringify({ ...watch, id:undefined }));
      openAuthModal();
    }
    return;
  }
  if (!currentSession) return openAuthModal();
  if (action === 'edit') return openWatchModal(watch, true);
  if (action === 'delete') {
    if (!confirm(`確定刪除「${watch.origin_city} → ${watch.destination_city}」嗎？`)) return;
    const { error } = await cloudClient.from('flight_watches').delete().eq('id', watch.id);
    if (error) return showToast('刪除失敗', error.message, 'error');
    await loadCloudWatches({ seed:false });
    showToast('監控已刪除');
  }
  if (action === 'pause') {
    const { error } = await cloudClient.from('flight_watches').update({ active:!watch.active }).eq('id', watch.id);
    if (error) return showToast('更新失敗', error.message, 'error');
    await loadCloudWatches({ seed:false });
    showToast(watch.active ? '監控已暫停' : '監控已重新啟用');
  }
}

async function toggleAccount() {
  switchView('settings');
}

async function accountSettingsAction() {
  if (!currentSession || currentSession.user.is_anonymous) return openAuthModal();
  if (!confirm('要登出這台裝置嗎？雲端監控不會被刪除。')) return;
  await cloudClient.auth.signOut({ scope:'local' });
  showToast('已登出', '你的雲端監控仍會繼續巡價');
}

async function enableBrowserNotifications() {
  if (!('Notification' in window)) return showToast('此瀏覽器不支援通知', 'iPhone 請先加入主畫面再開啟', 'error');
  const permission = await Notification.requestPermission();
  $('#browserNotificationText').textContent = permission === 'granted' ? '已允許通知；打開 Flyday 時會提醒達標航線。' : '尚未允許通知，可在瀏覽器設定中重新開啟。';
  $('#browserNotificationButton').textContent = permission === 'granted' ? '通知已開啟' : '重新嘗試';
  if (permission === 'granted') { showToast('瀏覽器通知已開啟'); renderAlerts(); }
}

async function installApp() {
  if (installPrompt) {
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    return;
  }
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  showToast(isIOS ? 'iPhone 安裝方式' : '安裝方式', isIOS ? '點 Safari 分享按鈕，再選「加入主畫面」' : '請從瀏覽器選單選擇「安裝 Flyday」');
}

function bindEvents() {
  $$('[data-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
  $$('[data-date-mode]').forEach(button => button.addEventListener('click', () => setQuickDateMode(button.dataset.dateMode)));
  $$('[data-view-link]').forEach(link => link.addEventListener('click', event => { event.preventDefault(); switchView(link.dataset.viewLink); }));
  $$('[data-open-watch]').forEach(button => button.addEventListener('click', () => openWatchModal()));
  $$('[data-close-watch]').forEach(button => button.addEventListener('click', closeWatchModal));
  $$('[data-close-auth]').forEach(button => button.addEventListener('click', closeAuthModal));
  $('#watchModal').addEventListener('click', event => { if (event.target === $('#watchModal')) closeWatchModal(); });
  $('#authModal').addEventListener('click', event => { if (event.target === $('#authModal')) closeAuthModal(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeWatchModal(); closeAuthModal(); } });
  $('#watchForm').addEventListener('submit', submitWatch);
  $('#quickWatchForm').addEventListener('submit', handleQuickWatchSubmit);
  $('#authForm').addEventListener('submit', sendLoginLink);
  $$('.quick-cities button').forEach(button => button.addEventListener('click', () => { $('#toInput').value = button.dataset.city; $('#toInput').setCustomValidity(''); updateEstimatedPrice(); }));
  [$('#fromInput'), $('#toInput')].forEach(input => input.addEventListener('input', () => { input.setCustomValidity(''); updateEstimatedPrice(); }));
  [$('#quickFromInput'), $('#quickToInput')].forEach(input => input.addEventListener('input', () => input.setCustomValidity('')));
  $('#quickDepartInput').addEventListener('change', () => { $('#quickReturnInput').min = $('#quickDepartInput').value; $('#quickReturnInput').setCustomValidity(''); });
  $('#quickReturnInput').addEventListener('change', () => $('#quickReturnInput').setCustomValidity(''));
  $('#quickMonthInput').addEventListener('change', () => $('#quickMonthInput').setCustomValidity(''));
  $('#departInput').addEventListener('change', () => { $('#returnInput').min = $('#departInput').value; $('#returnInput').setCustomValidity(''); updateEstimatedPrice(); });
  $('#returnInput').addEventListener('change', () => $('#returnInput').setCustomValidity(''));
  $('#watchGrid').addEventListener('click', handleWatchAction);
  $('#notificationButton').addEventListener('click', () => switchView('alerts'));
  $('#accountButton').addEventListener('click', toggleAccount);
  $('#cloudAccountButton').addEventListener('click', accountSettingsAction);
  $('#browserNotificationButton').addEventListener('click', enableBrowserNotifications);
  $('#installAppButton').addEventListener('click', installApp);
  $('#refreshButton').addEventListener('click', async () => {
    $('#refreshButton').textContent = '更新中…';
    await loadPublicData();
    if (currentSession) await loadCloudWatches({ seed:false });
    $('#refreshButton').textContent = '↻ 重新整理';
    showToast('已更新到最新資料');
  });
  window.addEventListener('online', setSyncState);
  window.addEventListener('offline', setSyncState);
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; });
}

async function init() {
  setPageClock();
  setupQuickWatchForm();
  bindEvents();
  const hashView = location.hash.replace('#', '');
  if (['home','alerts','settings'].includes(hashView)) switchView(hashView);
  await loadPublicData();
  await initCloud();
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

init().catch(error => showToast('網站載入失敗', error.message, 'error'));
