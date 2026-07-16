// ===== Rule of thumb thresholds (referensi umum, bukan patokan mutlak) =====
const BENCHMARK = {
  ROE: { good: 15, mid: 8, unit: '%', lowerIsBetter: false },
  ROA: { good: 8, mid: 3, unit: '%', lowerIsBetter: false },
  NPM: { good: 10, mid: 5, unit: '%', lowerIsBetter: false },
  DER: { good: 0.5, mid: 1, unit: 'x', lowerIsBetter: true },
  PER: { good: 10, mid: 20, unit: 'x', lowerIsBetter: true },
  PBV: { good: 1, mid: 3, unit: 'x', lowerIsBetter: true },
};

const SECTOR_COLORS = {
  'Perbankan': 'from-blue-500 to-blue-600',
  'Otomotif': 'from-emerald-400 to-emerald-600',
  'Infrastruktur': 'from-rose-500 to-rose-600',
  'Lainnya': 'from-slate-500 to-slate-600'
};

let stocks = [];
let portfolio = [];
let editingKode = null;
let currentAvgTarget = null;
let currentDivTarget = null;
let referensi = {};
let watchlistMode = 'swing'; // 'swing' | 'scalping'

// ===== Backend call =====
async function callBackend(action, params = {}, method = 'GET', body = null) {
  let url = API_URL;
  if (method === 'GET') {
    const qs = new URLSearchParams({ action, ...params }).toString();
    url += '?' + qs;
    const res = await fetch(url);
    return res.json();
  } else {
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({ action, ...body }),
    });
    return res.json();
  }
}

function apiReady() {
  return API_URL && !API_URL.includes('PASTE_URL');
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  registerServiceWorker();
  bindNav();
  bindForm();
  bindAveragingModal();
  bindDividendModal();
  bindAddPositionModal();
  loadWatchlist();
  loadReferensi();
});

// Kamus Kode->Nama->Sektor untuk auto-isi form. Gagal ambil pun tidak fatal --
// form tetap bisa diisi manual seperti biasa, cuma auto-isinya yang tidak jalan.
async function loadReferensi() {
  if (!apiReady()) return;
  try {
    const res = await callBackend('referensi');
    if (res.ok) referensi = res.data;
  } catch (err) {
    console.warn('Sahamku: gagal memuat kamus referensi', err);
  }
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then(() => console.log('Sahamku: service worker aktif.'))
        .catch(err => console.error('Sahamku: gagal daftar service worker', err));
    });
  }
}

function bindNav() {
  document.getElementById('tab-watchlist').addEventListener('click', () => switchTab('watchlist'));
  document.getElementById('tab-portfolio').addEventListener('click', () => switchTab('portfolio'));
  document.getElementById('tab-form').addEventListener('click', () => openForm(null));
  document.getElementById('btn-refresh').addEventListener('click', () => { loadWatchlist(); loadPortfolio(); });
  document.getElementById('btn-add-position').addEventListener('click', openAddPositionModal);
  document.getElementById('mode-swing').addEventListener('click', () => setWatchlistMode('swing'));
  document.getElementById('mode-scalping').addEventListener('click', () => setWatchlistMode('scalping'));
  setWatchlistMode('swing');
}

function setWatchlistMode(mode) {
  watchlistMode = mode;
  document.getElementById('mode-swing').classList.toggle('tab-active', mode === 'swing');
  document.getElementById('mode-swing').classList.toggle('tab-inactive', mode !== 'swing');
  document.getElementById('mode-scalping').classList.toggle('tab-active', mode === 'scalping');
  document.getElementById('mode-scalping').classList.toggle('tab-inactive', mode !== 'scalping');

  document.getElementById('mode-note').textContent = mode === 'swing'
    ? 'Fokus rasio fundamental (ROE, PER, DER, dst) & harga wajar tersirat — cocok untuk keputusan pegang jangka menengah/panjang.'
    : 'Fokus likuiditas & volatilitas 30 hari terakhir — menilai karakter tradability saham, BUKAN sinyal beli/jual atau prediksi harga.';

  renderWatchlist();
}

function switchTab(tab) {
  ['watchlist', 'portfolio', 'form'].forEach(id => {
    document.getElementById(`view-${id}`).classList.toggle('hidden', id !== tab);
    document.getElementById(`tab-${id}`).classList.toggle('tab-active', id === tab);
    document.getElementById(`tab-${id}`).classList.toggle('tab-inactive', id !== tab);
  });
  if (tab === 'portfolio') loadPortfolio();
}

// ===== Watchlist =====
async function loadWatchlist() {
  const grid = document.getElementById('watchlist-grid');
  grid.innerHTML = `<p class="text-slate-500 font-mono text-sm col-span-full">Memuat data...</p>`;

  if (!apiReady()) {
    grid.innerHTML = `<p class="text-rose-400 font-mono text-sm col-span-full">API_URL belum diatur di config.js</p>`;
    return;
  }

  try {
    const res = await callBackend('list');
    if (!res.ok) throw new Error(res.error);
    stocks = res.data;
    document.getElementById('w-count').textContent = `${stocks.length} Emiten`;
    renderWatchlist();
  } catch (err) {
    grid.innerHTML = `<p class="text-rose-400 font-mono text-sm col-span-full">Gagal memuat: ${err.message}</p>`;
  }
}

function renderWatchlist() {
  const grid = document.getElementById('watchlist-grid');
  const empty = document.getElementById('empty-state');

  if (stocks.length === 0) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  grid.innerHTML = stocks.map(s => stockCard(s)).join('');

  grid.querySelectorAll('[data-kode]').forEach(el => {
    el.addEventListener('click', () => openForm(el.dataset.kode));
  });

  if (watchlistMode === 'scalping') {
    grid.querySelectorAll('.btn-liq').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); handleCheckLiquidity(btn.dataset.liqKode, btn); });
    });
  }
}

async function handleCheckLiquidity(kode, btn) {
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Mengecek...';

  try {
    const res = await callBackend('check_liquidity', {}, 'POST', { kode });
    if (!res.ok) throw new Error(res.error);

    const idx = stocks.findIndex(s => s.Kode === kode);
    if (idx > -1) {
      stocks[idx].Volatilitas30H = res.data.volatilitas;
      stocks[idx].AvgVolume30H = res.data.avgVolume;
      stocks[idx].CocokJangkaPendek = res.data.klasifikasi;
      stocks[idx].LikuiditasUpdatedAt = res.data.updatedAt;
    }
    renderWatchlist();
  } catch (err) {
    alert('Gagal mengecek likuiditas: ' + err.message);
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function stockCard(s) {
  if (watchlistMode === 'scalping') return stockCardScalping(s);
  return stockCardSwing(s);
}

function stockCardSwing(s) {
  const harga = s.Harga ? formatRp(s.Harga) : '—';
  const ratios = ['ROE', 'PER', 'DER', 'PBV'];
  const fairPrices = [s.HargaWajarPER, s.HargaWajarPBV].filter(Boolean);
  const fairAvg = fairPrices.length ? fairPrices.reduce((a, b) => a + b, 0) / fairPrices.length : null;

  let badgeHTML = '';
  if (fairAvg && s.Harga) {
    const diffPct = ((s.Harga - fairAvg) / fairAvg) * 100;
    if (diffPct <= -10) {
      badgeHTML = `<span class="px-2 py-0.5 rounded text-[9px] font-bold tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 uppercase">Undervalued</span>`;
    } else if (diffPct >= 10) {
      badgeHTML = `<span class="px-2 py-0.5 rounded text-[9px] font-bold tracking-wider bg-rose-500/10 text-rose-400 border border-rose-500/30 uppercase">Overvalued</span>`;
    } else {
      badgeHTML = `<span class="px-2 py-0.5 rounded text-[9px] font-bold tracking-wider bg-slate-700/50 text-slate-400 border border-slate-700 uppercase">Wajar</span>`;
    }
  }

  return `
    <div data-kode="${s.Kode}" class="card card-3d-hover p-5 cursor-pointer border-slate-800/80 bg-gradient-to-b from-slate-900 to-slate-950">
      <div class="flex justify-between items-start mb-1">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <h3 class="text-xl font-black text-white">${s.Kode}</h3>
            ${badgeHTML}
          </div>
          <p class="text-xs text-slate-400 truncate max-w-[150px]">${s.Nama || '—'}</p>
        </div>
        <p class="font-mono text-sm font-bold text-slate-200">${harga}</p>
      </div>
      ${fairAvg ? `
        <p class="text-[10px] font-mono text-slate-500 mb-1">
          Harga wajar tersirat: <span class="text-slate-300">${formatRp(Math.round(fairAvg))}</span>
        </p>` : ''}
      <div class="h-px bg-gradient-to-r from-transparent via-slate-700 to-transparent my-3 opacity-50"></div>
      <div class="space-y-2">
        ${ratios.map(r => gaugeRow(r, s[r])).join('')}
      </div>
    </div>
  `;
}

const STYLE_BADGE = {
  'Cocok Jangka Pendek': 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  'Netral': 'bg-slate-700/50 text-slate-400 border-slate-700',
  'Cocok Jangka Panjang': 'bg-sky-500/10 text-sky-400 border-sky-500/30',
};

function stockCardScalping(s) {
  const harga = s.Harga ? formatRp(s.Harga) : '—';
  const hasData = s.Volatilitas30H !== null && s.Volatilitas30H !== undefined && s.Volatilitas30H !== '' &&
                  s.AvgVolume30H !== null && s.AvgVolume30H !== undefined && s.AvgVolume30H !== '';
  const klasifikasi = s.CocokJangkaPendek;
  const badgeClass = STYLE_BADGE[klasifikasi] || 'bg-slate-700/50 text-slate-400 border-slate-700';

  const updatedText = s.LikuiditasUpdatedAt
    ? `Update: ${new Date(s.LikuiditasUpdatedAt).toLocaleDateString('id-ID')}`
    : 'Belum pernah dicek';

  return `
    <div class="card p-5 border-slate-800/80 bg-gradient-to-b from-slate-900 to-slate-950" data-liq-card="${s.Kode}">
      <div class="flex justify-between items-start mb-2">
        <div class="cursor-pointer" data-kode="${s.Kode}">
          <div class="flex items-center gap-2 mb-1">
            <h3 class="text-xl font-black text-white">${s.Kode}</h3>
            ${klasifikasi ? `<span class="px-2 py-0.5 rounded text-[9px] font-bold tracking-wider border uppercase ${badgeClass}">${klasifikasi}</span>` : ''}
          </div>
          <p class="text-xs text-slate-400 truncate max-w-[150px]">${s.Nama || '—'}</p>
        </div>
        <p class="font-mono text-sm font-bold text-slate-200">${harga}</p>
      </div>

      <div class="h-px bg-gradient-to-r from-transparent via-slate-700 to-transparent my-3 opacity-50"></div>

      ${hasData ? `
        <div class="grid grid-cols-2 gap-3 mb-3">
          <div>
            <p class="text-[10px] text-slate-500 uppercase mb-1">Volatilitas Harian</p>
            <p class="font-mono text-sm text-slate-200">${s.Volatilitas30H}%</p>
          </div>
          <div class="text-right">
            <p class="text-[10px] text-slate-500 uppercase mb-1">Avg Volume/hari</p>
            <p class="font-mono text-sm text-slate-200">${formatCompact(s.AvgVolume30H)}</p>
          </div>
        </div>
        <p class="text-[10px] text-slate-600 mb-3">${updatedText} — data historis 30 hari, bukan sinyal beli/jual.</p>
      ` : `
        <p class="text-xs text-slate-500 mb-3">Belum ada data likuiditas/volatilitas untuk saham ini.</p>
      `}

      <button data-liq-kode="${s.Kode}" class="btn-liq w-full py-2 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors text-xs font-bold">
        ${hasData ? '↻ Cek Ulang' : 'Cek Likuiditas & Volatilitas'}
      </button>
    </div>
  `;
}

function formatCompact(n) {
  n = Number(n) || 0;
  if (n >= 1000000000) return (n / 1000000000).toFixed(1) + 'M';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'jt';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'rb';
  return String(n);
}

function gaugeRow(key, value) {
  const b = BENCHMARK[key];
  if (value === null || value === undefined) {
    return `
      <div class="flex items-center gap-2 text-xs">
        <span class="w-8 text-slate-500 font-mono font-bold">${key}</span>
        <div class="gauge-track"><div class="gauge-fill" style="width:0%"></div></div>
        <span class="w-12 text-right font-mono text-slate-500">n/a</span>
      </div>`;
  }
  const status = ratioStatus(key, value);
  const pct = gaugePercent(key, value);
  return `
    <div class="flex items-center gap-2 text-xs">
      <span class="w-8 text-slate-500 font-mono font-bold">${key}</span>
      <div class="gauge-track"><div class="gauge-fill fill-${status}" style="width:${pct}%"></div></div>
      <span class="w-12 text-right font-mono text-slate-300">${value}${b.unit}</span>
    </div>`;
}

function ratioStatus(key, value) {
  const b = BENCHMARK[key];
  if (b.lowerIsBetter) {
    if (value <= b.good) return 'good';
    if (value <= b.mid) return 'mid';
    return 'bad';
  } else {
    if (value >= b.good) return 'good';
    if (value >= b.mid) return 'mid';
    return 'bad';
  }
}

function gaugePercent(key, value) {
  const b = BENCHMARK[key];
  const ref = b.mid * 2 || 1;
  return Math.min(100, Math.max(6, (Math.abs(value) / ref) * 100));
}

function formatRp(n) {
  return 'Rp' + Number(n).toLocaleString('id-ID', { maximumFractionDigits: 0 });
}

// ===== Form (tambah/edit saham + AI) =====
function bindForm() {
  document.getElementById('stock-form').addEventListener('submit', handleSubmit);
  document.getElementById('btn-cancel').addEventListener('click', () => switchTab('watchlist'));
  document.getElementById('btn-delete').addEventListener('click', handleDelete);
  document.getElementById('btn-analyze').addEventListener('click', handleAnalyze);
  document.getElementById('btn-clear-analysis').addEventListener('click', handleClearAnalysis);
  document.getElementById('btn-consult').addEventListener('click', handleConsult);
  document.getElementById('f-Kode').addEventListener('input', handleKodeAutofill);

  ['JumlahSaham', 'Pendapatan', 'LabaBersih', 'Ekuitas', 'TotalAset', 'TotalUtang'].forEach(id => {
    document.getElementById(`f-${id}`).addEventListener('input', updatePreview);
  });
}

// Auto-isi Nama & Sektor begitu kode saham ketemu di kamus Referensi. Cuma jalan
// untuk mode "Tambah Saham Baru" (bukan Edit -- field Kode di-disable saat Edit,
// dan Nama/Sektor sudah terisi dari data tersimpan, jadi tidak perlu ditimpa).
// Kalau kode tidak ada di kamus, biarkan kosong -- user isi manual seperti biasa,
// dan begitu disimpan, kamus otomatis belajar dari input itu untuk lain kali.
function handleKodeAutofill(e) {
  if (editingKode) return;
  const kode = e.target.value.toUpperCase().trim();
  const ref = referensi[kode];
  if (!ref) return;

  const namaEl = document.getElementById('f-Nama');
  const sektorEl = document.getElementById('f-Sektor');
  if (!namaEl.value.trim()) namaEl.value = ref.Nama || '';
  if (!sektorEl.value.trim()) sektorEl.value = ref.Sektor || '';
}

function openForm(kode) {
  editingKode = kode;
  const form = document.getElementById('stock-form');
  form.reset();
  document.getElementById('btn-delete').classList.toggle('hidden', !kode);
  document.getElementById('ai-panel').classList.toggle('hidden', !kode);
  document.getElementById('consult-panel').classList.toggle('hidden', !kode);
  document.getElementById('form-title').textContent = kode ? `Edit ${kode}` : 'Tambah Saham Baru';

  document.getElementById('consult-input').value = '';
  document.getElementById('consult-result').textContent = '';
  document.getElementById('consult-meta').textContent = '';

  const aiResult = document.getElementById('ai-result');
  const aiMeta = document.getElementById('ai-meta');
  aiResult.textContent = '';
  aiMeta.textContent = '';

  if (kode) {
    const s = stocks.find(x => x.Kode === kode);
    if (s) {
      ['Kode', 'Nama', 'Sektor', 'JumlahSaham', 'Pendapatan', 'LabaBersih', 'Ekuitas', 'TotalAset', 'TotalUtang', 'Catatan', 'PERHistoris', 'PBVHistoris']
        .forEach(f => { document.getElementById(`f-${f}`).value = s[f] ?? ''; });
      document.getElementById('f-Kode').disabled = true;

      if (s.AnalisisAI) {
        aiResult.textContent = s.AnalisisAI;
        aiMeta.textContent = s.AnalisisUpdatedAt ? `Terakhir dianalisa: ${new Date(s.AnalisisUpdatedAt).toLocaleString('id-ID')}` : '';
      } else {
        aiResult.textContent = 'Belum ada analisa. Klik "Minta Analisa" di atas.';
      }
    }
  } else {
    document.getElementById('f-Kode').disabled = false;
  }

  updatePreview();
  switchTab('form');
}

function readForm() {
  return {
    Kode: document.getElementById('f-Kode').value.toUpperCase().trim(),
    Nama: document.getElementById('f-Nama').value.trim(),
    Sektor: document.getElementById('f-Sektor').value.trim(),
    JumlahSaham: document.getElementById('f-JumlahSaham').value,
    Pendapatan: document.getElementById('f-Pendapatan').value,
    LabaBersih: document.getElementById('f-LabaBersih').value,
    Ekuitas: document.getElementById('f-Ekuitas').value,
    TotalAset: document.getElementById('f-TotalAset').value,
    TotalUtang: document.getElementById('f-TotalUtang').value,
    Catatan: document.getElementById('f-Catatan').value.trim(),
    PERHistoris: document.getElementById('f-PERHistoris').value,
    PBVHistoris: document.getElementById('f-PBVHistoris').value,
  };
}

function updatePreview() {
  const d = readForm();
  const laba = Number(d.LabaBersih) || 0;
  const ekuitas = Number(d.Ekuitas) || 0;
  const aset = Number(d.TotalAset) || 0;
  const utang = Number(d.TotalUtang) || 0;
  const pendapatan = Number(d.Pendapatan) || 0;

  const roe = ekuitas > 0 ? (laba / ekuitas) * 100 : null;
  const roa = aset > 0 ? (laba / aset) * 100 : null;
  const npm = pendapatan > 0 ? (laba / pendapatan) * 100 : null;
  const der = ekuitas > 0 ? utang / ekuitas : null;

  const preview = document.getElementById('ratio-preview');
  const rows = [['ROE', roe, '%'], ['ROA', roa, '%'], ['NPM', npm, '%'], ['DER', der, 'x']];

  preview.innerHTML = rows.map(([k, v, unit]) => {
    if (v === null) return `<div class="flex justify-between"><span class="text-slate-500">${k}</span><span class="font-mono">—</span></div>`;
    const status = ratioStatus(k, Math.round(v * 100) / 100);
    return `<div class="flex justify-between">
      <span class="text-slate-500">${k}</span>
      <span class="font-mono border rounded px-1.5 tag-${status}">${v.toFixed(2)}${unit}</span>
    </div>`;
  }).join('');

  document.getElementById('preview-note').textContent =
    'PER & PBV baru muncul di watchlist setelah tersimpan (butuh harga pasar dari GOOGLEFINANCE).';
}

async function handleSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-save');
  btn.disabled = true;
  btn.textContent = 'Menyimpan...';

  const data = readForm();
  if (editingKode) data.Kode = editingKode;

  try {
    const res = await callBackend('upsert', {}, 'POST', { data });
    if (!res.ok) throw new Error(res.error);
    await loadWatchlist();
    loadReferensi(); // refresh kamus di background, tidak perlu ditunggu
    switchTab('watchlist');
  } catch (err) {
    alert('Gagal menyimpan: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Simpan';
  }
}

async function handleDelete() {
  if (!editingKode) return;
  if (!confirm(`Hapus ${editingKode} dari watchlist?`)) return;

  try {
    const res = await callBackend('delete', {}, 'POST', { kode: editingKode });
    if (!res.ok) throw new Error(res.error);
    await loadWatchlist();
    switchTab('watchlist');
  } catch (err) {
    alert('Gagal menghapus: ' + err.message);
  }
}

async function handleAnalyze() {
  if (!editingKode) return;
  const btn = document.getElementById('btn-analyze');
  const aiResult = document.getElementById('ai-result');
  const aiMeta = document.getElementById('ai-meta');

  btn.disabled = true;
  btn.textContent = 'Menganalisa...';
  aiResult.textContent = 'Menunggu jawaban dari AI...';

  try {
    const res = await callBackend('analyze', {}, 'POST', { kode: editingKode });
    if (!res.ok) throw new Error(res.error);
    aiResult.textContent = res.data.analisis;
    aiMeta.textContent = `Terakhir dianalisa: ${new Date(res.data.updatedAt).toLocaleString('id-ID')} — bukan rekomendasi beli/jual.`;

    const idx = stocks.findIndex(s => s.Kode === editingKode);
    if (idx > -1) {
      stocks[idx].AnalisisAI = res.data.analisis;
      stocks[idx].AnalisisUpdatedAt = res.data.updatedAt;
    }
  } catch (err) {
    aiResult.textContent = '';
    aiMeta.textContent = '';
    alert('Gagal mendapatkan analisa: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Minta Analisa';
  }
}

async function handleClearAnalysis() {
  if (!editingKode) return;
  if (!confirm(`Hapus analisa AI untuk ${editingKode}?`)) return;

  const btn = document.getElementById('btn-clear-analysis');
  const aiResult = document.getElementById('ai-result');
  const aiMeta = document.getElementById('ai-meta');

  btn.disabled = true;
  try {
    const res = await callBackend('clear_analysis', {}, 'POST', { kode: editingKode });
    if (!res.ok) throw new Error(res.error);

    aiResult.textContent = 'Belum ada analisa. Klik "Minta Analisa" di atas.';
    aiMeta.textContent = '';

    const idx = stocks.findIndex(s => s.Kode === editingKode);
    if (idx > -1) {
      stocks[idx].AnalisisAI = '';
      stocks[idx].AnalisisUpdatedAt = '';
    }
  } catch (err) {
    alert('Gagal menghapus analisa: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

// ===== Portfolio =====
async function loadPortfolio() {
  const grid = document.getElementById('portfolio-grid');
  if (!apiReady()) return;

  try {
    const res = await callBackend('portfolio');
    if (!res.ok) throw new Error(res.error);
    portfolio = res.data;
    renderPortfolio();
  } catch (err) {
    grid.innerHTML = `<p class="text-rose-400 font-mono text-sm col-span-full">Gagal memuat portofolio: ${err.message}</p>`;
  }
}

function renderPortfolio() {
  const grid = document.getElementById('portfolio-grid');
  let totalValue = 0;
  let sectorAlloc = {};

  if (portfolio.length === 0) {
    grid.innerHTML = `<p class="text-slate-500 text-sm col-span-full">Belum ada posisi. Klik "+ Tambah Posisi".</p>`;
    updateSectorChart({}, 0);
    return;
  }

  grid.innerHTML = portfolio.map(p => {
    const curPrice = Number(p.Harga) || 0;
    const marketVal = curPrice * p.Lot * 100;
    const costVal = p.AvgPrice * p.Lot * 100;
    const pnl = marketVal - costVal;
    const pnlPct = costVal > 0 ? (pnl / costVal) * 100 : 0;
    const isProfit = pnl >= 0;
    const pnlColor = isProfit ? 'text-emerald-400' : 'text-rose-400';

    const cashDividen = p.TotalDividen || 0;
    const totalReturn = pnl + cashDividen;
    const trColor = totalReturn >= 0 ? 'text-emerald-400' : 'text-rose-400';

    totalValue += marketVal;
    const sektor = p.Sektor || 'Lainnya';
    sectorAlloc[sektor] = (sectorAlloc[sektor] || 0) + marketVal;

    return `
    <div class="card p-5 border-slate-700 hover:border-slate-500 transition-colors bg-slate-900/50">
      <div class="flex justify-between mb-4">
        <div>
          <h3 class="text-lg font-black text-white">${p.Kode}</h3>
          <p class="text-[10px] text-slate-500 uppercase tracking-widest">${p.Lot} Lot · ${p.Nama || ''}</p>
        </div>
        <div class="text-right">
          <p class="text-xs text-slate-400 mb-1">Market Value</p>
          <p class="font-mono font-bold text-slate-200">${formatRp(marketVal)}</p>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4 p-3 bg-slate-950/50 rounded-lg border border-slate-800/80 mb-4">
        <div>
          <p class="text-[10px] text-slate-500 uppercase mb-1">Avg Price</p>
          <p class="font-mono text-sm">${formatRp(p.AvgPrice)}</p>
        </div>
        <div class="text-right">
          <p class="text-[10px] text-slate-500 uppercase mb-1">Cur Price</p>
          <p class="font-mono text-sm">${formatRp(curPrice)}</p>
        </div>
        <div class="col-span-2 pt-2 border-t border-slate-800">
          <div class="flex justify-between items-center">
            <span class="text-[10px] text-slate-500 uppercase">Unrealized PnL</span>
            <span class="font-mono text-sm font-bold ${pnlColor}">
              ${isProfit ? '+' : ''}${formatRp(pnl)} (${isProfit ? '+' : ''}${pnlPct.toFixed(2)}%)
            </span>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-2 mb-4 p-3 bg-gradient-to-r from-emerald-500/5 to-transparent rounded-lg border border-emerald-500/10">
        <div>
          <p class="text-[10px] text-emerald-500/70 uppercase font-bold mb-1">Total Dividen</p>
          <p class="font-mono text-sm text-emerald-400">+ ${formatRp(cashDividen)}</p>
        </div>
        <div class="text-right">
          <p class="text-[10px] text-slate-400 uppercase font-bold mb-1">Total Return</p>
          <p class="font-mono text-sm font-bold ${trColor}">${totalReturn >= 0 ? '+' : ''}${formatRp(totalReturn)}</p>
        </div>
      </div>

      <div class="flex gap-2">
        <button data-avg-kode="${p.Kode}" data-avg-price="${p.AvgPrice}" data-avg-lot="${p.Lot}" class="btn-avg flex-1 py-2 rounded border border-amber-500/30 text-amber-500 hover:bg-amber-500/10 transition-colors text-xs font-bold">
          ⚖️ Simulasi Average
        </button>
        <button data-div-kode="${p.Kode}" class="btn-div flex-1 py-2 rounded border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 transition-colors text-xs font-bold">
          💰 Catat Dividen
        </button>
        <button data-del-kode="${p.Kode}" class="btn-del-pos py-2 px-3 rounded border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 transition-colors text-xs font-bold">
          Hapus
        </button>
      </div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.btn-avg').forEach(btn => {
    btn.addEventListener('click', () => openAvgModal(btn.dataset.avgKode, Number(btn.dataset.avgPrice), Number(btn.dataset.avgLot)));
  });
  grid.querySelectorAll('.btn-div').forEach(btn => {
    btn.addEventListener('click', () => openDivModal(btn.dataset.divKode));
  });
  grid.querySelectorAll('.btn-del-pos').forEach(btn => {
    btn.addEventListener('click', () => handleDeletePosition(btn.dataset.delKode));
  });

  updateSectorChart(sectorAlloc, totalValue);
}

function updateSectorChart(alloc, total) {
  const bar = document.getElementById('sector-bar');
  const legend = document.getElementById('sector-legend');

  if (total === 0) { bar.innerHTML = ''; legend.innerHTML = ''; return; }

  let barHTML = '', legHTML = '';
  Object.entries(alloc).forEach(([sektor, val]) => {
    const pct = (val / total) * 100;
    const color = SECTOR_COLORS[sektor] || SECTOR_COLORS['Lainnya'];
    barHTML += `<div class="h-full bg-gradient-to-r ${color} transition-all duration-1000" style="width:${pct}%" title="${sektor}: ${pct.toFixed(1)}%"></div>`;
    legHTML += `<div class="flex items-center gap-2 text-xs text-slate-400">
      <span class="w-3 h-3 rounded-sm bg-gradient-to-br ${color}"></span> ${sektor} (${pct.toFixed(1)}%)
    </div>`;
  });
  bar.innerHTML = barHTML;
  legend.innerHTML = legHTML;
}

async function handleDeletePosition(kode) {
  if (!confirm(`Hapus posisi ${kode} dari portofolio?`)) return;
  try {
    const res = await callBackend('portfolio_delete', {}, 'POST', { kode });
    if (!res.ok) throw new Error(res.error);
    await loadPortfolio();
  } catch (err) {
    alert('Gagal menghapus posisi: ' + err.message);
  }
}

// ===== Modal: Tambah Posisi =====
function bindAddPositionModal() {
  document.getElementById('btn-add-pos-close').addEventListener('click', closeAddPositionModal);
  document.getElementById('modal-add-position').addEventListener('click', (e) => {
    if (e.target.id === 'modal-add-position') closeAddPositionModal();
  });
  document.getElementById('form-add-position').addEventListener('submit', handleAddPosition);
}

function openAddPositionModal() {
  const select = document.getElementById('addpos-kode');
  select.innerHTML = stocks.map(s => `<option value="${s.Kode}">${s.Kode} — ${s.Nama || ''}</option>`).join('');
  if (stocks.length === 0) {
    select.innerHTML = `<option value="">Belum ada saham di watchlist</option>`;
  }
  document.getElementById('addpos-lot').value = '';
  document.getElementById('addpos-price').value = '';
  document.getElementById('modal-add-position').classList.remove('hidden');
}

function closeAddPositionModal() {
  document.getElementById('modal-add-position').classList.add('hidden');
}

async function handleAddPosition(e) {
  e.preventDefault();
  const kode = document.getElementById('addpos-kode').value;
  const lot = document.getElementById('addpos-lot').value;
  const avgPrice = document.getElementById('addpos-price').value;
  if (!kode) return;

  try {
    const res = await callBackend('portfolio_upsert', {}, 'POST', { data: { Kode: kode, Lot: lot, AvgPrice: avgPrice } });
    if (!res.ok) throw new Error(res.error);
    closeAddPositionModal();
    await loadPortfolio();
  } catch (err) {
    alert('Gagal menambah posisi: ' + err.message);
  }
}

// ===== Modal: Simulasi Averaging =====
function bindAveragingModal() {
  document.getElementById('btn-avg-close').addEventListener('click', closeAvgModal);
  document.getElementById('modal-averaging').addEventListener('click', (e) => {
    if (e.target.id === 'modal-averaging') closeAvgModal();
  });
  document.getElementById('sim-price').addEventListener('input', updateAvgCalc);
  document.getElementById('sim-lot').addEventListener('input', updateAvgCalc);
  document.getElementById('btn-avg-save').addEventListener('click', saveAveraging);
}

function openAvgModal(kode, avg, lot) {
  currentAvgTarget = { kode, avg, lot };
  document.getElementById('avg-modal-subtitle').textContent = `${kode} (Avg Saat Ini: ${formatRp(avg)} | ${lot} Lot)`;
  document.getElementById('sim-price').value = '';
  document.getElementById('sim-lot').value = '';
  document.getElementById('sim-result-avg').textContent = '—';
  document.getElementById('sim-result-cost').textContent = '—';
  document.getElementById('modal-averaging').classList.remove('hidden');
}

function closeAvgModal() {
  document.getElementById('modal-averaging').classList.add('hidden');
  currentAvgTarget = null;
}

function computeAveraging() {
  if (!currentAvgTarget) return null;
  const newPrice = parseFloat(document.getElementById('sim-price').value) || 0;
  const newLot = parseFloat(document.getElementById('sim-lot').value) || 0;
  if (newPrice <= 0 || newLot <= 0) return null;

  const totalOldValue = currentAvgTarget.avg * currentAvgTarget.lot;
  const totalNewValue = newPrice * newLot;
  const finalLot = currentAvgTarget.lot + newLot;
  const finalAvg = (totalOldValue + totalNewValue) / finalLot;
  const fundNeeded = newPrice * newLot * 100;
  return { finalAvg, finalLot, fundNeeded };
}

function updateAvgCalc() {
  const result = computeAveraging();
  if (result) {
    document.getElementById('sim-result-avg').textContent = formatRp(Math.round(result.finalAvg));
    document.getElementById('sim-result-cost').textContent = formatRp(result.fundNeeded);
  } else {
    document.getElementById('sim-result-avg').textContent = '—';
    document.getElementById('sim-result-cost').textContent = '—';
  }
}

async function saveAveraging() {
  const result = computeAveraging();
  if (!result || !currentAvgTarget) { alert('Isi harga & lot tambahan dulu.'); return; }

  try {
    const res = await callBackend('portfolio_upsert', {}, 'POST', {
      data: { Kode: currentAvgTarget.kode, Lot: result.finalLot, AvgPrice: result.finalAvg }
    });
    if (!res.ok) throw new Error(res.error);
    closeAvgModal();
    await loadPortfolio();
  } catch (err) {
    alert('Gagal menyimpan hasil averaging: ' + err.message);
  }
}

// ===== Modal: Catat Dividen =====
function bindDividendModal() {
  document.getElementById('btn-div-close').addEventListener('click', closeDivModal);
  document.getElementById('modal-dividen').addEventListener('click', (e) => {
    if (e.target.id === 'modal-dividen') closeDivModal();
  });
  document.getElementById('btn-div-save').addEventListener('click', saveDividend);
}

function openDivModal(kode) {
  currentDivTarget = kode;
  document.getElementById('div-modal-subtitle').textContent = `Pemasukan cash dari ${kode}`;
  document.getElementById('input-dividen').value = '';
  document.getElementById('modal-dividen').classList.remove('hidden');
}

function closeDivModal() {
  document.getElementById('modal-dividen').classList.add('hidden');
  currentDivTarget = null;
}

async function saveDividend() {
  if (!currentDivTarget) return;
  const nominal = parseFloat(document.getElementById('input-dividen').value) || 0;
  if (nominal <= 0) { alert('Nominal dividen harus lebih dari 0.'); return; }

  try {
    const res = await callBackend('portfolio_dividend', {}, 'POST', { kode: currentDivTarget, nominal });
    if (!res.ok) throw new Error(res.error);
    closeDivModal();
    await loadPortfolio();
  } catch (err) {
    alert('Gagal mencatat dividen: ' + err.message);
  }
}

// ===== Minta Pertimbangan (diskusi bebas, bukan sinyal beli/jual) =====
async function handleConsult() {
  if (!editingKode) return;
  const btn = document.getElementById('btn-consult');
  const resultEl = document.getElementById('consult-result');
  const metaEl = document.getElementById('consult-meta');
  const context = document.getElementById('consult-input').value.trim();

  if (!context) {
    alert('Ceritakan dulu situasi/pertanyaan kamu di kotak teks.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Memproses...';
  resultEl.textContent = 'Menunggu jawaban dari AI...';
  metaEl.textContent = '';

  try {
    const res = await callBackend('consult', {}, 'POST', { kode: editingKode, context });
    if (!res.ok) throw new Error(res.error);
    resultEl.textContent = res.data.jawaban;
    metaEl.textContent = 'Ini bantu mikir, bukan rekomendasi beli/jual — keputusan tetap di kamu.';
  } catch (err) {
    resultEl.textContent = '';
    alert('Gagal mendapatkan pertimbangan: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Minta Pertimbangan';
  }
}
