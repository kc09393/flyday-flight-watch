const defaultWatches = [
  { icon:'🇯🇵', from:'TPE', fromCity:'台北', to:'NRT', toCity:'東京', dates:'10/15 — 10/20・5 晚', price:8420, change:'↓ 12.4%', hit:true },
  { icon:'🇰🇷', from:'TPE', fromCity:'台北', to:'ICN', toCity:'首爾', dates:'11/07 — 11/11・4 晚', price:6170, change:'↓ 5.8%' },
  { icon:'🇹🇭', from:'TPE', fromCity:'台北', to:'BKK', toCity:'曼谷', dates:'12/29 — 01/03・5 晚', price:12880, change:'↑ 2.1%', up:true }
];

const saved = JSON.parse(localStorage.getItem('flyday-watches') || 'null');
let watches = saved || defaultWatches;
const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];

function formatPrice(n){ return `NT$ ${Number(n).toLocaleString('zh-TW')}`; }

function renderWatches(){
  $('#watchGrid').innerHTML = watches.map((w, i) => `
    <article class="watch-card">
      ${w.hit ? '<span class="hit-badge">達到目標價</span>' : ''}
      <div class="watch-top"><div class="country-icon">${w.icon}</div><button class="watch-menu" data-remove="${i}" aria-label="航線選單">•••</button></div>
      <div class="watch-route">
        <div class="airport"><strong>${w.from}</strong><span>${w.fromCity}</span></div><div class="route-line"></div><div class="airport"><strong>${w.to}</strong><span>${w.toCity}</span></div>
      </div>
      <div class="watch-date">${w.dates}</div>
      <div class="watch-bottom"><div class="watch-price"><span>目前最低・來回含稅</span><strong>${formatPrice(w.price)}</strong></div><span class="price-change ${w.up?'up':''}">${w.change}</span></div>
    </article>`).join('');
  $('#watchCount').textContent = watches.length;
  const welcomeCount = $('#welcomeCount');
  if (welcomeCount) welcomeCount.textContent = watches.length;
  localStorage.setItem('flyday-watches', JSON.stringify(watches));
}

renderWatches();

const modal = $('#watchModal');
function openModal(){ modal.hidden = false; setTimeout(()=>$('#toInput').focus(), 50); }
function closeModal(){ modal.hidden = true; }
$$('[data-open-modal]').forEach(btn => btn.addEventListener('click', openModal));
$('.close-modal').addEventListener('click', closeModal);
modal.addEventListener('click', e => { if(e.target === modal) closeModal(); });
document.addEventListener('keydown', e => { if(e.key === 'Escape') closeModal(); });

$('#swapBtn').addEventListener('click', () => {
  const from = $('#fromInput').value;
  $('#fromInput').value = $('#toInput').value;
  $('#toInput').value = from;
});

$('#watchForm').addEventListener('submit', e => {
  e.preventDefault();
  const toRaw = $('#toInput').value.trim();
  const [toCity, code='DST'] = toRaw.split(/\s+/);
  const depart = new Date($('#departInput').value);
  const back = new Date($('#returnInput').value);
  const nights = Math.max(1, Math.round((back - depart) / 86400000));
  const dateFmt = d => `${d.getMonth()+1}/${String(d.getDate()).padStart(2,'0')}`;
  watches.unshift({ icon:'🌏', from:'TPE', fromCity:'台北', to:code.replace(/[()]/g,'').toUpperCase(), toCity, dates:`${dateFmt(depart)} — ${dateFmt(back)}・${nights} 晚`, price:Number($('#priceInput').value), change:'開始追蹤' });
  renderWatches(); closeModal(); showToast(); e.target.reset();
});

function showToast(){ const toast=$('#toast'); toast.classList.add('show'); setTimeout(()=>toast.classList.remove('show'), 3200); }

$('.check-row').addEventListener('click', e => {
  if(e.target.tagName !== 'INPUT'){
    const input=$('.check-row input'); input.checked=!input.checked; e.preventDefault();
  }
});

const aiForm = $('#aiForm');
$$('.prompt-chip').forEach(chip => chip.addEventListener('click', () => { $('#aiPrompt').value=chip.textContent; aiForm.requestSubmit(); }));
aiForm.addEventListener('submit', e => {
  e.preventDefault();
  const prompt=$('#aiPrompt').value.trim(); if(!prompt) return;
  const reply=$('#aiReply'); reply.hidden=false; $('.reply-loader',reply).style.display='block'; $('.reply-content',reply).innerHTML='';
  setTimeout(()=>{
    $('.reply-loader',reply).style.display='none';
    let response='我理解了：你想找一趟兼顧價格與時間的旅程。我會比較鄰近日期、行李費與轉機風險，而不只看最低標價。';
    if(/大阪|日本|東京/.test(prompt)) response='找到方向了：<strong>台北出發、日本、避開紅眼</strong>。目前 9 月大阪週末來回約 NT$ 5,680，是近 60 天低點；東京 10 月中則建議把 10/14 納入彈性日期。';
    if(/跨年/.test(prompt)) response='跨年熱門線已偏高。若目的地彈性，<strong>馬尼拉 NT$ 6,900、河內 NT$ 7,430</strong> 的價格相對合理；曼谷目前建議再等等。';
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

const routeIcons = { NRT:'🇯🇵', HND:'🇯🇵', ICN:'🇰🇷', GMP:'🇰🇷', BKK:'🇹🇭', DMK:'🇹🇭' };

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
        aiAdvice: result.aiAdvice || null
      };
      if(existing) Object.assign(existing, normalized);
      else watches.push(normalized);
    });
    renderWatches();
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
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installButton.hidden = false;
});
installButton?.addEventListener('click', async () => {
  if(!deferredInstallPrompt) return;
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
