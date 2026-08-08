const defaultWatches = [
  { icon:'🇯🇵', from:'TPE', fromCity:'台北', to:'NRT', toCity:'東京', dates:'10/15 — 10/20・5 晚', price:8420, change:'範例價格', sample:true },
  { icon:'🇰🇷', from:'TPE', fromCity:'台北', to:'ICN', toCity:'首爾', dates:'11/07 — 11/11・4 晚', price:6170, change:'範例價格', sample:true },
  { icon:'🇹🇭', from:'TPE', fromCity:'台北', to:'BKK', toCity:'曼谷', dates:'12/29 — 01/03・5 晚', price:12880, change:'範例價格', sample:true }
];

let saved = null;
try { saved = JSON.parse(localStorage.getItem('flyday-watches') || 'null'); }
catch { localStorage.removeItem('flyday-watches'); }
let watches = Array.isArray(saved) ? saved.map(watch => {
  if(watch.live || watch.sample) return watch;
  if(['開始追蹤', '等待 API 啟用'].includes(watch.change)) return { ...watch, change:'等待雲端同步' };
  if(/[↓↑]|%/.test(watch.change || '')) return { ...watch, change:'範例價格', hit:false, up:false, sample:true };
  return watch;
}) : defaultWatches;
const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];

function formatPrice(n){ return `NT$ ${Number(n).toLocaleString('zh-TW')}`; }
function escapeHTML(value){ return String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]); }

function setPageClock(){
  const now = new Date();
  $('#todayLabel').textContent = new Intl.DateTimeFormat('zh-TW', {
    year:'numeric', month:'long', day:'numeric', weekday:'long'
  }).format(now).replace('星期', '・星期');
  $('#greetingLabel').textContent = now.getHours() < 11 ? '早安' : now.getHours() < 18 ? '午安' : '晚安';
}

function renderWatches(){
  $('#watchGrid').innerHTML = watches.map((w, i) => `
    <article class="watch-card">
      ${w.live && w.hit ? '<span class="hit-badge">達到目標價</span>' : w.sample ? '<span class="hit-badge">介面範例</span>' : ''}
      <div class="watch-top"><div class="country-icon">${escapeHTML(w.icon)}</div><button class="watch-menu" data-remove="${i}" aria-label="航線選單">•••</button></div>
      <div class="watch-route">
        <div class="airport"><strong>${escapeHTML(w.from)}</strong><span>${escapeHTML(w.fromCity)}</span></div><div class="route-line"></div><div class="airport"><strong>${escapeHTML(w.to)}</strong><span>${escapeHTML(w.toCity)}</span></div>
      </div>
      <div class="watch-date">${escapeHTML(w.dates)}</div>
      <div class="watch-bottom"><div class="watch-price"><span>${w.live ? '目前最低・來回含稅' : w.sample ? '範例參考價・非即時' : '你的目標價格'}</span><strong>${formatPrice(w.price)}</strong></div><span class="price-change ${w.up?'up':''}">${escapeHTML(w.change)}</span></div>
    </article>`).join('');
  $('#watchCount').textContent = watches.length;
  const welcomeCount = $('#welcomeCount');
  if (welcomeCount) welcomeCount.textContent = watches.length;
  localStorage.setItem('flyday-watches', JSON.stringify(watches));
}

setPageClock();
renderWatches();

const modal = $('#watchModal');
function formatInputDate(date){
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function setDefaultTravelDates(){
  const departInput = $('#departInput');
  const returnInput = $('#returnInput');
  if(departInput.value && returnInput.value) return;
  const depart = new Date();
  depart.setDate(depart.getDate() + 30);
  const back = new Date(depart);
  back.setDate(back.getDate() + 7);
  departInput.value = formatInputDate(depart);
  returnInput.value = formatInputDate(back);
  departInput.min = formatInputDate(new Date());
  returnInput.min = formatInputDate(depart);
}
function openModal(){ modal.hidden = false; setDefaultTravelDates(); setTimeout(()=>$('#toInput').focus(), 50); }
function closeModal(){ modal.hidden = true; }
$$('[data-open-modal]').forEach(btn => btn.addEventListener('click', openModal));
$('.close-modal').addEventListener('click', closeModal);
modal.addEventListener('click', e => { if(e.target === modal) closeModal(); });
document.addEventListener('keydown', e => { if(e.key === 'Escape') closeModal(); });

const cityCodes = {
  台北:'TPE', 桃園:'TPE', 台中:'RMQ', 高雄:'KHH',
  東京:'NRT', 大阪:'KIX', 京都:'KIX', 名古屋:'NGO', 札幌:'CTS', 福岡:'FUK', 沖繩:'OKA',
  首爾:'ICN', 釜山:'PUS', 曼谷:'BKK', 清邁:'CNX', 普吉島:'HKT',
  香港:'HKG', 澳門:'MFM', 新加坡:'SIN', 吉隆坡:'KUL',
  河內:'HAN', 峴港:'DAD', 胡志明:'SGN', 馬尼拉:'MNL', 宿霧:'CEB',
  重慶:'CKG', 上海:'PVG', 北京:'PEK', 成都:'CTU', 廣州:'CAN', 深圳:'SZX',
  杭州:'HGH', 南京:'NKG', 武漢:'WUH', 西安:'XIY', 廈門:'XMN', 青島:'TAO',
  Chongqing:'CKG', Tokyo:'NRT', Osaka:'KIX', Seoul:'ICN', Bangkok:'BKK'
};
function parseLocation(value){
  const cleaned = value.trim().replace(/[()]/g, ' ');
  const codeMatch = cleaned.toUpperCase().match(/\b([A-Z]{3})\b/);
  const city = cleaned.replace(/\b[A-Za-z]{3}\b/, '').trim() || codeMatch?.[1] || '';
  const matchedCity = Object.keys(cityCodes).find(name => name.toLowerCase() === city.toLowerCase());
  const code = codeMatch?.[1] || cityCodes[matchedCity];
  return code ? { city, code } : null;
}
$$('[data-city]').forEach(button => button.addEventListener('click', () => {
  $('#toInput').value = button.dataset.city;
  $('#toInput').setCustomValidity('');
}));
[$('#fromInput'), $('#toInput')].forEach(input => input.addEventListener('input', () => input.setCustomValidity('')));
$('#departInput').addEventListener('change', () => {
  $('#returnInput').min = $('#departInput').value;
  $('#returnInput').setCustomValidity('');
});
$('#returnInput').addEventListener('input', () => $('#returnInput').setCustomValidity(''));

$('#watchForm').addEventListener('submit', e => {
  e.preventDefault();
  const fromInfo = parseLocation($('#fromInput').value);
  const toInfo = parseLocation($('#toInput').value);
  if(!fromInfo || !toInfo){
    const invalidInput = !fromInfo ? $('#fromInput') : $('#toInput');
    invalidInput.setCustomValidity('找不到這個城市，請點選下方的快速城市，或輸入中文城市名稱');
    invalidInput.reportValidity();
    return;
  }
  $('#toInput').setCustomValidity('');
  const depart = new Date($('#departInput').value);
  const back = new Date($('#returnInput').value);
  if(back <= depart){
    $('#returnInput').setCustomValidity('回程日期必須晚於去程日期');
    $('#returnInput').reportValidity();
    return;
  }
  $('#returnInput').setCustomValidity('');
  const nights = Math.max(1, Math.round((back - depart) / 86400000));
  const dateFmt = d => `${d.getMonth()+1}/${String(d.getDate()).padStart(2,'0')}`;
  watches.unshift({ icon:routeIcons[toInfo.code] || '🌏', from:fromInfo.code, fromCity:fromInfo.city, to:toInfo.code, toCity:toInfo.city, dates:`${dateFmt(depart)} — ${dateFmt(back)}・${nights} 晚`, price:Number($('#priceInput').value), change:'等待雲端同步' });
  renderWatches(); closeModal();
  $('#toast strong').textContent='已儲存在這台手機';
  $('#toast small').textContent='雲端同步功能完成後會自動開始巡價';
  showToast(); e.target.reset(); setDefaultTravelDates();
});

function showToast(){ const toast=$('#toast'); toast.classList.add('show'); setTimeout(()=>toast.classList.remove('show'), 3200); }


const aiForm = $('#aiForm');
$$('.prompt-chip').forEach(chip => chip.addEventListener('click', () => { $('#aiPrompt').value=chip.textContent; aiForm.requestSubmit(); }));
aiForm.addEventListener('submit', e => {
  e.preventDefault();
  const prompt=$('#aiPrompt').value.trim(); if(!prompt) return;
  const reply=$('#aiReply'); reply.hidden=false; $('.reply-loader',reply).style.display='block'; $('.reply-content',reply).innerHTML='';
  setTimeout(()=>{
    $('.reply-loader',reply).style.display='none';
    let response='<strong>功能預覽：</strong>我理解了你的旅程需求。接上 AI 與航班 API 後，會比較鄰近日期、行李費與轉機風險，而不只看最低標價。';
    if(/大阪|日本|東京/.test(prompt)) response='<strong>功能預覽：</strong>已理解「台北出發、日本、避開紅眼」。正式啟用後會用即時航班資料比較日期與總價。';
    if(/跨年/.test(prompt)) response='<strong>功能預覽：</strong>已理解你想比較跨年目的地。正式啟用後會列出當時查到的真實價格，不會使用畫面上的範例數字。';
    $('.reply-content',reply).innerHTML=`${response}<button type="button" data-ai-watch>建立監控</button>`;
    $('[data-ai-watch]',reply).addEventListener('click',openModal);
  }, 850);
});

$$('.range-tabs button').forEach(btn=>btn.addEventListener('click',()=>{ $$('.range-tabs button').forEach(b=>b.classList.remove('active'));btn.classList.add('active'); }));
$$('.deal-filter button').forEach(btn=>btn.addEventListener('click',()=>{
  $$('.deal-filter button').forEach(b=>b.classList.remove('active')); btn.classList.add('active');
  $$('.deal-row').forEach(row=>row.style.display=(btn.textContent==='全部'||row.dataset.region===btn.textContent)?'grid':'none');
}));
$$('.round-arrow').forEach(btn=>btn.addEventListener('click',()=>{ $('#toast strong').textContent='已加入候選清單'; $('#toast small').textContent='AI 會繼續幫你比較這個航班'; showToast(); }));
$('#viewFlightsBtn').addEventListener('click',()=>document.querySelector('#explore').scrollIntoView({behavior:'smooth'}));
$('#menuBtn').addEventListener('click',()=>$('.sidebar').classList.toggle('open'));
$$('.nav-item').forEach(link=>link.addEventListener('click',()=>{ $$('.nav-item').forEach(a=>a.classList.remove('active'));link.classList.add('active');$('.sidebar').classList.remove('open'); }));

const routeIcons = { NRT:'🇯🇵', HND:'🇯🇵', KIX:'🇯🇵', FUK:'🇯🇵', OKA:'🇯🇵', CTS:'🇯🇵', NGO:'🇯🇵', ICN:'🇰🇷', GMP:'🇰🇷', PUS:'🇰🇷', BKK:'🇹🇭', DMK:'🇹🇭', CNX:'🇹🇭', HKT:'🇹🇭', HKG:'🇭🇰', MFM:'🇲🇴', SIN:'🇸🇬', KUL:'🇲🇾', HAN:'🇻🇳', DAD:'🇻🇳', SGN:'🇻🇳', MNL:'🇵🇭', CEB:'🇵🇭', CKG:'🇨🇳', PVG:'🇨🇳', PEK:'🇨🇳', CTU:'🇨🇳', CAN:'🇨🇳', SZX:'🇨🇳', HGH:'🇨🇳', NKG:'🇨🇳', WUH:'🇨🇳', XIY:'🇨🇳', XMN:'🇨🇳', TAO:'🇨🇳' };

function displayDateRange(departureDate, returnDate){
  const short = value => {
    const date = new Date(`${value}T00:00:00`);
    return `${date.getMonth()+1}/${String(date.getDate()).padStart(2,'0')}`;
  };
  const nights = Math.max(1, Math.round((new Date(returnDate) - new Date(departureDate)) / 86400000));
  return `${short(departureDate)} — ${short(returnDate)}・${nights} 晚`;
}

async function hydrateLivePrices(){
  try {
    const response = await fetch('./data/latest.json', { cache:'no-store' });
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    const live = await response.json();
    if(live.updatedAt){
      $('#lastUpdated').textContent = `最後更新 ${new Date(live.updatedAt).toLocaleString('zh-TW', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' })}`;
    }
    if(live.status === 'needs_configuration'){
      $('#dataStatus').textContent = 'Flyday beta・等待航班 API 憑證';
      $('#monitorStatusTitle').textContent = '準備啟用巡價';
      $('#monitorStatusDetail').textContent = '補上航班 API 後每天更新';
      return;
    }
    if(!Array.isArray(live.results) || !live.results.length) return;

    live.results.forEach(result => {
      const existing = watches.find(item => item.from === result.origin && item.to === result.destination);
      const change = result.changePct === null || result.changePct === undefined
        ? '最新報價'
        : `${result.changePct <= 0 ? '↓' : '↑'} ${Math.abs(result.changePct)}%`;
      const normalized = {
        icon: routeIcons[result.destination] || '🌏',
        from: result.origin,
        fromCity: result.originCity,
        to: result.destination,
        toCity: result.destinationCity,
        dates: displayDateRange(result.departureDate, result.returnDate),
        price: result.currentPrice || result.targetPrice,
        change,
        hit: Boolean(result.targetHit),
        up: Number(result.changePct) > 0,
        live: true,
        sample: false,
        aiAdvice: result.aiAdvice || null
      };
      if(existing) Object.assign(existing, normalized);
      else watches.push(normalized);
    });
    renderWatches();
    const hitCount = live.results.filter(result => result.targetHit).length;
    $('#welcomeSummary').innerHTML = `<span id="welcomeCount">${watches.length}</span> 條航線正在巡價，其中 <strong>${hitCount} 條已達目標價</strong>。不用一直重整，值得買時我們會告訴你。`;
    $('#monitorStatusTitle').textContent = 'AI 巡價中';
    $('#monitorStatusDetail').textContent = `剛剛更新 ${live.results.length} 條監控航線`;
    $('#dataStatus').textContent = live.status === 'partial' ? '真實票價・部分航線更新' : `真實票價・${live.provider || '航班 API'}`;
    const featured = live.results.find(result => result.destination === 'NRT') || live.results[0];
    if(featured?.currentPrice){
      const chartPrice = $('.chart-meta strong');
      if(chartPrice) chartPrice.textContent = formatPrice(featured.currentPrice);
      const insight = $('.ai-insight p');
      if(insight && featured.aiAdvice) insight.textContent = featured.aiAdvice;
    }
  } catch(error){
    $('#dataStatus').textContent = navigator.onLine ? '暫時無法取得最新票價' : '離線模式・顯示上次資料';
  }
}

hydrateLivePrices();

if('serviceWorker' in navigator){
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

let deferredInstallPrompt;
const installButton = $('#installAppBtn');
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
if(isIOS && !isStandalone){
  installButton.hidden = false;
  installButton.textContent = '加入主畫面';
}
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installButton.hidden = false;
});
installButton?.addEventListener('click', async () => {
  if(!deferredInstallPrompt){
    if(isIOS){
      $('#toast strong').textContent = '安裝到 iPhone';
      $('#toast small').textContent = '按 Safari 分享按鈕，再選「加入主畫面」';
      showToast();
    }
    return;
  }
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installButton.hidden = true;
});
window.addEventListener('appinstalled', () => {
  installButton.hidden = true;
  $('#toast strong').textContent = 'Flyday 已安裝';
  $('#toast small').textContent = '之後可以從手機主畫面直接開啟';
  showToast();
});
