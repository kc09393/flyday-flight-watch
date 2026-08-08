const SUPABASE_URL = 'https://gumnsikbwvhogzawaoww.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ltaNA7nnVozoSCOcZIjg';
const MAX_CLOUD_WATCHES = 5;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHTML = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
const money = value => Number.isFinite(Number(value)) ? `NT$ ${Number(value).toLocaleString('zh-TW')}` : '等待首次巡價';
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

let publicResults = [];
let cloudWatches = [];
let currentSession = null;
let cloudClient = null;
let activeView = 'home';
let installPrompt = null;
let smartPrefill = null;
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
  return {
    id: item.id || `public-${index}`,
    origin: item.origin,
    origin_city: item.originCity || cityByCode[item.origin] || item.origin,
    destination: item.destination,
    destination_city: item.destinationCity || cityByCode[item.destination] || item.destination,
    departure_date: item.departureDate,
    return_date: item.returnDate,
    target_price: Number(item.targetPrice),
    current_price: Number.isFinite(Number(item.currentPrice)) ? Number(item.currentPrice) : null,
    previous_price: null,
    offer_count: Number(item.offerCount || 0),
    provider: 'Google Flights via SerpApi',
    search_url: item.searchUrl,
    last_checked_at: item.checkedAt,
    nonstop: Boolean(item.nonStop),
    active: true,
    public: true,
    ai_advice: item.aiAdvice || null
  };
}

function visibleWatches() {
  return currentSession ? cloudWatches : publicResults;
}

function watchHit(watch) {
  return Number.isFinite(Number(watch.current_price)) && Number(watch.current_price) <= Number(watch.target_price);
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
  $('#accountLabel').textContent = email ? email.split('@')[0] : '登入同步';
  $('.avatar').textContent = email ? email.charAt(0).toUpperCase() : 'KC';
  $('#cloudAccountText').textContent = email ? `已使用 ${email} 登入，監控清單會跨裝置同步。` : '尚未登入，目前顯示公開巡價資料。';
  $('#cloudAccountButton').textContent = email ? '登出這台裝置' : '使用 Email 登入';
  setSyncState();
}

function renderWatches() {
  const watches = visibleWatches();
  $('#watchGrid').innerHTML = watches.map(watch => {
    const hit = watchHit(watch);
    const hasPrice = Number.isFinite(Number(watch.current_price));
    const statusClass = hit ? 'hit' : hasPrice ? 'live' : '';
    const statusText = !watch.active ? '已暫停' : hit ? '達到目標價' : hasPrice ? '每日巡價中' : '等待首次巡價';
    const ownerActions = currentSession && !watch.public ? `
      <div class="card-menu"><button data-action="edit" data-id="${escapeHTML(watch.id)}">編輯</button><button class="danger" data-action="delete" data-id="${escapeHTML(watch.id)}">刪除</button></div>` : '';
    const secondaryAction = currentSession && !watch.public
      ? `<button class="pause-button" data-action="pause" data-id="${escapeHTML(watch.id)}">${watch.active ? '暫停' : '啟用'}</button>`
      : `<button class="pause-button" data-action="copy-public" data-id="${escapeHTML(watch.id)}">加入我的</button>`;
    return `<article class="watch-card ${watch.active ? '' : 'paused'}">
      <div class="watch-status-row"><span class="status-pill ${statusClass}">${statusText}</span>${ownerActions}</div>
      <div class="route-title"><span class="flag">${routeIcons[watch.destination] || '🌏'}</span><div><h3>${escapeHTML(watch.origin_city)} → ${escapeHTML(watch.destination_city)}</h3><p>${escapeHTML(watch.origin)} → ${escapeHTML(watch.destination)}・${dateLabel(watch.departure_date)}－${dateLabel(watch.return_date)}</p></div></div>
      <div class="price-row"><div class="price-main"><span>${hasPrice ? '目前最低・來回含稅' : '價格狀態'}</span><strong class="${hasPrice ? '' : 'pending'}">${money(watch.current_price)}</strong></div><div class="target-price"><span>通知價格</span><strong>${money(watch.target_price)}</strong></div></div>
      <div class="card-actions"><a class="flight-link" href="${escapeHTML(googleFlightsUrl(watch))}" target="_blank" rel="noopener">查看 Google Flights</a>${secondaryAction}</div>
    </article>`;
  }).join('');
  $('#emptyState').hidden = watches.length > 0;
  const hitCount = watches.filter(watchHit).length;
  $('#welcomeSummary').textContent = currentSession
    ? `${watches.length} 條航線已同步到雲端${hitCount ? `，其中 ${hitCount} 條已達目標價。` : '，Flyday 會每天自動巡價。'}`
    : `目前有 ${watches.length} 條公開真實巡價；登入後即可建立自己的跨裝置監控。`;
  renderAlerts();
}

function renderAlerts() {
  const hits = visibleWatches().filter(watch => watch.active && watchHit(watch));
  $('#alertList').innerHTML = hits.map(watch => `<article class="alert-card"><span class="alert-icon">✦</span><div class="alert-copy"><strong>${escapeHTML(watch.origin_city)} → ${escapeHTML(watch.destination_city)} 已達標</strong><span>${fullDateLabel(watch.departure_date)} 出發・目前 ${money(watch.current_price)}・目標 ${money(watch.target_price)}</span></div><a href="${escapeHTML(googleFlightsUrl(watch))}" target="_blank" rel="noopener">查看航班</a></article>`).join('');
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
    new Notification(`Flyday：${watch.destination_city} 已達目標價`, { body:`目前 ${money(watch.current_price)}，你設定的是 ${money(watch.target_price)}`, icon:'./icon.svg' });
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
    target_price: Number(watch.target_price),
    currency: 'TWD',
    adults: 1,
    cabin: 'economy',
    nonstop: Boolean(watch.nonstop),
    active: watch.active !== false,
    current_price: Number.isFinite(Number(watch.current_price)) ? Number(watch.current_price) : null,
    offer_count: Number(watch.offer_count || 0),
    provider: watch.provider || null,
    search_url: watch.search_url || null,
    last_checked_at: watch.last_checked_at || null
  };
}

async function seedStarterWatches() {
  if (!currentSession || cloudWatches.length || !publicResults.length) return;
  const starters = publicResults.slice(0, 3).map(cloudPayloadFromWatch);
  const { error } = await cloudClient.from('flight_watches').insert(starters);
  if (error) throw error;
}

async function loadCloudWatches({ seed = true } = {}) {
  if (!currentSession) return;
  const { data, error } = await cloudClient.from('flight_watches').select('*').order('created_at', { ascending:true });
  if (error) throw error;
  cloudWatches = data || [];
  if (seed && cloudWatches.length === 0 && publicResults.length) {
    await seedStarterWatches();
    return loadCloudWatches({ seed:false });
  }
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
  await handleSession(data.session);
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
  const { error } = await cloudClient.auth.signInWithOtp({ email, options:{ emailRedirectTo:redirect, shouldCreateUser:true } });
  button.disabled = false;
  button.textContent = '重新寄送登入連結';
  if (error) {
    showToast('登入信寄送失敗', error.message, 'error');
    return;
  }
  $('#authMessage').hidden = false;
  $('#authMessage').innerHTML = `登入信已寄到 <strong>${escapeHTML(email)}</strong>。請打開信件並點擊連結，回來後就會自動同步。`;
}

function openWatchModal(prefill = {}, editing = false) {
  const defaults = defaultDates();
  $('#watchId').value = prefill.id || '';
  $('#fromInput').value = prefill.origin ? `${prefill.origin_city || cityByCode[prefill.origin] || prefill.origin} ${prefill.origin}` : '台北 TPE';
  $('#toInput').value = prefill.destination ? `${prefill.destination_city || cityByCode[prefill.destination] || prefill.destination} ${prefill.destination}` : '';
  $('#departInput').value = prefill.departure_date || defaults.departureDate;
  $('#returnInput').value = prefill.return_date || defaults.returnDate;
  $('#priceInput').value = prefill.target_price || '';
  $('#nonstopInput').checked = Boolean(prefill.nonstop);
  $('#departInput').min = formatInputDate(new Date());
  $('#returnInput').min = $('#departInput').value;
  $('#watchModalEyebrow').textContent = editing ? '編輯監控' : '新增監控';
  $('#watchModalTitle').textContent = editing ? '調整行程' : '想去哪裡？';
  $('#watchSubmitButton').textContent = editing ? '儲存變更' : '開始監控';
  $('#watchModal').hidden = false;
  setTimeout(() => $('#toInput').focus(), 60);
}
function closeWatchModal() { $('#watchModal').hidden = true; smartPrefill = null; }

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
    target_price: Number($('#priceInput').value),
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
    showToast(watch.id ? '監控已更新' : '監控已建立', '最晚會在明天早上完成首次巡價');
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

function parseSmartPrompt(prompt) {
  const destinationCity = Object.keys(cityCodes).find(city => city !== '台北' && prompt.includes(city));
  if (!destinationCity) return null;
  const dates = defaultDates();
  const dateMatch = prompt.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (dateMatch) {
    const now = new Date();
    let year = now.getFullYear();
    if (Number(dateMatch[1]) < now.getMonth() + 1) year += 1;
    dates.departureDate = `${year}-${String(dateMatch[1]).padStart(2,'0')}-${String(dateMatch[2]).padStart(2,'0')}`;
  }
  if (/週末|周末|週五/.test(prompt) && !dateMatch) {
    const friday = new Date();
    const add = (5 - friday.getDay() + 7) % 7 || 7;
    friday.setDate(friday.getDate() + add + 7);
    dates.departureDate = formatInputDate(friday);
  }
  const nightsMatch = prompt.match(/([2-9]|兩|三|四|五|六|七|八|九)\s*天/);
  const numberMap = { 兩:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9 };
  const days = nightsMatch ? Number(nightsMatch[1]) || numberMap[nightsMatch[1]] : (/週末|周末/.test(prompt) ? 3 : 5);
  const returning = new Date(`${dates.departureDate}T00:00:00`);
  returning.setDate(returning.getDate() + Math.max(1, days - 1));
  dates.returnDate = formatInputDate(returning);
  const priceMatches = [...prompt.matchAll(/([0-9][0-9,]{2,})\s*(?:元|塊|以下|內)?/g)];
  const price = priceMatches.length ? Number(priceMatches.at(-1)[1].replaceAll(',', '')) : 10000;
  return { origin:'TPE', origin_city:'台北', destination:cityCodes[destinationCity], destination_city:destinationCity, departure_date:dates.departureDate, return_date:dates.returnDate, target_price:price, nonstop:false };
}

function handleSmartSubmit(event) {
  event.preventDefault();
  const prompt = $('#smartPrompt').value.trim();
  if (!prompt) return;
  const parsed = parseSmartPrompt(prompt);
  const result = $('#smartResult');
  result.hidden = false;
  if (!parsed) {
    result.textContent = '我還找不到目的地。請加入城市，例如「台北去重慶，玩 7 天，16,000 元內」。';
    return;
  }
  smartPrefill = parsed;
  result.innerHTML = `已整理：<strong>${escapeHTML(parsed.origin_city)} → ${escapeHTML(parsed.destination_city)}</strong>・${dateLabel(parsed.departure_date)}－${dateLabel(parsed.return_date)}・${money(parsed.target_price)} 以下<button type="button" id="useSmartResult">確認建立</button>`;
  $('#useSmartResult').addEventListener('click', () => openWatchModal(smartPrefill));
}

async function toggleAccount() {
  if (!currentSession) return openAuthModal();
  switchView('settings');
}

async function accountSettingsAction() {
  if (!currentSession) return openAuthModal();
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
  $$('[data-view-link]').forEach(link => link.addEventListener('click', event => { event.preventDefault(); switchView(link.dataset.viewLink); }));
  $$('[data-open-watch]').forEach(button => button.addEventListener('click', () => openWatchModal()));
  $$('[data-close-watch]').forEach(button => button.addEventListener('click', closeWatchModal));
  $$('[data-close-auth]').forEach(button => button.addEventListener('click', closeAuthModal));
  $('#watchModal').addEventListener('click', event => { if (event.target === $('#watchModal')) closeWatchModal(); });
  $('#authModal').addEventListener('click', event => { if (event.target === $('#authModal')) closeAuthModal(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeWatchModal(); closeAuthModal(); } });
  $('#watchForm').addEventListener('submit', submitWatch);
  $('#authForm').addEventListener('submit', sendLoginLink);
  $('#smartForm').addEventListener('submit', handleSmartSubmit);
  $$('.smart-chips button').forEach(button => button.addEventListener('click', () => { $('#smartPrompt').value = button.dataset.smart; $('#smartForm').requestSubmit(); }));
  $$('.quick-cities button').forEach(button => button.addEventListener('click', () => { $('#toInput').value = button.dataset.city; $('#toInput').setCustomValidity(''); }));
  [$('#fromInput'), $('#toInput')].forEach(input => input.addEventListener('input', () => input.setCustomValidity('')));
  $('#departInput').addEventListener('change', () => { $('#returnInput').min = $('#departInput').value; $('#returnInput').setCustomValidity(''); });
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
  bindEvents();
  const hashView = location.hash.replace('#', '');
  if (['home','alerts','settings'].includes(hashView)) switchView(hashView);
  await loadPublicData();
  await initCloud();
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

init().catch(error => showToast('網站載入失敗', error.message, 'error'));