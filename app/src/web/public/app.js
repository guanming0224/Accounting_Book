// ── State ─────────────────────────────────────────────────────────────────
const state = {
  userId: null,
  ledgers: [],
  archivedLedgers: [],
  settings: null,
  currentView: 'dashboard',
  modalType: 'expense',
  budgetYear: new Date().getFullYear(),
  budgetMonth: new Date().getMonth() + 1,
};

// ── Chart.js instance registry ────────────────────────────────────────────
const _charts = {};
function mkChart(id, config) {
  if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; }
  const canvas = document.getElementById(id);
  if (!canvas) return null;
  _charts[id] = new Chart(canvas, config);
  return _charts[id];
}

// Dynamic chart colors that work in dark and light mode
function chartPalette(n) {
  const COLORS = [
    '#2dd4a0','#fbbf24','#818cf8','#38bdf8',
    '#f87171','#34d399','#c084fc','#60a5fa',
    '#fb923c','#4ade80','#e879f9','#a78bfa',
    '#2563eb','#16a34a','#dc2626',
  ];
  return Array.from({ length: n }, (_, i) => COLORS[i % COLORS.length]);
}

function isDark() {
  return document.documentElement.dataset.theme === 'dark';
}

function chartDefaults() {
  const dark = isDark();
  return {
    textColor: dark ? '#7fa39c' : '#6b7280',
    gridColor: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
  };
}

// ── Search ────────────────────────────────────────────────────────────────
let _searchTimer = null;

function openSearch() {
  const overlay = document.getElementById('search-overlay');
  if (!overlay) return;
  overlay.hidden = false;
  document.getElementById('search-input')?.focus();
}

function closeSearch() {
  const overlay = document.getElementById('search-overlay');
  if (overlay) overlay.hidden = true;
  const input = document.getElementById('search-input');
  if (input) input.value = '';
  const results = document.getElementById('search-results');
  if (results) results.innerHTML = '';
}

async function runSearch(q) {
  const results = document.getElementById('search-results');
  if (!results) return;
  if (!q.trim()) { results.innerHTML = ''; return; }
  results.innerHTML = '<div class="search-loading">搜尋中…</div>';
  try {
    const rows = await api(`/api/search?q=${encodeURIComponent(q)}`);
    if (!rows.length) { results.innerHTML = '<div class="search-empty">找不到符合的交易</div>'; return; }
    results.innerHTML = rows.map(t => {
      const sign = t.type === 'expense' ? '-' : '+';
      const colorClass = t.type === 'expense' ? 'expense-color' : 'income-color';
      const date = (t.createdAt || '').slice(0, 10);
      return `<div class="search-row">
        <div class="search-row-main">
          <span class="search-row-cat">${escapeHtml(t.category)}${t.subcategory ? ' · ' + escapeHtml(t.subcategory) : ''}</span>
          <span class="search-row-desc">${escapeHtml(t.description || '')}${t.ledgerName ? ' <span class="search-ledger">(' + escapeHtml(t.ledgerName) + ')</span>' : ''}</span>
        </div>
        <div class="search-row-right">
          <span class="${colorClass}">${sign}${formatMoney(t.amount)}</span>
          <span class="search-row-date">${date}</span>
        </div>
      </div>`;
    }).join('');
  } catch { results.innerHTML = '<div class="search-empty">搜尋失敗</div>'; }
}

// ── Calendar ──────────────────────────────────────────────────────────────
const calState = { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
let _calDayMap = new Map();

async function loadCalendar() {
  const { year, month } = calState;
  const titleEl = document.getElementById('cal-title');
  if (titleEl) titleEl.textContent = `${year}/${String(month).padStart(2, '0')}`;
  try {
    const data = await api(`/api/calendar?year=${year}&month=${month}`);
    renderCalendarGrid(data);
  } catch { const g = document.getElementById('calendar-grid'); if (g) g.innerHTML = '<div class="text-muted">載入失敗</div>'; }
}

function renderCalendarGrid(data) {
  const { year, month, days } = data;
  _calDayMap = new Map((days || []).map(d => [d.date, d]));
  const grid = document.getElementById('calendar-grid');
  if (!grid) return;
  const firstDow = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const today2 = new Date().toISOString().slice(0, 10);
  const HEADERS = ['日', '一', '二', '三', '四', '五', '六'];
  let html = '<div class="cal-headers">' + HEADERS.map(h => `<div class="cal-hdr">${h}</div>`).join('') + '</div>';
  html += '<div class="cal-body">';
  for (let i = 0; i < firstDow; i++) html += '<div class="cal-cell cal-empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const info = _calDayMap.get(dateStr);
    const isToday = dateStr === today2;
    const expDisplay = info && info.expense > 0
      ? (info.expense >= 1000 ? '-' + Math.round(info.expense / 1000) + 'K' : '-' + Math.round(info.expense))
      : '';
    html += `<div class="cal-cell${isToday ? ' cal-today' : ''}${info ? ' cal-has-tx' : ''}" data-cal-date="${dateStr}">
      <div class="cal-day-num">${d}</div>
      ${expDisplay ? `<div class="cal-expense">${expDisplay}</div>` : ''}
    </div>`;
  }
  html += '</div>';
  grid.innerHTML = html;
  const det = document.getElementById('cal-day-detail');
  if (det) det.hidden = true;
}

function showCalDayDetail(date, info) {
  const detail = document.getElementById('cal-day-detail');
  if (!detail) return;
  document.getElementById('cal-detail-date').textContent = date;
  if (!info) { detail.hidden = true; return; }
  detail.hidden = false;
  const lines = [];
  if (info.expense > 0) lines.push(`<div class="cal-tx-row"><span>支出合計</span><span class="expense-color">-${formatMoney(info.expense)}</span></div>`);
  if (info.income > 0) lines.push(`<div class="cal-tx-row"><span>收入合計</span><span class="income-color">+${formatMoney(info.income)}</span></div>`);
  if (info.count) lines.push(`<div class="cal-tx-row" style="font-size:11px;color:var(--text-muted)"><span>共 ${info.count} 筆</span><button class="link-btn" onclick="setView('transactions')">查看明細 →</button></div>`);
  document.getElementById('cal-detail-txs').innerHTML = lines.join('');
}

// ── Budget overspend alert ────────────────────────────────────────────────
function getCurrentYearMonth() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

async function checkBudgetOverspend(category) {
  if (!category) return;
  try {
    const { year, month } = getCurrentYearMonth();
    const budgets = await api(`/api/budgets?year=${year}&month=${month}`);
    const match = (budgets || []).find(b => b.category === category || b.category === '全部支出');
    if (!match) return;
    const spent = match.actual || 0;
    const limit = match.amount || 0;
    if (spent > limit && limit > 0) showBudgetWarning(category, Math.round(spent - limit), spent, limit);
  } catch { /* ignore */ }
}

function showBudgetWarning(category, overAmount, spent, limit) {
  document.getElementById('budget-warning-toast')?.remove();
  const toast = document.createElement('div');
  toast.id = 'budget-warning-toast';
  toast.className = 'budget-warning-toast';
  toast.innerHTML = `
    <span class="budget-warning-icon">⚠️</span>
    <div>
      <div class="budget-warning-title">預算超支：${escapeHtml(category)}</div>
      <div class="budget-warning-sub">已花 ${formatMoney(spent)}，超出預算 NT$${overAmount.toLocaleString()}</div>
    </div>
    <button class="budget-warning-close" onclick="this.closest('#budget-warning-toast').remove()">✕</button>
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 8000);
}

// ── Auth token ────────────────────────────────────────────────────────────
let authToken = localStorage.getItem('authToken') || '';

async function apiFetch(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (authToken && authToken !== 'no-auth') headers['Authorization'] = `Bearer ${authToken}`;
  const resp = await fetch(url, { ...options, headers });
  if (resp.status === 401) {
    authToken = '';
    localStorage.removeItem('authToken');
    showAuthOverlay();
    throw new Error('UNAUTHORIZED');
  }
  return resp;
}

// ── API helper ────────────────────────────────────────────────────────────
const api = async (path, options = {}) => {
  const url = new URL(path, window.location.origin);
  if (state.userId !== null) url.searchParams.set('userId', state.userId);
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'API_ERROR');
  return data;
};

// ── Utilities ─────────────────────────────────────────────────────────────
const formatMoney = (value) =>
  Number(value || 0).toLocaleString('zh-TW', { maximumFractionDigits: 2 });

const chartColors = ['#1a7f64', '#fbbf24', '#818cf8', '#7c3aed', '#e11d48', '#0891b2', '#6b7280'];

const today = new Date();
const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

const toDateInput = (date) => {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 10);
};

function showStatus(message, isError = false) {
  const status = document.querySelector('#status');
  status.textContent = message;
  status.classList.toggle('error', isError);
  status.hidden = false;
  setTimeout(() => { status.hidden = true; }, 3500);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/:/g, '&#058;');
}

function splitPayload(value) {
  return String(value).split(':').map((part) =>
    part.replace(/&#058;/g, ':').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&')
  );
}

// ── Dark mode ─────────────────────────────────────────────────────────────
function applyTheme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  localStorage.setItem('theme', dark ? 'dark' : 'light');
}

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme !== 'dark');
}

// ── Context ───────────────────────────────────────────────────────────────
async function loadContext() {
  const context = await api('/api/context');
  state.userId = context.userId;
  document.querySelector('#user-label').textContent = `userId: ${context.userId}`;
}

// ── Dashboard sparkline chart ─────────────────────────────────────────────
function renderDashboardSparkline(trendData) {
  if (!trendData || !trendData.length) return;
  const { textColor, gridColor } = chartDefaults();
  const labels = trendData.map(d => d.label);
  mkChart('dashboard-sparkline', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: '進帳',
          data: trendData.map(d => d.totalIncome),
          backgroundColor: '#1a7f6466',
          borderColor: '#1a7f64',
          borderWidth: 1.5,
          borderRadius: 4,
        },
        {
          label: '支出',
          data: trendData.map(d => d.totalExpense),
          backgroundColor: '#e11d4866',
          borderColor: '#e11d48',
          borderWidth: 1.5,
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: textColor, font: { size: 12 } } },
        tooltip: { mode: 'index' },
      },
      scales: {
        x: { ticks: { color: textColor, font: { size: 11 } }, grid: { color: gridColor } },
        y: {
          ticks: { color: textColor, font: { size: 11 }, callback: v => 'NT$' + Math.round(v).toLocaleString() },
          grid: { color: gridColor },
        },
      },
    },
  });
}

// ── Dashboard ─────────────────────────────────────────────────────────────
async function loadDashboard() {
  const dashboard = await api('/api/dashboard');
  document.querySelector('#metric-income').textContent = formatMoney(dashboard.totalIncome);
  document.querySelector('#metric-expense').textContent = formatMoney(dashboard.totalExpense);
  document.querySelector('#metric-balance').textContent = formatMoney(dashboard.balance);
  document.querySelector('#metric-count').textContent = dashboard.transactionCount || 0;
  const ledgerStats = dashboard.ledgerStats || [];
  renderDashboardAssetsDonut(ledgerStats);
  renderIncomeExpenseChart(dashboard);
  renderExpenseCategoryChart(dashboard.expenseCategories || []);
  renderLedgerExpenseChart(ledgerStats);
  renderDashboardAlerts(dashboard.alerts);
  populateMetricTooltips(ledgerStats);
  setupDailyCountTooltip();
  loadInsights();
  apiFetch('/api/reports/trend?months=6').then(r => r.json()).then(renderDashboardSparkline).catch(() => {});
  loadStreak().catch(() => {});
  loadForecast().catch(() => {});
  loadNetWorthChart().catch(() => {});
}

// 總資產 donut: each segment = one ledger's balance proportion
function renderDashboardAssetsDonut(ledgerStats) {
  const el = document.getElementById('dashboard-assets-donut');
  if (!el) return;

  const positive = ledgerStats.filter(l => (l.balance || 0) > 0);
  const total = positive.reduce((s, l) => s + l.balance, 0);
  const totalAll = ledgerStats.reduce((s, l) => s + (l.balance || 0), 0);
  const netColor = totalAll >= 0 ? 'var(--success)' : 'var(--danger)';

  let bg;
  if (!positive.length || total <= 0) {
    bg = 'conic-gradient(var(--surface-mid) 0deg 360deg)';
  } else {
    let deg = 0;
    const parts = positive.map((l, i) => {
      const span = (l.balance / total) * 360;
      const color = chartColors[i % chartColors.length];
      const part = `${color} ${deg.toFixed(1)}deg ${(deg + span).toFixed(1)}deg`;
      deg += span;
      return part;
    });
    bg = `conic-gradient(${parts.join(', ')})`;
  }

  const legend = positive.map((l, i) => `
    <div class="assets-legend-row">
      <span class="swatch" style="background:${chartColors[i % chartColors.length]}"></span>
      <span class="assets-legend-label">${escapeHtml(l.name)}</span>
      <span class="assets-legend-value">${formatMoney(l.balance)}</span>
    </div>`).join('');

  el.innerHTML = `
    <div class="assets-donut-wrap">
      <div class="donut donut-sm" style="background:${bg}">
        <div class="donut-center">
          <span class="donut-center-label">總結餘</span>
          <strong class="donut-center-value" style="color:${netColor}">${formatMoney(totalAll)}</strong>
        </div>
      </div>
      <div class="assets-legend">${legend || '<span class="row-meta">暫無結餘</span>'}</div>
    </div>`;
}

// Metric tooltips: hover on income/expense/balance → per-ledger breakdown
function populateMetricTooltips(ledgerStats) {
  const rows = (field, colorFn) => ledgerStats.map(l => {
    const v = l[field] || 0;
    return `<div class="tip-row">
      <span class="tip-name">${escapeHtml(l.name)}</span>
      <span class="tip-val" style="color:${colorFn(v)}">${formatMoney(v)}</span>
    </div>`;
  }).join('') || '<div class="tip-row"><span class="tip-name">—</span></div>';

  const green = () => 'var(--success)';
  const red   = () => 'var(--danger)';
  const sign  = v => v >= 0 ? 'var(--success)' : 'var(--danger)';

  document.getElementById('tip-income').innerHTML  = `<div class="tip-title">各帳本進帳</div>${rows('totalIncome', green)}`;
  document.getElementById('tip-expense').innerHTML = `<div class="tip-title">各帳本支出</div>${rows('totalExpense', red)}`;
  document.getElementById('tip-balance').innerHTML = `<div class="tip-title">各帳本結餘</div>${rows('balance', sign)}`;
}

// Daily count tooltip: fetch on first hover, render SVG sparkline
function setupDailyCountTooltip() {
  const card = document.getElementById('metric-count-card');
  if (!card) return;
  let loaded = false;
  card.addEventListener('mouseenter', async () => {
    if (loaded) return;
    loaded = true;
    const el = document.getElementById('daily-count-chart');
    if (!el) return;
    try {
      const now = new Date();
      const y = now.getFullYear(), m = now.getMonth();
      const start = toDateInput(new Date(y, m, 1));
      const end   = toDateInput(new Date(y, m + 1, 0));
      const data  = await api(`/api/reports/daily-count?start=${start}&end=${end}`);
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const counts = new Array(daysInMonth).fill(0);
      for (const { date, count } of data) {
        const d = new Date(date + 'T00:00:00').getDate() - 1;
        if (d >= 0 && d < daysInMonth) counts[d] = count;
      }
      el.innerHTML = renderDailyCountSVG(counts);
    } catch {
      loaded = false;
    }
  }, { passive: true });
}

function renderDailyCountSVG(counts) {
  const W = 190, H = 48, pad = 3;
  const n = counts.length;
  const max = Math.max(...counts, 1);
  const x = i => pad + (i / (n - 1)) * (W - 2 * pad);
  const y = v => H - pad - (v / max) * (H - 2 * pad);
  const pts = counts.map((c, i) => `${x(i).toFixed(1)},${y(c).toFixed(1)}`).join(' ');
  const dots = counts.map((c, i) => c > 0
    ? `<circle cx="${x(i).toFixed(1)}" cy="${y(c).toFixed(1)}" r="2.5" fill="var(--primary)"/>`
    : '').join('');
  const labels = [1, Math.ceil(n / 2), n].map(d =>
    `<text x="${x(d - 1).toFixed(1)}" y="${H + 11}" fill="var(--muted)" font-size="9" text-anchor="middle">${d}</text>`
  ).join('');
  return `<svg viewBox="0 0 ${W} ${H + 14}" width="${W}" height="${H + 14}" style="display:block;overflow:visible">
    <polyline points="${pts}" fill="none" stroke="var(--primary)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
    ${labels}
  </svg>`;
}

async function loadStreak() {
  try {
    const resp = await apiFetch('/api/stats/streak');
    const data = await resp.json();
    const el = document.getElementById('streak-value');
    if (!el) return;
    const streak = data.streak || 0;
    el.textContent = streak === 0 ? '0 天' : `${streak} 天`;
    const card = document.getElementById('streak-card');
    if (card) {
      card.title = data.lastRecordDate ? `最後記帳：${data.lastRecordDate}` : '';
      if (streak >= 7) card.classList.add('streak-hot');
    }
  } catch { /* ignore */ }
}

async function loadForecast() {
  try {
    const resp = await apiFetch('/api/reports/forecast');
    const data = await resp.json();
    const forecastEl = document.getElementById('forecast-value');
    const dailyEl = document.getElementById('daily-avg-value');
    if (forecastEl) forecastEl.textContent = `NT$${data.projectedMonthTotal.toLocaleString()}`;
    if (dailyEl) dailyEl.textContent = `NT$${data.dailyAvg.toLocaleString()}`;
    const card = document.getElementById('forecast-card');
    if (card) card.title = `目前已花 NT$${data.currentSpend.toLocaleString()}，還有 ${data.remainingDays} 天`;
  } catch { /* ignore */ }
}

async function loadNetWorthChart() {
  try {
    const resp = await apiFetch('/api/net-worth/history');
    const history = await resp.json();
    if (!history.length) return;
    const { textColor, gridColor } = chartDefaults();
    const labels = history.map(h => h.recordedDate.slice(5)); // MM-DD
    const netWorthEl = document.getElementById('net-worth-current');
    if (netWorthEl && history.length) {
      const latest = history[history.length - 1];
      const sign = latest.netWorth >= 0 ? '+' : '';
      netWorthEl.textContent = `${sign}NT$${Math.round(latest.netWorth).toLocaleString()}`;
      netWorthEl.className = `badge-value ${latest.netWorth >= 0 ? 'positive' : 'negative'}`;
    }
    mkChart('net-worth-chart', {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '淨資產',
            data: history.map(h => h.netWorth),
            borderColor: '#1a7f64',
            backgroundColor: ctx => {
              const gradient = ctx.chart.ctx.createLinearGradient(0, 0, 0, 130);
              gradient.addColorStop(0, '#1a7f6433');
              gradient.addColorStop(1, '#1a7f6400');
              return gradient;
            },
            fill: true,
            tension: 0.4,
            pointRadius: history.length > 30 ? 0 : 3,
            pointHoverRadius: 5,
          },
          {
            label: '總資產',
            data: history.map(h => h.totalAssets),
            borderColor: '#2dd4a0',
            backgroundColor: 'transparent',
            tension: 0.4,
            pointRadius: 0,
            borderDash: [4, 2],
          },
        ],
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: textColor, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: ctx => `${ctx.dataset.label}: NT$${Math.round(ctx.raw).toLocaleString()}`,
            },
          },
        },
        scales: {
          x: { ticks: { color: textColor, font: { size: 10 }, maxTicksLimit: 10 }, grid: { color: gridColor } },
          y: {
            ticks: { color: textColor, callback: v => 'NT$' + (v >= 1000 ? Math.round(v/1000) + 'K' : Math.round(v)) },
            grid: { color: gridColor },
          },
        },
      },
    });
  } catch { /* no accounts yet */ }
}

function renderDashboardAlerts(alerts) {
  if (!alerts || (!alerts.reminders?.length && !alerts.overdueRecurring?.length)) {
    document.querySelector('#dashboard-alerts').hidden = true;
    return;
  }
  document.querySelector('#dashboard-alerts').hidden = false;
  const items = [
    ...(alerts.reminders || []).map(
      (r) => `<div class="row alert-row"><div class="row-main"><div class="row-title">${escapeHtml(r.name)}</div><div class="row-meta">帳單提醒 · ${r.daysUntil === 0 ? '今天到期' : r.daysUntil + ' 天後到期'} · ${formatMoney(r.amount)}</div></div></div>`
    ),
    ...(alerts.overdueRecurring || []).map(
      (r) => `<div class="row alert-row"><div class="row-main"><div class="row-title">${escapeHtml(r.description || r.category)}</div><div class="row-meta">定期交易已到期 · ${formatMoney(r.amount)}</div></div></div>`
    ),
  ];
  document.querySelector('#dashboard-alerts-list').innerHTML = items.join('');
}

function renderIncomeExpenseChart(dashboard) {
  const income = Number(dashboard.totalIncome || 0);
  const expense = Number(dashboard.totalExpense || 0);
  const total = income + expense;
  const incomeDeg = total > 0 ? (income / total) * 360 : 0;
  const expenseDeg = total > 0 ? (expense / total) * 360 : 0;
  const background =
    total > 0
      ? `conic-gradient(#1a7f64 0deg ${incomeDeg}deg, #e11d48 ${incomeDeg}deg ${incomeDeg + expenseDeg}deg)`
      : '';

  document.querySelector('#income-expense-chart').innerHTML = `
    <div class="donut-layout">
      <div class="donut" style="${background ? `background:${background}` : ''}">
        <div class="donut-center">
          <span>淨額</span>
          <strong>${formatMoney(dashboard.balance)}</strong>
        </div>
      </div>
      <div class="legend">
        <div class="legend-item"><span class="swatch" style="background:#1a7f64"></span><span>進帳</span><strong>${formatMoney(income)}</strong></div>
        <div class="legend-item"><span class="swatch" style="background:#e11d48"></span><span>支出</span><strong>${formatMoney(expense)}</strong></div>
        <div class="legend-item"><span class="swatch" style="background:#64748b"></span><span>結餘</span><strong>${formatMoney(dashboard.balance)}</strong></div>
      </div>
    </div>`;
}

function renderExpenseCategoryChart(categories) {
  const total = categories.reduce((sum, item) => sum + Number(item.total || 0), 0);
  let currentDeg = 0;
  const segments = categories.map((item, index) => {
    const degrees = total > 0 ? (Number(item.total) / total) * 360 : 0;
    const start = currentDeg;
    currentDeg += degrees;
    return `${chartColors[index % chartColors.length]} ${start}deg ${currentDeg}deg`;
  });
  const background = segments.length ? `conic-gradient(${segments.join(', ')})` : '';

  document.querySelector('#expense-category-chart').innerHTML = `
    <div class="donut-layout">
      <div class="donut" style="${background ? `background:${background}` : ''}">
        <div class="donut-center">
          <span>支出</span>
          <strong>${formatMoney(total)}</strong>
        </div>
      </div>
      <div class="legend">
        ${
          categories
            .map(
              (item, index) => `
                <div class="legend-item">
                  <span class="swatch" style="background:${chartColors[index % chartColors.length]}"></span>
                  <span>${escapeHtml(item.category)}</span>
                  <strong>${formatMoney(item.total)}</strong>
                </div>`
            )
            .join('') || '<div class="row-meta">本月尚無支出分類資料</div>'
        }
      </div>
    </div>`;
}

function renderLedgerExpenseChart(ledgerStats) {
  const el = document.querySelector('#dashboard-ledgers');
  if (!el) return;

  if (!ledgerStats.length) {
    el.innerHTML = '<div class="row-meta" style="padding:12px 0">尚無帳本資料</div>';
    return;
  }

  const cards = ledgerStats.map(l => {
    const income  = l.totalIncome  || 0;
    const expense = l.totalExpense || 0;
    const balance = l.balance      || 0;

    // Build conic-gradient: green (remaining) → red (spent)
    let bg;
    if (income <= 0 && expense <= 0) {
      bg = `conic-gradient(var(--surface-mid) 0deg 360deg)`;
    } else if (income <= 0 || expense >= income) {
      bg = `conic-gradient(var(--danger) 0deg 360deg)`;
    } else {
      const expDeg = (expense / income) * 360;
      const balDeg = 360 - expDeg;
      bg = `conic-gradient(var(--success) 0deg ${balDeg.toFixed(1)}deg, var(--danger) ${balDeg.toFixed(1)}deg 360deg)`;
    }

    const balColor = balance >= 0 ? 'var(--success)' : 'var(--danger)';

    return `
      <div class="ledger-donut-card" data-ledger-view="${l.ledgerId}" title="點擊查看 ${escapeAttr(l.name)} 交易明細">
        <div class="donut donut-sm" style="background:${bg}">
          <div class="donut-center">
            <span class="donut-center-label">結餘</span>
            <strong class="donut-center-value" style="color:${balColor}">${formatMoney(balance)}</strong>
          </div>
        </div>
        <div class="ledger-donut-name">${escapeHtml(l.name)}</div>
        <div class="ledger-donut-stats">
          <span class="ledger-stat-in">↑ ${formatMoney(income)}</span>
          <span class="ledger-stat-out">↓ ${formatMoney(expense)}</span>
        </div>
      </div>`;
  }).join('');

  el.innerHTML = `<div class="ledger-donut-grid">${cards}</div>`;
}

// ── Ledgers ───────────────────────────────────────────────────────────────
async function loadLedgers() {
  const [ledgers, archivedLedgers] = await Promise.all([
    api('/api/ledgers'),
    api('/api/ledgers/archived'),
  ]);
  state.ledgers = ledgers;
  state.archivedLedgers = archivedLedgers;
  renderLedgerSelect();
  renderLedgers();
  populateImportLedgerSelect();
  loadLedgerStats();
}

async function loadLedgerStats() {
  const now = new Date();
  const start = toDateInput(new Date(now.getFullYear(), now.getMonth(), 1));
  const end = toDateInput(now);
  try {
    const stats = await api(`/api/ledgers/stats?start=${start}&end=${end}`);
    stats.forEach(s => {
      const el = document.getElementById(`ledger-stats-${s.ledgerId}`);
      if (!el) return;
      const surplus = (s.totalIncome || 0) - (s.totalExpense || 0);
      const color = surplus >= 0 ? 'var(--success)' : 'var(--danger)';
      el.innerHTML = `本月 &nbsp;·&nbsp; 進帳 <strong>${formatMoney(s.totalIncome)}</strong> &nbsp;·&nbsp; 支出 <strong>${formatMoney(s.totalExpense)}</strong> &nbsp;·&nbsp; 結餘 <strong style="color:${color}">${formatMoney(surplus)}</strong>`;
    });
  } catch (_) {
    document.querySelectorAll('.ledger-stat-row').forEach(el => { el.textContent = ''; });
  }
}

function openLedgerTransactions(ledgerId) {
  const form = document.querySelector('#transaction-filter');
  form.querySelector('[name="ledgerId"]').value = ledgerId;
  const now = new Date();
  form.querySelector('[name="start"]').value = toDateInput(new Date(now.getFullYear(), now.getMonth(), 1));
  form.querySelector('[name="end"]').value = toDateInput(now);
  setView('transactions');
  loadTransactions();
}

function renderLedgerSelect() {
  const select = document.querySelector('#transaction-filter select[name="ledgerId"]');
  select.innerHTML = state.ledgers
    .map((ledger) => `<option value="${ledger.ledgerId}">${escapeHtml(ledger.name)}</option>`)
    .join('');
}

function populateImportLedgerSelect() {
  const select = document.querySelector('#import-ledger-select');
  select.innerHTML =
    '<option value="">選擇帳本</option>' +
    state.ledgers
      .map((l) => `<option value="${l.ledgerId}">${escapeHtml(l.name)}</option>`)
      .join('');
}

function renderLedgers() {
  document.querySelector('#active-ledgers').innerHTML =
    state.ledgers.map(renderActiveLedger).join('') || '<div class="row">尚無未封存帳本</div>';
  document.querySelector('#archived-ledgers').innerHTML =
    state.archivedLedgers.map(renderArchivedLedger).join('') || '<div class="row">目前沒有封存帳本</div>';
}

function renderActiveLedger(ledger) {
  return `
    <div class="row">
      <div class="row-main">
        <div class="row-title">${escapeHtml(ledger.name)}</div>
        <div class="row-meta ledger-stat-row" id="ledger-stats-${ledger.ledgerId}">載入中…</div>
      </div>
      <div class="actions">
        <button data-ledger-view="${ledger.ledgerId}">查看交易</button>
        <button class="secondary" data-ledger-rename="${ledger.ledgerId}">改名</button>
        <button class="danger" data-ledger-archive="${ledger.ledgerId}">封存</button>
      </div>
    </div>`;
}

function renderArchivedLedger(ledger) {
  return `
    <div class="row">
      <div class="row-main">
        <div class="row-title">${escapeHtml(ledger.name)}</div>
        <div class="row-meta">已封存</div>
      </div>
      <div class="actions">
        <button data-ledger-unarchive="${ledger.ledgerId}">取消封存</button>
      </div>
    </div>`;
}

// ── Transactions ──────────────────────────────────────────────────────────
async function loadTransactions(event) {
  if (event) event.preventDefault();
  const form = document.querySelector('#transaction-filter');
  const ledgerId = form.ledgerId.value;
  const start = form.start.value;
  const end = form.end.value;
  if (!ledgerId || !start || !end) return;

  const data = await api(`/api/transactions?ledgerId=${ledgerId}&start=${start}&end=${end}`);
  const stats = data.stats || {};
  document.querySelector('#transaction-summary').textContent =
    `進帳 ${formatMoney(stats.totalIncome)} / 支出 ${formatMoney(stats.totalExpense)} / 結餘 ${formatMoney((stats.totalIncome || 0) - (stats.totalExpense || 0))} / 筆數 ${stats.transactionCount || 0}`;
  document.querySelector('#transactions-table').innerHTML =
    (data.transactions || []).map(renderTransactionRow).join('') ||
    '<tr><td colspan="9">這個區間沒有交易</td></tr>';
}

// ── Receipt photo ─────────────────────────────────────────────────────────
let _pendingReceiptBase64 = null;

function compressImageToBase64(file, maxPx = 1200, quality = 0.65) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxPx || height > maxPx) {
        if (width > height) { height = Math.round(height * maxPx / width); width = maxPx; }
        else { width = Math.round(width * maxPx / height); height = maxPx; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality).split(',')[1]);
    };
    img.onerror = reject;
    img.src = url;
  });
}

function clearReceiptPreview() {
  _pendingReceiptBase64 = null;
  const wrap = document.getElementById('receipt-preview-wrap');
  if (wrap) wrap.hidden = true;
  const btn = document.getElementById('receipt-upload-btn');
  if (btn) btn.hidden = false;
  const fileInput = document.getElementById('modal-receipt-file');
  if (fileInput) fileInput.value = '';
}

function showReceiptPreview(base64) {
  _pendingReceiptBase64 = base64;
  const img = document.getElementById('receipt-preview-img');
  if (img) img.src = `data:image/jpeg;base64,${base64}`;
  const wrap = document.getElementById('receipt-preview-wrap');
  if (wrap) wrap.hidden = false;
  const btn = document.getElementById('receipt-upload-btn');
  if (btn) btn.hidden = true;
}

function getReceiptTxIds() {
  try { return new Set(JSON.parse(localStorage.getItem('receiptTxIds') || '[]')); } catch { return new Set(); }
}

function addReceiptTxId(id) {
  const ids = getReceiptTxIds();
  ids.add(id);
  localStorage.setItem('receiptTxIds', JSON.stringify([...ids]));
}

async function showReceiptLightbox(txId) {
  try {
    const att = await api(`/api/transactions/${txId}/attachment`);
    const overlay = document.createElement('div');
    overlay.className = 'lightbox-overlay';
    overlay.innerHTML = `<div class="lightbox-box"><img src="data:${att.mimeType};base64,${att.data}" class="lightbox-img" /><button class="lightbox-close icon-btn" onclick="this.closest('.lightbox-overlay').remove()">✕</button></div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  } catch { showStatus('無法載入收據', true); }
}

function renderTransactionRow(t) {
  const tags = t.tags ? t.tags.split(',').filter(Boolean) : [];
  const tagsHtml = tags.map((tag) => `<span class="tag" style="padding:2px 6px;font-size:11px;">${escapeHtml(tag.trim())}</span>`).join('');
  const hasReceipt = getReceiptTxIds().has(t.transactionId);
  return `
    <tr>
      <td><input type="checkbox" class="tx-row-checkbox" data-tx-id="${t.transactionId}"></td>
      <td>${escapeHtml(String(t.createdAt || ''))}</td>
      <td>${t.type === 'income' ? '進帳' : '支出'}</td>
      <td>${formatMoney(t.amount)}</td>
      <td>${escapeHtml(t.category || '')} / ${escapeHtml(t.subcategory || '')}</td>
      <td>${escapeHtml(t.paymentMethod || '')}</td>
      <td>${escapeHtml(t.currency || 'TWD')}</td>
      <td style="min-width:80px;">${tagsHtml}</td>
      <td>${escapeHtml(t.description || '')}${hasReceipt ? ` <button class="receipt-view-btn icon-btn" data-receipt-tx="${t.transactionId}" title="查看收據">📷</button>` : ''}</td>
      <td>
        <div class="actions">
          <button class="secondary" data-tx-amount="${t.transactionId}">金額</button>
          <button class="secondary" data-tx-note="${t.transactionId}">備註</button>
          <button class="secondary" data-tx-tags="${t.transactionId}">標籤</button>
          <button class="danger" data-tx-delete="${t.transactionId}">刪除</button>
        </div>
      </td>
    </tr>`;
}

function renderSearchRow(t) {
  const tags = t.tags ? t.tags.split(',').filter(Boolean) : [];
  const tagsHtml = tags.map((tag) => `<span class="tag" style="padding:2px 6px;font-size:11px;">${escapeHtml(tag.trim())}</span>`).join('');
  const ledger = state.ledgers.find((l) => l.ledgerId === t.ledgerId);
  return `
    <tr>
      <td>${escapeHtml(String(t.createdAt || ''))}</td>
      <td>${t.type === 'income' ? '進帳' : '支出'}</td>
      <td>${formatMoney(t.amount)}</td>
      <td>${escapeHtml(t.category || '')} / ${escapeHtml(t.subcategory || '')}</td>
      <td>${escapeHtml(ledger?.name || String(t.ledgerId || ''))}</td>
      <td>${escapeHtml(t.currency || 'TWD')}</td>
      <td style="min-width:80px;">${tagsHtml}</td>
      <td>${escapeHtml(t.description || '')}</td>
    </tr>`;
}

async function runAdvancedSearch(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const params = new URLSearchParams();
  if (state.userId !== null) params.set('userId', state.userId);
  ['keyword', 'minAmount', 'maxAmount', 'type', 'start', 'end'].forEach((k) => {
    if (form[k]?.value) params.set(k, form[k].value);
  });
  const url = new URL('/api/transactions/search', window.location.origin);
  url.search = params.toString();
  try {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
    const data = await res.json();
    document.querySelector('#search-results-table').innerHTML =
      (data || []).map(renderSearchRow).join('') || '<tr><td colspan="8">無結果</td></tr>';
  } catch (err) {
    showStatus(err.message || '搜尋失敗', true);
  }
}

function exportCsv() {
  const form = document.querySelector('#transaction-filter');
  const ledgerId = form.ledgerId.value;
  const start = form.start.value;
  const end = form.end.value;
  if (!ledgerId || !start || !end) {
    showStatus('請先選擇帳本與日期範圍後再匯出', true);
    return;
  }
  const url = new URL('/api/export/csv', window.location.origin);
  if (state.userId !== null) url.searchParams.set('userId', state.userId);
  url.searchParams.set('ledgerId', ledgerId);
  url.searchParams.set('start', start);
  url.searchParams.set('end', end);
  const a = document.createElement('a');
  a.href = url.toString();
  a.download = `transactions_${start}_${end}.csv`;
  a.click();
}

// ── Accounts ──────────────────────────────────────────────────────────────
const accountTypeLabels = {
  bank: '銀行',
  cash: '現金',
  credit: '信用卡',
  investment: '投資',
  other: '其他',
};

let _cachedExchangeRates = null;

async function getExchangeRates() {
  if (_cachedExchangeRates) return _cachedExchangeRates;
  try {
    const resp = await apiFetch('/api/exchange-rates');
    const data = await resp.json();
    _cachedExchangeRates = data.rates || {};
    return _cachedExchangeRates;
  } catch { return {}; }
}

const pocketColors = ['#2dd4a0','#fbbf24','#818cf8','#38bdf8','#f87171','#34d399','#c084fc','#60a5fa','#fb923c','#4ade80'];

async function loadAccounts() {
  try {
    const data = await api('/api/accounts');
    renderAccounts(data);
  } catch {
    const g = document.getElementById('pocket-grid');
    if (g) g.innerHTML = '<div class="row-meta">無法載入口袋資料</div>';
  }
}

function renderAccounts(data) {
  const accounts = data.accounts || [];
  document.getElementById('account-total-assets').textContent    = formatMoney(data.totalAssets);
  document.getElementById('account-total-liabilities').textContent = formatMoney(data.totalLiabilities);
  document.getElementById('account-net-worth').textContent       = formatMoney(data.netWorth);

  const grid = document.getElementById('pocket-grid');
  if (grid) {
    grid.innerHTML = accounts.length
      ? accounts.map((a, i) => renderPocketCard(a, i)).join('')
      : '<div class="pocket-empty">還沒有口袋，點「＋ 新增口袋」開始吧</div>';
  }

  const fromSel = document.getElementById('transfer-from');
  const toSel   = document.getElementById('transfer-to');
  const opts = '<option value="">選擇口袋</option>' +
    accounts.map(a => `<option value="${a.accountId}">${escapeHtml(a.name)}</option>`).join('');
  if (fromSel) fromSel.innerHTML = opts;
  if (toSel)   toSel.innerHTML   = opts;
}

function renderPocketCard(a, idx) {
  const color = pocketColors[idx % pocketColors.length];
  const bal   = a.balance || 0;
  const balColor = bal < 0 ? 'var(--danger)' : 'var(--text)';
  return `
    <div class="pocket-card" style="--pocket-color:${color}" data-account-id="${a.accountId}">
      <div class="pocket-card-top">
        <span class="pocket-name">${escapeHtml(a.name)}</span>
        <div class="pocket-card-actions">
          <button class="icon-btn" data-account-edit="${a.accountId}" title="改名">✏</button>
          <button class="icon-btn danger-icon" data-account-delete="${a.accountId}" title="刪除">✕</button>
        </div>
      </div>
      <div class="pocket-balance" style="color:${balColor}">${formatMoney(bal)}</div>
      <div class="pocket-card-btns">
        <button class="pocket-btn-deposit" data-pocket-deposit="${a.accountId}">＋ 存入</button>
        <button class="pocket-btn-withdraw" data-pocket-withdraw="${a.accountId}">－ 提取</button>
      </div>
      <div class="pocket-adjust" id="pocket-adjust-${a.accountId}" hidden>
        <input class="pocket-adjust-input" type="number" min="0.01" step="0.01" placeholder="金額" />
        <button class="pocket-btn-confirm" data-pocket-confirm="${a.accountId}">確認</button>
        <button class="pocket-btn-cancel" data-pocket-cancel="${a.accountId}">取消</button>
      </div>
    </div>`;
}

// ── Pocket deposit / withdraw inline actions ──────────────────────────────
function showPocketAdjust(accountId, mode) {
  const box = document.getElementById(`pocket-adjust-${accountId}`);
  if (!box) return;
  box.hidden = false;
  box.dataset.mode = mode;
  box.querySelector('.pocket-adjust-input').value = '';
  box.querySelector('.pocket-adjust-input').focus();
  const confirm = box.querySelector('[data-pocket-confirm]');
  confirm.style.background = mode === 'deposit' ? 'var(--success)' : 'var(--danger)';
  confirm.style.color = '#fff';
}

function hidePocketAdjust(accountId) {
  const box = document.getElementById(`pocket-adjust-${accountId}`);
  if (box) box.hidden = true;
}

// Expose so global click handler can call it
window._pocketMode = {};

// ── Budget ────────────────────────────────────────────────────────────────
function updateBudgetMonthLabel() {
  document.querySelector('#budget-month-label').textContent =
    `${state.budgetYear} 年 ${state.budgetMonth} 月`;
}

async function loadBudgets() {
  updateBudgetMonthLabel();
  renderBudgetCategorySelect();
  const budgets = await api(`/api/budgets?year=${state.budgetYear}&month=${state.budgetMonth}`);
  renderBudgets(budgets);
  renderBudgetChart(budgets);
}

function renderBudgets(budgets) {
  const list = document.querySelector('#budget-list');
  if (!budgets.length) {
    list.innerHTML = '<div class="row"><div class="row-main"><div class="row-meta">本月尚無預算，請使用下方表單新增</div></div></div>';
    return;
  }
  list.innerHTML = budgets
    .map((b) => {
      const pct = b.amount > 0 ? Math.min((b.actual / b.amount) * 100, 100) : 0;
      const over = b.actual > b.amount;
      return `
        <div class="budget-row">
          <div class="budget-info">
            <div class="budget-name">${escapeHtml(b.category)}</div>
            <div class="budget-amounts">
              <span class="${over ? 'text-danger' : ''}">實際 ${formatMoney(b.actual)}</span>
              <span class="text-muted"> / 預算 ${formatMoney(b.amount)}</span>
            </div>
          </div>
          <div class="budget-progress-wrap">
            <div class="budget-progress-track">
              <div class="budget-progress-fill ${over ? 'over' : ''}" style="width:${pct.toFixed(1)}%"></div>
            </div>
            <span class="budget-pct ${over ? 'text-danger' : ''}">${pct.toFixed(0)}%</span>
          </div>
          <button class="danger" data-budget-delete="${b.budgetId}">刪除</button>
        </div>`;
    })
    .join('');
}

// ── Goals ─────────────────────────────────────────────────────────────────
async function loadGoals() {
  try {
    const goals = await api('/api/goals');
    renderGoals(goals);
  } catch (err) {
    document.querySelector('#goals-list').innerHTML = '<div class="row">尚無目標資料</div>';
  }
}

function renderGoals(goals) {
  document.querySelector('#goals-list').innerHTML =
    (goals || []).map(renderGoal).join('') || '<div class="row">尚無儲蓄目標</div>';
}

function renderGoal(g) {
  const saved = Number(g.savedAmount || 0);
  const target = Number(g.targetAmount || 0);
  const pct = target > 0 ? Math.min((saved / target) * 100, 100) : 0;
  const done = saved >= target;
  const deadlineHtml = g.deadline
    ? `<span class="text-muted"> · 截止 ${escapeHtml(g.deadline)}</span>`
    : '';
  return `
    <div class="goal-row">
      <div class="goal-header">
        <div>
          <span class="goal-name">${escapeHtml(g.name)}</span>${deadlineHtml}
        </div>
        <div class="actions">
          <button class="secondary" data-goal-deposit="${g.goalId}">存入</button>
          <button class="danger" data-goal-delete="${g.goalId}">刪除</button>
        </div>
      </div>
      <div class="goal-meta">${formatMoney(saved)} / ${formatMoney(target)}（${pct.toFixed(0)}%）</div>
      <div class="goal-progress-track">
        <div class="goal-progress-fill${done ? ' done' : ''}" style="width:${pct.toFixed(1)}%"></div>
      </div>
    </div>`;
}

// ── Recurring ─────────────────────────────────────────────────────────────
async function loadRecurring() {
  try {
    const items = await api('/api/recurring');
    renderRecurring(items);
  } catch (err) {
    document.querySelector('#recurring-list').innerHTML = '<div class="row">尚無定期交易</div>';
  }
}

function renderRecurring(items) {
  document.querySelector('#recurring-list').innerHTML =
    (items || []).map(renderRecurringItem).join('') || '<div class="row">尚無定期交易</div>';
}

function renderRecurringItem(r) {
  const activeClass = r.isActive ? 'active' : 'inactive';
  const activeLabel = r.isActive ? '啟用中' : '已停用';
  return `
    <div class="row">
      <div class="row-main">
        <div class="row-title">${escapeHtml(r.description || r.category || '')} <span class="status-badge ${activeClass}">${activeLabel}</span></div>
        <div class="row-meta">${r.type === 'income' ? '進帳' : '支出'} · ${escapeHtml(r.category || '')}${r.subcategory ? ' / ' + escapeHtml(r.subcategory) : ''} · ${formatMoney(r.amount)} · 每月 ${r.dayOfMonth} 號${r.nextDate ? ' · 下次 ' + escapeHtml(r.nextDate) : ''}</div>
      </div>
      <div class="actions">
        <button class="secondary" data-recurring-toggle="${r.recurringId}">${r.isActive ? '停用' : '啟用'}</button>
        <button class="secondary" data-recurring-apply="${r.recurringId}">立即記入</button>
        <button class="danger" data-recurring-delete="${r.recurringId}">刪除</button>
      </div>
    </div>`;
}

function initRecurringForm() {
  if (!state.settings) return;
  // Populate ledger select
  const recLedger = document.querySelector('#rec-ledger');
  recLedger.innerHTML = state.ledgers
    .map((l) => `<option value="${l.ledgerId}">${escapeHtml(l.name)}</option>`)
    .join('');
  // Populate payment select
  const recPayment = document.querySelector('#rec-payment');
  recPayment.innerHTML = state.settings.paymentMethods
    .map((p) => `<option value="${escapeAttr(p)}">${escapeHtml(p)}</option>`)
    .join('');
  // Populate categories based on current type
  updateRecurringCategories();
}

function updateRecurringCategories() {
  const type = document.querySelector('#rec-type').value;
  const cats = type === 'expense'
    ? (state.settings?.expenseCategories || [])
    : (state.settings?.incomeCategories || []);
  const recCategory = document.querySelector('#rec-category');
  recCategory.innerHTML = cats
    .map((c) => `<option value="${escapeAttr(c.name)}">${escapeHtml(c.name)}</option>`)
    .join('');
  updateRecurringSubcategories();
}

function updateRecurringSubcategories() {
  const type = document.querySelector('#rec-type').value;
  const cats = type === 'expense'
    ? (state.settings?.expenseCategories || [])
    : (state.settings?.incomeCategories || []);
  const recCategory = document.querySelector('#rec-category');
  const cat = cats.find((c) => c.name === recCategory.value);
  const recSubcategory = document.querySelector('#rec-subcategory');
  recSubcategory.innerHTML = (cat?.subcategories || [])
    .map((s) => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`)
    .join('');
}

// ── Reminders ─────────────────────────────────────────────────────────────
async function loadReminders() {
  try {
    const items = await api('/api/reminders');
    renderReminders(items);
  } catch (err) {
    document.querySelector('#reminders-list').innerHTML = '<div class="row">尚無帳單提醒</div>';
  }
}

function renderReminders(items) {
  document.querySelector('#reminders-list').innerHTML =
    (items || []).map(renderReminder).join('') || '<div class="row">尚無帳單提醒</div>';
}

function renderReminder(r) {
  const activeClass = r.isActive ? 'active' : 'inactive';
  const activeLabel = r.isActive ? '啟用中' : '已停用';
  const dueSoon = r.daysUntil != null && r.daysUntil <= 3;
  return `
    <div class="row">
      <div class="row-main">
        <div class="row-title">${escapeHtml(r.name)} <span class="status-badge ${activeClass}">${activeLabel}</span></div>
        <div class="row-meta${dueSoon ? ' text-danger' : ''}">
          每月 ${r.dueDay} 號 · ${formatMoney(r.amount)}${r.daysUntil != null ? ` · ${r.daysUntil === 0 ? '今天到期' : r.daysUntil + ' 天後到期'}` : ''}${r.note ? ' · ' + escapeHtml(r.note) : ''}
        </div>
      </div>
      <div class="actions">
        <button class="secondary" data-reminder-toggle="${r.reminderId}">${r.isActive ? '停用' : '啟用'}</button>
        <button class="danger" data-reminder-delete="${r.reminderId}">刪除</button>
      </div>
    </div>`;
}

// ── Reports ───────────────────────────────────────────────────────────────
async function loadCustomReport() {
  const start = document.getElementById('custom-start')?.value;
  const end = document.getElementById('custom-end')?.value;
  if (!start || !end) { showStatus('請選擇開始和結束日期', true); return; }
  if (start > end) { showStatus('開始日期不能晚於結束日期', true); return; }
  try {
    const data = await api(`/api/reports/custom?start=${start}&end=${end}`);
    const result = document.getElementById('custom-range-result');
    document.getElementById('cr-income').textContent = formatMoney(data.totalIncome);
    document.getElementById('cr-expense').textContent = formatMoney(data.totalExpense);
    const balEl = document.getElementById('cr-balance');
    balEl.textContent = formatMoney(data.balance);
    balEl.className = data.balance >= 0 ? 'income-color' : 'expense-color';

    const renderCats = (cats, containerId) => {
      const total = cats.reduce((s, c) => s + c.total, 0);
      document.getElementById(containerId).innerHTML = cats.length
        ? cats.map(c => {
            const pct = total > 0 ? Math.round(c.total / total * 100) : 0;
            return `<div class="cat-row"><span class="cat-name">${escapeHtml(c.category)}</span><div class="cat-bar-wrap"><div class="cat-bar" style="width:${pct}%"></div></div><span class="cat-amount">${formatMoney(c.total)}</span></div>`;
          }).join('')
        : '<div class="text-muted" style="font-size:12px">無資料</div>';
    };
    renderCats(data.expenseCategories || [], 'cr-expense-cats');
    renderCats(data.incomeCategories || [], 'cr-income-cats');
    result.hidden = false;

    // Populate print section
    document.getElementById('print-date-range').textContent = `期間：${start} ～ ${end}`;
    document.getElementById('print-summary-table').innerHTML =
      `<tr><th>進帳</th><th>支出</th><th>結餘</th></tr>
       <tr><td>${formatMoney(data.totalIncome)}</td><td>${formatMoney(data.totalExpense)}</td><td>${formatMoney(data.balance)}</td></tr>`;
    document.getElementById('print-cat-table').innerHTML =
      `<tr><th>類別</th><th>金額</th></tr>` +
      (data.expenseCategories || []).map(c => `<tr><td>${escapeHtml(c.category)}</td><td>${formatMoney(c.total)}</td></tr>`).join('');
  } catch (err) {
    showStatus(err.message || '查詢失敗', true);
  }
}

async function preparePrintReport() {
  const startEl = document.getElementById('custom-start');
  const endEl = document.getElementById('custom-end');
  if (startEl?.value && endEl?.value && !document.getElementById('custom-range-result')?.hidden) return;
  // Default: print current month
  const now = new Date();
  const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0');
  const start = `${y}-${m}-01`;
  const end = `${y}-${m}-${new Date(y, now.getMonth() + 1, 0).getDate().toString().padStart(2, '0')}`;
  if (startEl) startEl.value = start;
  if (endEl) endEl.value = end;
  await loadCustomReport();
}

async function loadReports() {
  const months = Number(document.querySelector('#trend-months')?.value || 6);
  const [trendData, categoryTrendData] = await Promise.allSettled([
    api(`/api/reports/trend?months=${months}`),
    api(`/api/reports/category-trend?months=${months}`),
  ]);
  if (trendData.status === 'fulfilled') {
    renderReportsMetrics(trendData.value);
    renderTrendChart(trendData.value);
    renderTrendLineChart(trendData.value);
  }
  if (categoryTrendData.status === 'fulfilled') {
    renderCategoryTrend(categoryTrendData.value);
    renderCategoryStackedChart(categoryTrendData.value);
  }
  loadDowChart();
  loadAnnualReport().catch(() => {});
}

// ── Annual Report ─────────────────────────────────────────────────────────
const annualState = { year: new Date().getFullYear() };

async function loadAnnualReport() {
  const { year } = annualState;
  const labelEl = document.getElementById('annual-year-label');
  if (labelEl) labelEl.textContent = `${year} 年`;
  try {
    const data = await api(`/api/reports/annual?year=${year}`);
    renderAnnualStats(data);
    renderAnnualChart(data);
    renderAnnualCategories(data);
  } catch { /* silently ignore if no data */ }
}

function renderAnnualStats(data) {
  const el = document.getElementById('annual-stats');
  if (!el) return;
  const bm = data.bestMonth;
  const wm = data.worstMonth;
  el.innerHTML = `
    <div class="annual-stat"><span>年度進帳</span><strong class="income-color">${formatMoney(data.totalIncome)}</strong></div>
    <div class="annual-stat"><span>年度支出</span><strong class="expense-color">${formatMoney(data.totalExpense)}</strong></div>
    <div class="annual-stat"><span>年度結餘</span><strong class="${data.netBalance >= 0 ? 'income-color' : 'expense-color'}">${formatMoney(data.netBalance)}</strong></div>
    <div class="annual-stat"><span>最省月份</span><strong>${bm ? bm.month + ' 月 (' + formatMoney(bm.expense) + ')' : '—'}</strong></div>
    <div class="annual-stat"><span>最花月份</span><strong>${wm ? wm.month + ' 月 (' + formatMoney(wm.expense) + ')' : '—'}</strong></div>
  `;
}

function renderAnnualChart(data) {
  const { textColor, gridColor } = chartDefaults();
  const labels = data.months.map(m => m.month + '月');
  mkChart('annual-bar-chart', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: '進帳', data: data.months.map(m => m.income), backgroundColor: '#1a7f6455', borderColor: '#1a7f64', borderWidth: 1.5, borderRadius: 4 },
        { label: '支出', data: data.months.map(m => m.expense), backgroundColor: '#e11d4855', borderColor: '#e11d48', borderWidth: 1.5, borderRadius: 4 },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: textColor, font: { size: 11 } } },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: NT$${Math.round(ctx.raw).toLocaleString()}` } },
      },
      scales: {
        x: { ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor } },
        y: { ticks: { color: textColor, callback: v => 'NT$' + (v >= 1000 ? Math.round(v / 1000) + 'K' : Math.round(v)) }, grid: { color: gridColor } },
      },
    },
  });
}

function renderAnnualCategories(data) {
  const el = document.getElementById('annual-top-cats');
  if (!el) return;
  const cats = data.topCategories || [];
  if (!cats.length) { el.innerHTML = '<div class="text-muted" style="font-size:12px">無支出資料</div>'; return; }
  const max = cats[0]?.total || 1;
  el.innerHTML = cats.map(c => {
    const pct = Math.round(c.total / max * 100);
    return `<div class="cat-row"><span class="cat-name">${escapeHtml(c.category)}</span><div class="cat-bar-wrap"><div class="cat-bar" style="width:${pct}%"></div></div><span class="cat-amount">${formatMoney(c.total)}</span></div>`;
  }).join('');
}

function renderReportsMetrics(data) {
  const expenses = data.map((d) => d.totalExpense);
  const incomes = data.map((d) => d.totalIncome);
  const avg = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
  const max = (arr) => arr.length ? Math.max(...arr) : 0;
  document.querySelector('#rpt-avg-expense').textContent = formatMoney(avg(expenses));
  document.querySelector('#rpt-max-expense').textContent = formatMoney(max(expenses));
  document.querySelector('#rpt-avg-income').textContent = formatMoney(avg(incomes));
  document.querySelector('#rpt-max-income').textContent = formatMoney(max(incomes));
}

function renderTrendLineChart(data) {
  if (!data || !data.length) return;
  const { textColor, gridColor } = chartDefaults();
  const labels = data.map(d => d.label);
  mkChart('trend-line-chart', {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: '進帳',
          data: data.map(d => d.totalIncome),
          borderColor: '#1a7f64',
          backgroundColor: '#1a7f6422',
          fill: true,
          tension: 0.4,
          pointRadius: 4,
        },
        {
          label: '支出',
          data: data.map(d => d.totalExpense),
          borderColor: '#e11d48',
          backgroundColor: '#e11d4822',
          fill: true,
          tension: 0.4,
          pointRadius: 4,
        },
        {
          label: '結餘',
          data: data.map(d => d.balance),
          borderColor: '#2dd4a0',
          backgroundColor: 'transparent',
          borderDash: [5, 3],
          tension: 0.4,
          pointRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: textColor } },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: NT$${Math.round(ctx.raw).toLocaleString()}`,
          },
        },
      },
      scales: {
        x: { ticks: { color: textColor, font: { size: 11 } }, grid: { color: gridColor } },
        y: {
          ticks: { color: textColor, callback: v => 'NT$' + Math.round(v / 1000) + 'K' },
          grid: { color: gridColor },
        },
      },
    },
  });
}

function renderCategoryStackedChart(data) {
  if (!data || !data.length) return;
  const { textColor, gridColor } = chartDefaults();
  const labels = data.map(d => d.label);

  // Collect all unique category names
  const catSet = new Set();
  data.forEach(d => d.categories.forEach(c => catSet.add(c.name)));
  const cats = [...catSet];
  const colors = chartPalette(cats.length);

  const datasets = cats.map((cat, i) => ({
    label: cat,
    data: data.map(d => {
      const found = d.categories.find(c => c.name === cat);
      return found ? found.total : 0;
    }),
    backgroundColor: colors[i] + 'cc',
    borderColor: colors[i],
    borderWidth: 1,
    borderRadius: 3,
  }));

  mkChart('category-stacked-chart', {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: textColor, font: { size: 11 } }, position: 'bottom' },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: NT$${Math.round(ctx.raw).toLocaleString()}`,
          },
        },
      },
      scales: {
        x: { stacked: true, ticks: { color: textColor, font: { size: 11 } }, grid: { color: gridColor } },
        y: {
          stacked: true,
          ticks: { color: textColor, callback: v => 'NT$' + Math.round(v / 1000) + 'K' },
          grid: { color: gridColor },
        },
      },
    },
  });
}

async function loadDowChart() {
  const canvas = document.getElementById('dow-chart');
  if (!canvas) return;
  try {
    const resp = await apiFetch('/api/reports/day-of-week?months=3');
    const data = await resp.json();
    const { textColor, gridColor } = chartDefaults();
    const maxTotal = Math.max(...data.map(d => d.total), 1);
    mkChart('dow-chart', {
      type: 'bar',
      data: {
        labels: data.map(d => `週${d.name}`),
        datasets: [{
          label: '支出金額',
          data: data.map(d => d.total),
          backgroundColor: data.map(d => {
            const intensity = d.total / maxTotal;
            return `rgba(248, 113, 113, ${0.3 + intensity * 0.7})`;
          }),
          borderColor: '#f87171',
          borderWidth: 1.5,
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => `支出: NT$${Math.round(ctx.raw).toLocaleString()} (${data[ctx.dataIndex].count} 筆)`,
            },
          },
        },
        scales: {
          x: { ticks: { color: textColor }, grid: { color: gridColor } },
          y: {
            ticks: { color: textColor, callback: v => 'NT$' + Math.round(v).toLocaleString() },
            grid: { color: gridColor },
          },
        },
      },
    });
  } catch { /* no data yet */ }
}

function renderBudgetChart(budgets) {
  const canvas = document.getElementById('budget-bar-chart');
  if (!canvas || !budgets.length) return;
  const { textColor, gridColor } = chartDefaults();
  const labels = budgets.map(b => b.category);
  mkChart('budget-bar-chart', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: '預算',
          data: budgets.map(b => b.amount),
          backgroundColor: '#2dd4a044',
          borderColor: '#2dd4a0',
          borderWidth: 2,
          borderRadius: 4,
        },
        {
          label: '實際支出',
          data: budgets.map(b => b.actual),
          backgroundColor: budgets.map(b =>
            b.actual > b.amount ? '#e11d48cc' : '#1a7f64cc'
          ),
          borderColor: budgets.map(b => b.actual > b.amount ? '#e11d48' : '#1a7f64'),
          borderWidth: 1.5,
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      indexAxis: 'y',
      plugins: {
        legend: { labels: { color: textColor } },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: NT$${Math.round(ctx.raw).toLocaleString()}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: textColor, callback: v => 'NT$' + Math.round(v).toLocaleString() },
          grid: { color: gridColor },
        },
        y: { ticks: { color: textColor }, grid: { color: gridColor } },
      },
    },
  });
}

function renderAccountsDonutChart(accounts) {
  const canvas = document.getElementById('accounts-donut-chart');
  if (!canvas || !accounts.length) return;
  const { textColor } = chartDefaults();

  // Group by type
  const typeMap = new Map();
  const typeLabels = { bank: '銀行', cash: '現金', credit: '信用卡', investment: '投資', other: '其他' };
  for (const a of accounts) {
    const type = a.type || 'other';
    typeMap.set(type, (typeMap.get(type) || 0) + Math.abs(a.balance));
  }
  const entries = [...typeMap.entries()].filter(([, v]) => v > 0);
  if (!entries.length) return;

  const labels = entries.map(([k]) => typeLabels[k] || k);
  const values = entries.map(([, v]) => v);
  const colors = chartPalette(entries.length);

  mkChart('accounts-donut-chart', {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors.map(c => c + 'cc'),
        borderColor: colors,
        borderWidth: 2,
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true,
      cutout: '60%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: textColor, padding: 12, font: { size: 12 } },
        },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.label}: NT$${Math.round(ctx.raw).toLocaleString()}`,
          },
        },
      },
    },
  });
}

function renderTrendChart(data) {
  const maxVal = Math.max(...data.flatMap((d) => [d.totalIncome, d.totalExpense]), 1);
  document.querySelector('#trend-chart').innerHTML = data
    .map((d) => {
      const incH = ((d.totalIncome / maxVal) * 100).toFixed(1);
      const expH = ((d.totalExpense / maxVal) * 100).toFixed(1);
      return `
        <div class="trend-col">
          <div class="trend-bars">
            <div class="trend-bar income" style="height:${incH}%" title="進帳 ${formatMoney(d.totalIncome)}"></div>
            <div class="trend-bar expense" style="height:${expH}%" title="支出 ${formatMoney(d.totalExpense)}"></div>
          </div>
          <div class="trend-month-label">${escapeHtml(d.label)}</div>
        </div>`;
    })
    .join('');
}

function renderCategoryTrend(data) {
  const container = document.querySelector('#category-trend-chart');
  if (!data || !data.length) {
    container.innerHTML = '<div class="row-meta text-muted">無類別趨勢資料</div>';
    return;
  }
  // data is expected to be array of { category, months: [{label, amount}] }
  // or a flat array of { label, category, total }
  // Build a table: rows = categories, columns = months
  let rows;
  if (data[0] && data[0].months) {
    // structured format
    const allLabels = [...new Set(data.flatMap((d) => d.months.map((m) => m.label)))];
    rows = data.map((d) => {
      const byLabel = {};
      d.months.forEach((m) => { byLabel[m.label] = m.amount; });
      return { category: d.category, byLabel };
    });
    container.innerHTML = `
      <div class="table-wrap">
        <table class="cat-trend-table">
          <thead>
            <tr>
              <th>類別</th>
              ${allLabels.map((l) => `<th>${escapeHtml(l)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td>${escapeHtml(r.category)}</td>
                ${allLabels.map((l) => `<td>${formatMoney(r.byLabel[l] || 0)}</td>`).join('')}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  } else {
    // flat format - group by category
    const byCategory = {};
    const allLabels = [];
    data.forEach((d) => {
      if (!byCategory[d.category]) byCategory[d.category] = {};
      byCategory[d.category][d.label] = d.total;
      if (!allLabels.includes(d.label)) allLabels.push(d.label);
    });
    container.innerHTML = `
      <div class="table-wrap">
        <table class="cat-trend-table">
          <thead>
            <tr>
              <th>類別</th>
              ${allLabels.map((l) => `<th>${escapeHtml(l)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${Object.entries(byCategory).map(([cat, byLabel]) => `
              <tr>
                <td>${escapeHtml(cat)}</td>
                ${allLabels.map((l) => `<td>${formatMoney(byLabel[l] || 0)}</td>`).join('')}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }
}

// ── Splits ────────────────────────────────────────────────────────────────
async function loadSplits() {
  try {
    const splits = await api('/api/splits');
    renderSplits(splits);
  } catch (err) {
    document.querySelector('#splits-list').innerHTML = '<div class="row">尚無分帳記錄</div>';
  }
}

function renderSplits(splits) {
  document.querySelector('#splits-list').innerHTML =
    (splits || []).map(renderSplit).join('') || '<div class="row">尚無分帳記錄</div>';
}

function renderSplit(s) {
  const settled = s.settled;
  const participantsHtml = (s.participants || [])
    .map(
      (p) => `
        <div class="participant-row-display${p.paid ? ' paid' : ''}">
          <span>${escapeHtml(p.name)}</span>
          <span>${formatMoney(p.amount)}</span>
          <button class="secondary" style="padding:3px 8px;font-size:12px;" data-participant-toggle="${s.splitId}:${p.participantId}">${p.paid ? '取消' : '已付'}</button>
        </div>`
    )
    .join('');
  return `
    <div class="split-card${settled ? ' settled' : ''}">
      <div class="split-header">
        <div>
          <div class="split-title">${escapeHtml(s.title)}</div>
          <div class="split-total">總金額：${formatMoney(s.totalAmount)}${s.note ? ' · ' + escapeHtml(s.note) : ''}${settled ? ' · 已結算' : ''}</div>
        </div>
        <div class="actions">
          ${!settled ? `<button class="secondary" data-split-settle="${s.splitId}">結算</button>` : ''}
          <button class="danger" data-split-delete="${s.splitId}">刪除</button>
        </div>
      </div>
      <div class="split-participants">${participantsHtml}</div>
    </div>`;
}

// ── Utility Meter Tracking ────────────────────────────────────────────────
const METER_TYPE_LABEL = { electricity: '⚡ 電費', water: '💧 水費', gas: '🔥 瓦斯費', other: '📊 其他' };

async function loadUtility() {
  const list = document.getElementById('meters-list');
  if (!list) return;
  list.innerHTML = '<div class="empty-state">載入中...</div>';
  try {
    const resp = await apiFetch('/api/utility/meters');
    const meters = await resp.json();
    if (!meters.length) {
      list.innerHTML = '<div class="empty-state">尚無表計，點擊「+ 新增表計」開始追蹤</div>';
      return;
    }
    list.innerHTML = meters.map(m => renderMeterCard(m)).join('');
    meters.forEach(m => renderUsageChart(m));
  } catch (err) {
    list.innerHTML = `<div class="empty-state">載入失敗：${err.message}</div>`;
  }
}

function renderMeterCard(m) {
  const typeLabel = METER_TYPE_LABEL[m.type] || m.type;
  const latestVal = m.latestReading ? m.latestReading.reading : '—';
  const latestDate = m.latestReading ? m.latestReading.readDate : '尚無記錄';
  const usageStr = m.currentUsage !== null ? `${m.currentUsage} ${m.unit}` : '—';
  const costStr = m.currentCost !== null ? `NT$ ${m.currentCost.toFixed(0)}` : '—';

  const readingsHtml = m.readings.length ? `
    <table class="utility-table">
      <thead>
        <tr>
          <th>抄錶日期</th><th>錶度數</th><th>用量 (${m.unit})</th><th>費用 (TWD)</th><th>備註</th><th></th>
        </tr>
      </thead>
      <tbody>
        ${m.readings.map(r => `
          <tr>
            <td>${r.readDate}</td>
            <td>${r.reading}</td>
            <td>${r.usage !== null ? r.usage : '—'}</td>
            <td class="${r.cost !== null ? (r.cost > 1000 ? 'cost-high' : 'cost-normal') : ''}">${r.cost !== null ? 'NT$ ' + r.cost.toFixed(0) : '—'}</td>
            <td class="text-muted" style="font-size:12px">${r.note || ''}</td>
            <td>
              ${r.usage !== null && r.cost !== null ? `<button class="secondary small" data-reading-to-tx="${r.readingId}" data-meter-id="${m.meterId}">記帳</button>` : ''}
              <button class="danger small" data-reading-delete="${r.readingId}">刪</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>` : '<div class="empty-state" style="font-size:13px">尚無抄錶記錄</div>';

  return `
    <div class="meter-card panel" id="meter-card-${m.meterId}">
      <div class="meter-card-header">
        <div>
          <span class="meter-type-badge">${typeLabel}</span>
          <span class="meter-name">${m.name}</span>
        </div>
        <div class="meter-header-actions">
          <button class="secondary small" data-meter-edit="${m.meterId}">編輯</button>
          <button class="danger small" data-meter-delete="${m.meterId}">刪除</button>
        </div>
      </div>
      <div class="meter-stats">
        <div class="meter-stat">
          <div class="meter-stat-label">最新錶度</div>
          <div class="meter-stat-value">${latestVal}</div>
          <div class="meter-stat-sub">${latestDate}</div>
        </div>
        <div class="meter-stat">
          <div class="meter-stat-label">本期用量</div>
          <div class="meter-stat-value">${usageStr}</div>
        </div>
        <div class="meter-stat">
          <div class="meter-stat-label">本期費用</div>
          <div class="meter-stat-value cost-highlight">${costStr}</div>
        </div>
        <div class="meter-stat">
          <div class="meter-stat-label">費率</div>
          <div class="meter-stat-value" style="font-size:14px">NT$ ${m.ratePerUnit}/${m.unit}</div>
          <div class="meter-stat-sub">基本費 NT$ ${m.baseCharge}</div>
        </div>
      </div>
      <canvas id="chart-meter-${m.meterId}" class="utility-chart" height="80"></canvas>
      <div id="reading-form-${m.meterId}" class="reading-form" hidden>
        <form data-add-reading="${m.meterId}" class="form-row" style="align-items:flex-end;gap:8px;flex-wrap:wrap">
          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">抄錶日期
            <input type="date" name="readDate" value="${new Date().toISOString().slice(0,10)}" required style="width:140px" />
          </label>
          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">錶度數 (${m.unit})
            <input type="number" name="reading" placeholder="${latestVal !== '—' ? '上次：' + latestVal : '首次抄錶'}" step="0.01" min="0" required style="width:120px" />
          </label>
          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">備註
            <input type="text" name="note" placeholder="選填" style="width:120px" />
          </label>
          <button type="submit" class="primary small">記錄</button>
          <button type="button" class="secondary small" data-hide-reading-form="${m.meterId}">取消</button>
        </form>
      </div>
      <div class="meter-card-footer">
        <button class="secondary" data-show-reading-form="${m.meterId}">+ 新增抄錶</button>
      </div>
      <details class="readings-history">
        <summary>抄錶記錄（${m.readings.length} 筆）</summary>
        ${readingsHtml}
      </details>
    </div>`;
}

function renderUsageChart(m) {
  const canvas = document.getElementById(`chart-meter-${m.meterId}`);
  if (!canvas) return;
  const readings = [...m.readings].reverse();
  if (readings.length < 2) { canvas.hidden = true; return; }
  canvas.hidden = false;
  const usages = readings.slice(1).map((r, i) => ({
    label: r.readDate,
    usage: parseFloat((r.reading - readings[i].reading).toFixed(4)),
  }));
  if (!usages.length) { canvas.hidden = true; return; }
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth || 600;
  const H = 80;
  canvas.width = W;
  canvas.height = H;
  const maxUsage = Math.max(...usages.map(u => u.usage), 1);
  const barW = Math.max(20, (W - 40) / usages.length - 6);
  const pad = { l: 10, r: 10, t: 14, b: 20 };
  const cW = W - pad.l - pad.r;
  const cH = H - pad.t - pad.b;
  ctx.clearRect(0, 0, W, H);
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#d97706';
  usages.forEach((u, i) => {
    const x = pad.l + (i / usages.length) * cW;
    const bH = (u.usage / maxUsage) * cH;
    const y = pad.t + cH - bH;
    ctx.fillStyle = accent + '99';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, barW, bH, 3); else ctx.rect(x, y, barW, bH);
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(u.usage.toString(), x + barW / 2, y - 2);
    ctx.fillStyle = '#888';
    ctx.font = '9px sans-serif';
    ctx.fillText(u.label.slice(5), x + barW / 2, H - 2);
  });
}

function openMeterEdit(meterId, meter) {
  const card = document.getElementById(`meter-card-${meterId}`);
  if (!card) return;
  const existing = card.querySelector('.meter-edit-form');
  if (existing) { existing.remove(); return; }
  const editDiv = document.createElement('div');
  editDiv.className = 'meter-edit-form form-card';
  editDiv.style.marginTop = '12px';
  editDiv.innerHTML = `
    <form data-save-meter="${meterId}" class="form-row" style="flex-wrap:wrap;gap:8px;align-items:flex-end">
      <input type="text" name="name" value="${meter.name}" placeholder="名稱" required style="width:120px" />
      <select name="type">${['electricity','water','gas','other'].map(t => `<option value="${t}" ${meter.type===t?'selected':''}>${METER_TYPE_LABEL[t]||t}</option>`).join('')}</select>
      <input type="text" name="unit" value="${meter.unit}" placeholder="單位" style="width:60px" />
      <input type="number" name="ratePerUnit" value="${meter.ratePerUnit}" step="0.01" min="0" style="width:80px" placeholder="費率" />
      <input type="number" name="baseCharge" value="${meter.baseCharge}" step="0.01" min="0" style="width:80px" placeholder="基本費" />
      <input type="text" name="note" value="${meter.note||''}" placeholder="備註" style="width:120px" />
      <button type="submit" class="primary small">儲存</button>
      <button type="button" class="secondary small" data-cancel-meter-edit="${meterId}">取消</button>
    </form>`;
  card.querySelector('.meter-card-header').after(editDiv);
}

function showReadingToTxModal(readingId) {
  const existing = document.getElementById('reading-tx-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'reading-tx-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:380px">
      <h3 style="margin:0 0 16px">轉為記帳交易</h3>
      <form id="reading-tx-form">
        <input type="hidden" name="readingId" value="${readingId}" />
        <div style="margin-bottom:10px">
          <label style="font-size:13px;display:block;margin-bottom:4px">選擇帳本</label>
          <select name="ledgerId" style="width:100%">${(state.ledgers||[]).map(l=>`<option value="${l.ledgerId}">${l.name}</option>`).join('')}</select>
        </div>
        <div style="margin-bottom:16px">
          <label style="font-size:13px;display:block;margin-bottom:4px">付款方式</label>
          <select name="paymentMethod" style="width:100%">
            ${(state.settings?.paymentMethods||[]).map(m=>`<option value="${m.name}">${m.name}</option>`).join('')}
            <option value="轉帳">轉帳</option>
            <option value="現金">現金</option>
          </select>
        </div>
        <div class="form-row">
          <button type="submit" class="primary" style="flex:1">記入帳本</button>
          <button type="button" id="reading-tx-cancel" class="secondary">取消</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('reading-tx-cancel')?.addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.getElementById('reading-tx-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const resp = await apiFetch(`/api/utility/readings/${readingId}/to-transaction`, {
        method: 'POST',
        body: JSON.stringify({ ledgerId: fd.get('ledgerId'), paymentMethod: fd.get('paymentMethod') })
      });
      const data = await resp.json();
      modal.remove();
      alert(`✓ 已記入帳本！\n費用：NT$ ${data.cost}\n用量：${data.usage}\n${data.description}`);
    } catch (err) { alert('記帳失敗：' + err.message); }
  });
}

document.getElementById('meter-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  try {
    await apiFetch('/api/utility/meters', { method: 'POST', body: JSON.stringify(data) });
    document.getElementById('meter-create-form').hidden = true;
    e.target.reset();
    loadUtility();
  } catch (err) { alert('新增失敗：' + err.message); }
});

// ── Settings ──────────────────────────────────────────────────────────────
async function loadSettings() {
  state.settings = await api('/api/settings');
  renderSettings();
}

function renderSettings() {
  renderPaymentSettings();
  renderCategorySettings('expense', state.settings.expenseCategories, '#expense-settings');
  renderCategorySettings('income', state.settings.incomeCategories, '#income-settings');
  renderBudgetCategorySelect();
  loadPinStatus();
  initNotifications();
  loadExchangeRates();
  loadDashboardConfig();
}

function renderBudgetCategorySelect() {
  const cats = state.settings?.expenseCategories || [];
  document.querySelector('#budget-category-select').innerHTML =
    cats.map((c) => `<option value="${escapeAttr(c.name)}">${escapeHtml(c.name)}</option>`).join('');
}

function renderPaymentSettings() {
  document.querySelector('#payment-settings').innerHTML = state.settings.paymentMethods
    .map(
      (name) => `
        <div class="row">
          <div class="row-title">${escapeHtml(name)}</div>
          <div class="actions">
            <button class="secondary" data-payment-rename="${escapeAttr(name)}">改名</button>
            <button class="danger" data-payment-delete="${escapeAttr(name)}">刪除</button>
          </div>
        </div>`
    )
    .join('');
}

function renderCategorySettings(type, categories, selector) {
  document.querySelector(selector).innerHTML = categories
    .map(
      (category) => `
        <div class="category-block">
          <div class="row">
            <div class="row-main">
              <div class="row-title">${escapeHtml(category.name)}</div>
              <div class="row-meta">${escapeHtml(category.description || '')}</div>
            </div>
            <div class="actions">
              <button class="secondary" data-category-rename="${type}:${escapeAttr(category.name)}">改名</button>
              <button class="danger" data-category-delete="${type}:${escapeAttr(category.name)}">刪除</button>
            </div>
          </div>
          <form class="inline-form subcategory-create" data-type="${type}" data-category="${escapeAttr(category.name)}">
            <input name="name" placeholder="新增子類別" maxlength="40" />
            <button type="submit">新增</button>
          </form>
          <div class="subcategory-list">
            ${category.subcategories
              .map(
                (sub) => `
                  <span class="tag">
                    ${escapeHtml(sub)}
                    <button class="secondary" data-subcategory-rename="${type}:${escapeAttr(category.name)}:${escapeAttr(sub)}">改</button>
                    <button class="danger" data-subcategory-delete="${type}:${escapeAttr(category.name)}:${escapeAttr(sub)}">刪</button>
                  </span>`
              )
              .join('')}
          </div>
        </div>`
    )
    .join('');
}

// ── Auth overlay ──────────────────────────────────────────────────────────
async function checkAuth() {
  try {
    const resp = await fetch('/api/auth/status');
    const data = await resp.json();
    if (!data.pinEnabled) {
      authToken = 'no-auth';
      return true;
    }
    if (!authToken) { showAuthOverlay(); return false; }
    return true;
  } catch { return true; }
}

function showAuthOverlay() {
  const overlay = document.getElementById('auth-overlay');
  if (overlay) { overlay.hidden = false; document.getElementById('pin-input')?.focus(); }
}

function hideAuthOverlay() {
  const overlay = document.getElementById('auth-overlay');
  if (overlay) overlay.hidden = true;
}

document.getElementById('auth-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const pin = document.getElementById('pin-input').value;
  const errEl = document.getElementById('auth-error');
  try {
    const resp = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    const data = await resp.json();
    if (data.token) {
      authToken = data.token;
      localStorage.setItem('authToken', authToken);
      hideAuthOverlay();
      if (errEl) errEl.hidden = true;
    } else {
      if (errEl) errEl.hidden = false;
    }
  } catch {
    if (errEl) errEl.hidden = false;
  }
});

// ── Templates ─────────────────────────────────────────────────────────────
async function loadTemplates() {
  const list = document.getElementById('templates-list');
  if (!list) return;
  try {
    const resp = await apiFetch('/api/templates');
    const templates = await resp.json();
    if (!templates.length) { list.innerHTML = '<div class="empty-state">尚無範本，點擊「+ 新增範本」建立</div>'; return; }
    list.innerHTML = templates.map(t => `
      <div class="template-card">
        <div class="template-name">${escapeHtml(t.name)}</div>
        <div class="template-meta">${t.type === 'expense' ? '支出' : '進帳'} · ${escapeHtml(t.category || '-')} · ${escapeHtml(t.paymentMethod || '-')} · ${t.amount > 0 ? '$' + t.amount : '自填金額'}</div>
        <div class="template-actions">
          <button class="secondary small" data-template-use="${t.templateId}" data-template='${escapeHtml(JSON.stringify(t))}'>使用</button>
          <button class="danger small" data-template-delete="${t.templateId}">刪除</button>
        </div>
      </div>
    `).join('');
  } catch { list.innerHTML = '<div class="empty-state">載入失敗</div>'; }
}

function initTemplateForm() {
  const form = document.getElementById('template-form');
  const tplLedger = document.getElementById('tpl-ledger');
  const tplCategory = document.getElementById('tpl-category');
  const tplSubcategory = document.getElementById('tpl-subcategory');
  const tplPayment = document.getElementById('tpl-payment');
  if (!form) return;

  // Populate ledgers
  if (tplLedger) {
    tplLedger.innerHTML = state.ledgers.map(l => `<option value="${l.ledgerId}">${escapeHtml(l.name)}</option>`).join('');
  }
  // Populate categories based on type
  function populateTplCats() {
    const type = form.querySelector('[name="type"]').value;
    const cats = type === 'expense'
      ? (state.settings?.expenseCategories || [])
      : (state.settings?.incomeCategories || []);
    if (tplCategory) {
      tplCategory.innerHTML = cats.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('');
    }
    populateTplSubcats(cats[0]);
  }
  function populateTplSubcats(cat) {
    if (!cat || !tplSubcategory) return;
    const sub = cat.subcategories || [];
    tplSubcategory.innerHTML = sub.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  }
  form.querySelector('[name="type"]')?.addEventListener('change', populateTplCats);
  tplCategory?.addEventListener('change', () => {
    const type = form.querySelector('[name="type"]').value;
    const cats = type === 'expense'
      ? (state.settings?.expenseCategories || [])
      : (state.settings?.incomeCategories || []);
    const selected = cats.find(c => c.name === tplCategory.value);
    populateTplSubcats(selected);
  });
  if (tplPayment) {
    tplPayment.innerHTML = (state.settings?.paymentMethods || []).map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
  }
  populateTplCats();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    try {
      await apiFetch('/api/templates', { method: 'POST', body: JSON.stringify(data) });
      document.getElementById('template-create-form').hidden = true;
      form.reset();
      await loadTemplates();
    } catch (err) { alert('新增失敗：' + err.message); }
  });
}

// ── Batch operations ──────────────────────────────────────────────────────
const selectedTxIds = new Set();

function updateBatchBar() {
  const bar = document.getElementById('batch-action-bar');
  const countEl = document.getElementById('batch-count');
  if (!bar) return;
  if (selectedTxIds.size === 0) { bar.hidden = true; return; }
  bar.hidden = false;
  if (countEl) countEl.textContent = `${selectedTxIds.size} 筆已選`;
  const moveSelect = document.getElementById('batch-move-ledger');
  if (moveSelect && !moveSelect.options.length) {
    moveSelect.innerHTML = state.ledgers.map(l => `<option value="${l.ledgerId}">${escapeHtml(l.name)}</option>`).join('');
  }
}

document.getElementById('select-all-tx')?.addEventListener('change', (e) => {
  const checked = e.target.checked;
  document.querySelectorAll('.tx-row-checkbox').forEach(cb => {
    cb.checked = checked;
    const id = Number(cb.dataset.txId);
    if (checked) selectedTxIds.add(id); else selectedTxIds.delete(id);
  });
  updateBatchBar();
});

document.getElementById('batch-clear-btn')?.addEventListener('click', () => {
  selectedTxIds.clear();
  document.querySelectorAll('.tx-row-checkbox').forEach(cb => { cb.checked = false; });
  const selAll = document.getElementById('select-all-tx');
  if (selAll) selAll.checked = false;
  updateBatchBar();
});

document.getElementById('batch-delete-btn')?.addEventListener('click', async () => {
  if (!selectedTxIds.size) return;
  if (!confirm(`確定刪除 ${selectedTxIds.size} 筆交易？`)) return;
  try {
    await apiFetch('/api/transactions/batch-delete', {
      method: 'POST', body: JSON.stringify({ ids: [...selectedTxIds] })
    });
    selectedTxIds.clear();
    updateBatchBar();
    refreshCurrentView();
  } catch (err) { alert('刪除失敗：' + err.message); }
});

document.getElementById('batch-move-btn')?.addEventListener('click', async () => {
  if (!selectedTxIds.size) return;
  const ledgerId = document.getElementById('batch-move-ledger').value;
  try {
    await apiFetch('/api/transactions/batch-move', {
      method: 'POST', body: JSON.stringify({ ids: [...selectedTxIds], ledgerId })
    });
    selectedTxIds.clear();
    updateBatchBar();
    refreshCurrentView();
  } catch (err) { alert('移動失敗：' + err.message); }
});

// ── Financial insights ────────────────────────────────────────────────────
async function loadInsights() {
  const panel = document.getElementById('insights-panel');
  const list = document.getElementById('insights-list');
  if (!panel || !list) return;

  const dashConfig = JSON.parse(localStorage.getItem('dashboardConfig') || '{}');
  if (dashConfig.showInsights === false) { panel.hidden = true; return; }
  panel.hidden = false;

  try {
    const resp = await apiFetch('/api/insights');
    const insights = await resp.json();
    list.innerHTML = insights.map(ins => `
      <div class="insight-card insight-${escapeHtml(ins.severity)}">
        <div class="insight-title">${escapeHtml(ins.title)}</div>
        <div class="insight-msg">${escapeHtml(ins.message)}</div>
      </div>
    `).join('');
  } catch { list.innerHTML = '<div class="text-muted">洞察載入失敗</div>'; }
}

// ── Push notifications ────────────────────────────────────────────────────
async function initNotifications() {
  const statusEl = document.getElementById('notification-status');
  const btn = document.getElementById('enable-notifications-btn');
  if (!statusEl || !btn) return;

  if (!('Notification' in window)) {
    statusEl.textContent = '此瀏覽器不支援通知';
    btn.hidden = true;
    return;
  }
  const perm = Notification.permission;
  if (perm === 'granted') {
    statusEl.textContent = '✓ 通知已啟用';
    btn.textContent = '測試通知';
    btn.onclick = () => new Notification('帳本提醒', { body: '通知功能正常運作！' });
  } else if (perm === 'denied') {
    statusEl.textContent = '通知已被封鎖，請至瀏覽器設定啟用';
    btn.hidden = true;
  } else {
    statusEl.textContent = '尚未啟用推播通知';
    btn.onclick = async () => {
      const result = await Notification.requestPermission();
      if (result === 'granted') {
        statusEl.textContent = '✓ 通知已啟用';
        btn.textContent = '測試通知';
        btn.onclick = () => new Notification('帳本提醒', { body: '通知功能正常運作！' });
        scheduleNotifications();
      } else {
        statusEl.textContent = '通知請求被拒絕';
      }
    };
  }
}

async function scheduleNotifications() {
  if (Notification.permission !== 'granted') return;
  try {
    const resp = await apiFetch('/api/dashboard');
    const data = await resp.json();
    const alerts = data.alerts || {};
    for (const bill of (alerts.upcomingBills || [])) {
      if (bill.daysUntil === 0) {
        new Notification(`今日帳單提醒：${bill.name}`, { body: `金額 $${bill.amount}，今天到期` });
      } else if (bill.daysUntil === 1) {
        new Notification(`明日帳單提醒：${bill.name}`, { body: `金額 $${bill.amount}，明天到期` });
      }
    }
    for (const rec of (alerts.overdueRecurring || [])) {
      new Notification(`定期交易提醒：${rec.description || rec.category}`, { body: `$${rec.amount} 已逾期，請記入` });
    }
  } catch {}
}

// ── Backup / restore ──────────────────────────────────────────────────────
document.getElementById('backup-btn')?.addEventListener('click', async () => {
  try {
    const resp = await apiFetch('/api/backup');
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `accounting-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) { alert('備份失敗：' + err.message); }
});

document.getElementById('restore-input')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const resultEl = document.getElementById('restore-result');
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!confirm(`確定要還原備份？這將覆蓋目前所有資料！`)) return;
    const resp = await apiFetch('/api/restore', { method: 'POST', body: JSON.stringify(data) });
    const result = await resp.json();
    if (resultEl) resultEl.textContent = `✓ 還原成功，共 ${result.restoredTransactions} 筆交易`;
    setTimeout(() => location.reload(), 2000);
  } catch (err) {
    if (resultEl) resultEl.textContent = `✗ 還原失敗：${err.message}`;
  }
  e.target.value = '';
});

// ── Exchange rates ────────────────────────────────────────────────────────
async function loadExchangeRates() {
  const panel = document.getElementById('exchange-rates-panel');
  if (!panel) return;
  try {
    const resp = await apiFetch('/api/exchange-rates');
    const data = await resp.json();
    const rates = data.rates || {};
    const display = ['USD', 'JPY', 'EUR', 'CNY', 'HKD'];
    panel.innerHTML = `<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">更新日期：${escapeHtml(data.date || '')}</div>` +
      display.filter(k => rates[k]).map(k =>
        `<div class="rate-row"><span class="rate-currency">${k}</span><span class="rate-value">1 TWD = ${(1/rates[k]).toFixed(4)} ${k} &nbsp;|&nbsp; 1 ${k} = ${rates[k].toFixed(4)} TWD</span></div>`
      ).join('');
  } catch { panel.textContent = '匯率載入失敗（需要網路連線）'; }
}

// ── Dashboard customization ───────────────────────────────────────────────
const DASHBOARD_CARDS = [
  { key: 'showAlerts', label: '近期提醒' },
  { key: 'showInsights', label: '財務洞察' },
  { key: 'showCharts', label: '圖表統計' },
  { key: 'showLedgers', label: '帳本明細' },
];

function loadDashboardConfig() {
  const container = document.getElementById('dashboard-cards-config');
  if (!container) return;
  const config = JSON.parse(localStorage.getItem('dashboardConfig') || '{}');
  container.innerHTML = DASHBOARD_CARDS.map(card => `
    <label class="toggle-row">
      <input type="checkbox" data-dash-card="${card.key}" ${config[card.key] !== false ? 'checked' : ''}>
      <span>${escapeHtml(card.label)}</span>
    </label>
  `).join('');
  container.querySelectorAll('[data-dash-card]').forEach(cb => {
    cb.addEventListener('change', () => {
      const cfg = JSON.parse(localStorage.getItem('dashboardConfig') || '{}');
      cfg[cb.dataset.dashCard] = cb.checked;
      localStorage.setItem('dashboardConfig', JSON.stringify(cfg));
    });
  });
}

// ── PIN settings UI ───────────────────────────────────────────────────────
async function loadPinStatus() {
  const statusEl = document.getElementById('pin-status');
  if (!statusEl) return;
  try {
    const resp = await fetch('/api/auth/status');
    const data = await resp.json();
    statusEl.textContent = data.pinEnabled ? '✓ PIN 已設定' : '未設定 PIN（所有人可存取）';
  } catch { statusEl.textContent = '狀態載入失敗'; }
}

document.getElementById('set-pin-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const pin = document.getElementById('new-pin-input').value.trim();
  try {
    await apiFetch('/api/auth/set-pin', {
      method: 'POST', body: JSON.stringify({ pin })
    });
    if (!pin) {
      alert('PIN 已清除，應用程式將不再需要 PIN 碼');
      authToken = 'no-auth';
    } else {
      alert('PIN 已設定！下次開啟時需要輸入 PIN 碼');
    }
    loadPinStatus();
    document.getElementById('new-pin-input').value = '';
  } catch (err) { alert('設定失敗：' + err.message); }
});

// ── Modal ─────────────────────────────────────────────────────────────────
function openTxModal() {
  if (!state.settings || !state.ledgers.length) {
    showStatus('資料尚未載入，請稍後再試', true);
    return;
  }
  state.modalType = 'expense';

  const ledgerSel = document.querySelector('#modal-ledger');
  ledgerSel.innerHTML = state.ledgers
    .map((l) => `<option value="${l.ledgerId}">${escapeHtml(l.name)}</option>`)
    .join('');

  const pmSel = document.querySelector('#modal-payment');
  pmSel.innerHTML = state.settings.paymentMethods
    .map((p) => `<option value="${escapeAttr(p)}">${escapeHtml(p)}</option>`)
    .join('');

  document.querySelectorAll('.type-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.type === 'expense');
  });

  updateModalCategories();
  document.querySelector('#tx-modal-overlay').hidden = false;
  document.querySelector('#modal-amount').focus();
}

function closeTxModal() {
  document.querySelector('#tx-modal-overlay').hidden = true;
  document.querySelector('#tx-modal-form').reset();
  clearReceiptPreview();
}

function updateModalCategories() {
  const cats =
    state.modalType === 'expense'
      ? state.settings.expenseCategories
      : state.settings.incomeCategories;
  const catSel = document.querySelector('#modal-category');
  catSel.innerHTML = cats
    .map((c) => `<option value="${escapeAttr(c.name)}">${escapeHtml(c.name)}</option>`)
    .join('');
  updateModalSubcategories();
}

function updateModalSubcategories() {
  const cats =
    state.modalType === 'expense'
      ? state.settings.expenseCategories
      : state.settings.incomeCategories;
  const catSel = document.querySelector('#modal-category');
  const cat = cats.find((c) => c.name === catSel.value);
  const subSel = document.querySelector('#modal-subcategory');
  subSel.innerHTML = (cat?.subcategories || [])
    .map((s) => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`)
    .join('');
}

// ── Navigation ────────────────────────────────────────────────────────────
function setView(view) {
  state.currentView = view;
  document.querySelectorAll('.nav-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });
  document.querySelectorAll('.view').forEach((section) => {
    section.classList.toggle('active', section.id === `${view}-view`);
  });
  const titles = {
    dashboard: '總覽',
    transactions: '交易',
    accounts: '帳戶',
    ledgers: '帳本',
    budget: '預算管理',
    goals: '儲蓄目標',
    recurring: '定期交易',
    reminders: '帳單提醒',
    reports: '趨勢報表',
    splits: '分帳',
    utility: '水電用量追蹤',
    settings: '設定',
    calendar: '記帳月曆',
  };
  document.querySelector('#page-title').textContent = titles[view] || view;

  // Initialize recurring form when navigating to it
  if (view === 'recurring') initRecurringForm();
  // Load templates when navigating to transactions
  if (view === 'transactions') {
    loadTemplates();
    initTemplateForm();
  }
  if (view === 'utility') loadUtility();
  if (view === 'calendar') loadCalendar();
}

async function refreshCurrentView() {
  await loadLedgers();
  if (state.currentView === 'dashboard') await loadDashboard();
  if (state.currentView === 'settings') await loadSettings();
  if (state.currentView === 'transactions') { await loadTransactions(); await loadTemplates(); }
  if (state.currentView === 'budget') await loadBudgets();
  if (state.currentView === 'reports') await loadReports();
  if (state.currentView === 'accounts') await loadAccounts();
  if (state.currentView === 'goals') await loadGoals();
  if (state.currentView === 'recurring') await loadRecurring();
  if (state.currentView === 'reminders') await loadReminders();
  if (state.currentView === 'splits') await loadSplits();
  if (state.currentView === 'utility') await loadUtility();
  if (state.currentView === 'calendar') await loadCalendar();
}

// ── Merchant memory ───────────────────────────────────────────────────────
const MERCHANT_MEMORY_KEY = 'merchantMemory_v1';

function getMerchantMemory() {
  try { return JSON.parse(localStorage.getItem(MERCHANT_MEMORY_KEY) || '{}'); } catch { return {}; }
}

function saveMerchantMemory(description, category, subcategory, paymentMethod) {
  if (!description || !category) return;
  const mem = getMerchantMemory();
  mem[description.trim()] = { category, subcategory, paymentMethod, ts: Date.now() };
  const trimmed = Object.entries(mem).sort((a, b) => (b[1].ts - a[1].ts)).slice(0, 150);
  localStorage.setItem(MERCHANT_MEMORY_KEY, JSON.stringify(Object.fromEntries(trimmed)));
}

function lookupMerchant(description) {
  if (!description) return null;
  const mem = getMerchantMemory();
  return mem[description.trim()] || null;
}

let _pendingMerchantHint = null;

function showMerchantHint(suggestion) {
  _pendingMerchantHint = suggestion;
  const hint = document.getElementById('merchant-suggestion');
  const text = document.getElementById('merchant-hint-text');
  if (!hint || !text) return;
  text.textContent = `上次：${suggestion.category}${suggestion.subcategory ? ' > ' + suggestion.subcategory : ''} · ${suggestion.paymentMethod}`;
  hint.hidden = false;
}

function hideMerchantHint() {
  _pendingMerchantHint = null;
  const hint = document.getElementById('merchant-suggestion');
  if (hint) hint.hidden = true;
}

function applyMerchantHint() {
  if (!_pendingMerchantHint) return;
  const { category, subcategory, paymentMethod } = _pendingMerchantHint;
  const modalCat = document.getElementById('modal-category');
  if (modalCat && category) {
    modalCat.value = category;
    modalCat.dispatchEvent(new Event('change'));
    setTimeout(() => {
      const modalSub = document.getElementById('modal-subcategory');
      if (modalSub && subcategory) modalSub.value = subcategory;
      const modalPay = document.getElementById('modal-payment');
      if (modalPay && paymentMethod) modalPay.value = paymentMethod;
    }, 50);
  }
  hideMerchantHint();
}

// Merchant memory — description field watcher
document.addEventListener('blur', e => {
  if (e.target.id === 'modal-description' || e.target.name === 'description') {
    const val = e.target.value.trim();
    if (!val) { hideMerchantHint(); return; }
    const suggestion = lookupMerchant(val);
    if (suggestion) showMerchantHint(suggestion);
    else hideMerchantHint();
  }
}, true);

document.getElementById('apply-merchant-hint')?.addEventListener('click', applyMerchantHint);
document.getElementById('dismiss-merchant-hint')?.addEventListener('click', hideMerchantHint);

// ── Event delegation ──────────────────────────────────────────────────────
document.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  // Navigation
  const nav = target.closest('.nav-button');
  if (nav) {
    setView(nav.dataset.view);
    await refreshCurrentView();
    return;
  }

  // Type toggle in modal
  const typeBtn = target.closest('.type-btn');
  if (typeBtn) {
    state.modalType = typeBtn.dataset.type;
    document.querySelectorAll('.type-btn').forEach((b) => b.classList.remove('active'));
    typeBtn.classList.add('active');
    updateModalCategories();
    return;
  }

  // Participant remove button in split form
  if (target.classList.contains('participant-remove')) {
    target.closest('.participant-row')?.remove();
    return;
  }

  // Dark mode toggles
  if (target.id === 'dark-mode-toggle' || target.id === 'settings-dark-toggle') {
    toggleTheme();
    return;
  }

  try {
    if (target.dataset.receiptTx) {
      showReceiptLightbox(Number(target.dataset.receiptTx));
      return;
    } else if (target.id === 'add-tx-fab') {
      openTxModal();
      return;
    } else if (target.id === 'tx-modal-cancel') {
      closeTxModal();
      return;
    } else if (target.id === 'export-csv-btn') {
      exportCsv();
      return;
    } else if (target.id === 'print-report-btn') {
      await preparePrintReport();
      window.print();
      return;
    } else if (target.id === 'custom-range-btn') {
      await loadCustomReport();
      return;
    } else if (target.id === 'add-participant-btn') {
      const row = document.createElement('div');
      row.className = 'participant-row';
      row.innerHTML = `<input name="pname" placeholder="名稱" /><input type="number" name="pamount" placeholder="金額" min="0" step="0.01" /><button type="button" class="danger participant-remove">✕</button>`;
      document.querySelector('#split-participants-rows').appendChild(row);
      return;
    } else if (target.dataset.ledgerView) {
      openLedgerTransactions(Number(target.dataset.ledgerView));
    } else if (target.dataset.preset) {
      const form = document.querySelector('#transaction-filter');
      const now = new Date();
      let start, end;
      if (target.dataset.preset === 'today') {
        start = end = toDateInput(now);
      } else if (target.dataset.preset === 'week') {
        const day = now.getDay() || 7;
        start = toDateInput(new Date(now.getTime() - (day - 1) * 86400000));
        end = toDateInput(now);
      } else if (target.dataset.preset === 'month') {
        start = toDateInput(new Date(now.getFullYear(), now.getMonth(), 1));
        end = toDateInput(now);
      } else if (target.dataset.preset === 'last-month') {
        const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
        start = toDateInput(new Date(lastDay.getFullYear(), lastDay.getMonth(), 1));
        end = toDateInput(lastDay);
      }
      if (start && end) {
        form.querySelector('[name="start"]').value = start;
        form.querySelector('[name="end"]').value = end;
        loadTransactions();
      }
    } else if (target.dataset.ledgerRename) {
      const ledger = state.ledgers.find((item) => item.ledgerId === Number(target.dataset.ledgerRename));
      const name = prompt('新的帳本名稱', ledger?.name || '');
      if (name) await api(`/api/ledgers/${target.dataset.ledgerRename}/name`, { method: 'PATCH', body: JSON.stringify({ name }) });
      await refreshCurrentView();
    } else if (target.dataset.ledgerArchive) {
      if (confirm('確定要封存這個帳本？')) {
        await api(`/api/ledgers/${target.dataset.ledgerArchive}/archive`, { method: 'PATCH' });
        await refreshCurrentView();
      }
    } else if (target.dataset.ledgerUnarchive) {
      await api(`/api/ledgers/${target.dataset.ledgerUnarchive}/unarchive`, { method: 'PATCH' });
      await refreshCurrentView();
    } else if (target.dataset.txAmount) {
      const amount = prompt('新的金額');
      if (amount) {
        await api(`/api/transactions/${target.dataset.txAmount}/amount`, { method: 'PATCH', body: JSON.stringify({ amount: Number(amount) }) });
        await loadTransactions();
      }
    } else if (target.dataset.txNote) {
      const description = prompt('新的備註，留空代表清空') || '';
      await api(`/api/transactions/${target.dataset.txNote}/note`, { method: 'PATCH', body: JSON.stringify({ description }) });
      await loadTransactions();
    } else if (target.dataset.txTags) {
      const currentTags = target.closest('tr')?.querySelector('td:nth-child(7)')?.textContent?.trim() || '';
      const tags = prompt('編輯標籤（用逗號分隔）', currentTags);
      if (tags !== null) {
        await api(`/api/transactions/${target.dataset.txTags}/tags`, { method: 'PATCH', body: JSON.stringify({ tags }) });
        await loadTransactions();
      }
    } else if (target.dataset.txDelete) {
      if (confirm('確定要刪除這筆交易？')) {
        await api(`/api/transactions/${target.dataset.txDelete}`, { method: 'DELETE' });
        await loadTransactions();
      }
    } else if (target.dataset.budgetDelete) {
      if (confirm('確定要刪除此預算？')) {
        await api(`/api/budgets/${target.dataset.budgetDelete}`, { method: 'DELETE' });
        await loadBudgets();
        showStatus('已刪除預算');
      }
      return;
    } else if (target.dataset.accountEdit) {
      const name = prompt('新的口袋名稱');
      if (name) {
        await api(`/api/accounts/${target.dataset.accountEdit}`, { method: 'PATCH', body: JSON.stringify({ name }) });
        await loadAccounts();
      }
    } else if (target.dataset.accountDelete) {
      if (confirm('確定要刪除此口袋？')) {
        await api(`/api/accounts/${target.dataset.accountDelete}`, { method: 'DELETE' });
        await loadAccounts();
      }
    } else if (target.dataset.pocketDeposit) {
      showPocketAdjust(target.dataset.pocketDeposit, 'deposit');
    } else if (target.dataset.pocketWithdraw) {
      showPocketAdjust(target.dataset.pocketWithdraw, 'withdraw');
    } else if (target.dataset.pocketCancel) {
      hidePocketAdjust(target.dataset.pocketCancel);
    } else if (target.dataset.pocketConfirm) {
      const id  = target.dataset.pocketConfirm;
      const box = document.getElementById(`pocket-adjust-${id}`);
      const amt = Number(box?.querySelector('.pocket-adjust-input')?.value);
      const mode = box?.dataset.mode;
      if (!amt || amt <= 0) { showStatus('請輸入有效金額', true); return; }
      const data = await api('/api/accounts');
      const acc  = (data.accounts || []).find(a => String(a.accountId) === id);
      if (!acc) return;
      const newBalance = mode === 'deposit' ? acc.balance + amt : acc.balance - amt;
      await api(`/api/accounts/${id}`, { method: 'PATCH', body: JSON.stringify({ balance: newBalance }) });
      await loadAccounts();
      showStatus(mode === 'deposit' ? `已存入 ${formatMoney(amt)}` : `已提取 ${formatMoney(amt)}`);
    } else if (target.dataset.goalDeposit) {
      const amount = prompt('存入金額');
      if (amount && Number(amount) > 0) {
        await api(`/api/goals/${target.dataset.goalDeposit}/deposit`, { method: 'PATCH', body: JSON.stringify({ amount: Number(amount) }) });
        await loadGoals();
      }
    } else if (target.dataset.goalDelete) {
      if (confirm('確定要刪除此目標？')) {
        await api(`/api/goals/${target.dataset.goalDelete}`, { method: 'DELETE' });
        await loadGoals();
      }
    } else if (target.dataset.recurringToggle) {
      await api(`/api/recurring/${target.dataset.recurringToggle}/toggle`, { method: 'PATCH' });
      await loadRecurring();
    } else if (target.dataset.recurringApply) {
      if (confirm('立即記入這筆定期交易？')) {
        await api(`/api/recurring/${target.dataset.recurringApply}/apply`, { method: 'POST' });
        showStatus('已記入交易');
        await loadRecurring();
      }
    } else if (target.dataset.recurringDelete) {
      if (confirm('確定要刪除此定期交易？')) {
        await api(`/api/recurring/${target.dataset.recurringDelete}`, { method: 'DELETE' });
        await loadRecurring();
      }
    } else if (target.dataset.reminderToggle) {
      await api(`/api/reminders/${target.dataset.reminderToggle}/toggle`, { method: 'PATCH' });
      await loadReminders();
    } else if (target.dataset.reminderDelete) {
      if (confirm('確定要刪除此提醒？')) {
        await api(`/api/reminders/${target.dataset.reminderDelete}`, { method: 'DELETE' });
        await loadReminders();
      }
    } else if (target.dataset.participantToggle) {
      const [splitId, participantId] = String(target.dataset.participantToggle).split(':');
      await api(`/api/splits/${splitId}/participants/${participantId}/paid`, { method: 'PATCH' });
      await loadSplits();
    } else if (target.dataset.splitSettle) {
      if (confirm('確定要結算此分帳？')) {
        await api(`/api/splits/${target.dataset.splitSettle}/settle`, { method: 'PATCH' });
        await loadSplits();
      }
    } else if (target.dataset.splitDelete) {
      if (confirm('確定要刪除此分帳？')) {
        await api(`/api/splits/${target.dataset.splitDelete}`, { method: 'DELETE' });
        await loadSplits();
      }
    } else if (target.dataset.paymentRename) {
      const oldName = target.dataset.paymentRename;
      const newName = prompt('新的付款方式名稱', oldName);
      if (newName) {
        await api('/api/settings/payment', { method: 'PATCH', body: JSON.stringify({ oldName, newName }) });
        await loadSettings();
      }
    } else if (target.dataset.paymentDelete) {
      if (confirm('確定要刪除付款方式？')) {
        await api(`/api/settings/payment?name=${encodeURIComponent(target.dataset.paymentDelete)}`, { method: 'DELETE' });
        await loadSettings();
      }
    } else if (target.dataset.categoryRename) {
      const [type, oldName] = splitPayload(target.dataset.categoryRename);
      const newName = prompt('新的類別名稱', oldName);
      if (newName) {
        await api('/api/settings/category', { method: 'PATCH', body: JSON.stringify({ type, oldName, newName }) });
        await loadSettings();
      }
    } else if (target.dataset.categoryDelete) {
      const [type, name] = splitPayload(target.dataset.categoryDelete);
      if (confirm('確定要刪除類別與其所有子類別？')) {
        await api(`/api/settings/category?type=${type}&name=${encodeURIComponent(name)}`, { method: 'DELETE' });
        await loadSettings();
      }
    } else if (target.dataset.subcategoryRename) {
      const [type, categoryName, oldName] = splitPayload(target.dataset.subcategoryRename);
      const newName = prompt('新的子類別名稱', oldName);
      if (newName) {
        await api('/api/settings/subcategory', { method: 'PATCH', body: JSON.stringify({ type, categoryName, oldName, newName }) });
        await loadSettings();
      }
    } else if (target.dataset.subcategoryDelete) {
      const [type, categoryName, name] = splitPayload(target.dataset.subcategoryDelete);
      if (confirm('確定要刪除子類別？')) {
        await api(`/api/settings/subcategory?type=${type}&categoryName=${encodeURIComponent(categoryName)}&name=${encodeURIComponent(name)}`, { method: 'DELETE' });
        await loadSettings();
      }
    } else if (target.id === 'show-template-create-btn') {
      const createForm = document.getElementById('template-create-form');
      if (createForm) createForm.hidden = !createForm.hidden;
      initTemplateForm();
      return;
    } else if (target.id === 'template-form-cancel') {
      const createForm = document.getElementById('template-create-form');
      if (createForm) createForm.hidden = true;
      return;
    } else if (target.dataset.templateDelete) {
      if (!confirm('刪除此範本？')) return;
      await apiFetch(`/api/templates/${target.dataset.templateDelete}`, { method: 'DELETE' });
      loadTemplates();
      return;
    } else if (target.dataset.templateUse) {
      const t = JSON.parse(target.dataset.template || '{}');
      openTxModal();
      setTimeout(() => {
        const modalType = document.querySelector('#tx-modal-form .type-btn[data-type="' + (t.type || 'expense') + '"]');
        if (modalType) { modalType.click(); }
        const modalLedger = document.getElementById('modal-ledger');
        if (modalLedger) modalLedger.value = t.ledgerId;
        const modalAmount = document.getElementById('modal-amount');
        if (modalAmount && t.amount) modalAmount.value = t.amount;
        const modalCurrency = document.getElementById('modal-currency');
        if (modalCurrency) modalCurrency.value = t.currency || 'TWD';
        const modalDesc = document.querySelector('#tx-modal-form [name="description"]');
        if (modalDesc) modalDesc.value = t.description || '';
        setTimeout(() => {
          const modalCat = document.getElementById('modal-category');
          if (modalCat) { modalCat.value = t.category; modalCat.dispatchEvent(new Event('change')); }
          setTimeout(() => {
            const modalSub = document.getElementById('modal-subcategory');
            if (modalSub) modalSub.value = t.subcategory;
            const modalPay = document.getElementById('modal-payment');
            if (modalPay) modalPay.value = t.paymentMethod;
          }, 50);
        }, 50);
      }, 50);
      return;
    } else if (target.classList.contains('tx-row-checkbox')) {
      const id = Number(target.dataset.txId);
      if (target.checked) selectedTxIds.add(id); else selectedTxIds.delete(id);
      updateBatchBar();
      return;
    } else if (target.id === 'add-meter-btn') {
      const form = document.getElementById('meter-create-form');
      if (form) form.hidden = !form.hidden;
      return;
    } else if (target.id === 'meter-form-cancel') {
      const form = document.getElementById('meter-create-form');
      if (form) form.hidden = true;
      return;
    } else if (target.dataset.showReadingForm) {
      const form = document.getElementById(`reading-form-${target.dataset.showReadingForm}`);
      if (form) form.hidden = false;
      return;
    } else if (target.dataset.hideReadingForm) {
      const form = document.getElementById(`reading-form-${target.dataset.hideReadingForm}`);
      if (form) form.hidden = true;
      return;
    } else if (target.dataset.meterDelete) {
      if (!confirm('確定刪除此表計？所有抄錶記錄也會一併刪除。')) return;
      await apiFetch(`/api/utility/meters/${target.dataset.meterDelete}`, { method: 'DELETE' });
      loadUtility();
      return;
    } else if (target.dataset.meterEdit) {
      const resp = await apiFetch('/api/utility/meters');
      const meters = await resp.json();
      const meter = meters.find(m => m.meterId == target.dataset.meterEdit);
      if (meter) openMeterEdit(meter.meterId, meter);
      return;
    } else if (target.dataset.cancelMeterEdit) {
      document.getElementById(`meter-card-${target.dataset.cancelMeterEdit}`)?.querySelector('.meter-edit-form')?.remove();
      return;
    } else if (target.dataset.readingDelete) {
      if (!confirm('確定刪除此抄錶記錄？')) return;
      await apiFetch(`/api/utility/readings/${target.dataset.readingDelete}`, { method: 'DELETE' });
      loadUtility();
      return;
    } else if (target.dataset.readingToTx) {
      showReadingToTxModal(target.dataset.readingToTx);
      return;
    } else {
      return;
    }
    showStatus('已更新');
  } catch (err) {
    showStatus(err.message || '操作失敗', true);
  }
});

// Close modal when clicking overlay background
document.querySelector('#tx-modal-overlay').addEventListener('click', (event) => {
  if (event.target === event.currentTarget) closeTxModal();
});

// Modal category select change
document.querySelector('#modal-category').addEventListener('change', updateModalSubcategories);

// Recurring type/category change
document.querySelector('#rec-type').addEventListener('change', updateRecurringCategories);
document.querySelector('#rec-category').addEventListener('change', updateRecurringSubcategories);

// Modal form submit → create transaction
document.querySelector('#tx-modal-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const amount = Number(form.amount.value);
  if (!amount || amount <= 0) { showStatus('金額必須大於 0', true); return; }
  try {
    const tagsRaw = form.tags?.value?.trim() || '';
    const newTx = await api('/api/transactions', {
      method: 'POST',
      body: JSON.stringify({
        ledgerId: Number(form.ledgerId.value),
        type: state.modalType,
        amount,
        category: form.category.value,
        subcategory: form.subcategory.value,
        paymentMethod: form.paymentMethod.value,
        currency: form.currency?.value || 'TWD',
        description: form.description.value.trim(),
        tags: tagsRaw,
      }),
    });
    if (_pendingReceiptBase64 && newTx?.transactionId) {
      apiFetch(`/api/transactions/${newTx.transactionId}/attachment`, {
        method: 'POST',
        body: JSON.stringify({ data: _pendingReceiptBase64, mimeType: 'image/jpeg' }),
      }).then(() => addReceiptTxId(newTx.transactionId)).catch(() => {});
    }
    // Save merchant memory
    const desc = form.querySelector('[name="description"]')?.value?.trim() || '';
    const cat = form.querySelector('[name="category"]')?.value || document.getElementById('modal-category')?.value || '';
    const sub = form.querySelector('[name="subcategory"]')?.value || document.getElementById('modal-subcategory')?.value || '';
    const pay = form.querySelector('[name="paymentMethod"]')?.value || document.getElementById('modal-payment')?.value || '';
    saveMerchantMemory(desc, cat, sub, pay);
    hideMerchantHint();
    if (state.modalType === 'expense' && cat) checkBudgetOverspend(cat).catch(() => {});
    closeTxModal();
    showStatus('已新增交易');
    await refreshCurrentView();
  } catch (err) {
    showStatus(err.message || '新增失敗', true);
  }
});

// Refresh button
document.querySelector('#refresh-button').addEventListener('click', refreshCurrentView);

// Transaction filter
document.querySelector('#transaction-filter').addEventListener('submit', loadTransactions);

// Advanced search
document.querySelector('#advanced-search-form').addEventListener('submit', runAdvancedSearch);

// CSV Import
document.getElementById('download-csv-template-btn').addEventListener('click', () => {
  const rows = [
    'type,amount,category,subcategory,paymentMethod,description',
    'expense,150,食,早餐,現金,7-11 早餐',
    'expense,1200,住,水費,信用卡,台水 6 月水費',
    'expense,350,行,捷運,悠遊卡,上班通勤',
    'expense,500,樂,電影,信用卡,週末看電影',
    'income,50000,薪資,月薪,匯款,6 月薪資',
    'income,2000,被動收入,利息,匯款,定存利息',
  ];
  const blob = new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '匯入範本.csv';
  a.click();
  URL.revokeObjectURL(url);
});

document.querySelector('#import-csv-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const ledgerId = form.ledgerId.value;
  const file = form.csvFile.files[0];
  if (!ledgerId || !file) { showStatus('請選擇帳本和 CSV 檔案', true); return; }
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const rows = lines.slice(1).map((line) => {
    const [type, amount, category, subcategory, paymentMethod, description] = line
      .split(',')
      .map((s) => s.replace(/^"|"$/g, '').trim());
    return { type, amount: Number(amount), category, subcategory, paymentMethod, description };
  }).filter((r) => r.type && r.amount);
  try {
    const result = await api('/api/import/csv', {
      method: 'POST',
      body: JSON.stringify({ ledgerId: Number(ledgerId), rows }),
    });
    document.querySelector('#import-result').textContent =
      `成功匯入 ${result.imported} 筆${result.errors?.length ? `，${result.errors.length} 筆失敗` : ''}`;
    showStatus('匯入完成');
  } catch (err) {
    showStatus(err.message || '匯入失敗', true);
  }
});

// Ledger create form
document.querySelector('#ledger-create-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = event.currentTarget.name.value.trim();
  if (!name) return;
  try {
    await api('/api/ledgers', { method: 'POST', body: JSON.stringify({ name }) });
    event.currentTarget.reset();
    await refreshCurrentView();
    showStatus('已新增帳本');
  } catch (err) {
    showStatus(err.message || '新增失敗', true);
  }
});

// Account create form
// 新增口袋：開關 panel
document.getElementById('pocket-add-btn').addEventListener('click', () => {
  const panel = document.getElementById('pocket-add-panel');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) panel.querySelector('input[name=name]').focus();
});
document.getElementById('pocket-add-cancel').addEventListener('click', () => {
  document.getElementById('pocket-add-panel').hidden = true;
});

document.querySelector('#account-create-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const name = form.name.value.trim();
  if (!name) { showStatus('請輸入口袋名稱', true); return; }
  try {
    await api('/api/accounts', {
      method: 'POST',
      body: JSON.stringify({
        name,
        type: 'other',
        balance: Number(form.balance.value || 0),
        currency: 'TWD',
      }),
    });
    form.reset();
    document.getElementById('pocket-add-panel').hidden = true;
    await loadAccounts();
    showStatus('已新增口袋');
  } catch (err) {
    showStatus(err.message || '新增失敗', true);
  }
});

// Transfer form
document.querySelector('#transfer-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const fromAccountId = Number(form.fromAccountId.value);
  const toAccountId = Number(form.toAccountId.value);
  const amount = Number(form.amount.value);
  if (!fromAccountId || !toAccountId) { showStatus('請選擇轉出和轉入帳戶', true); return; }
  if (fromAccountId === toAccountId) { showStatus('轉出和轉入帳戶不能相同', true); return; }
  if (!amount || amount <= 0) { showStatus('請輸入有效金額', true); return; }
  try {
    await api('/api/accounts/transfer', {
      method: 'POST',
      body: JSON.stringify({ fromAccountId, toAccountId, amount, note: form.note.value.trim() }),
    });
    form.reset();
    await loadAccounts();
    showStatus('轉帳完成');
  } catch (err) {
    showStatus(err.message || '轉帳失敗', true);
  }
});

// Goal create form
document.querySelector('#goal-create-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const name = form.name.value.trim();
  const targetAmount = Number(form.targetAmount.value);
  if (!name) { showStatus('請輸入目標名稱', true); return; }
  if (!targetAmount || targetAmount <= 0) { showStatus('請輸入有效目標金額', true); return; }
  try {
    await api('/api/goals', {
      method: 'POST',
      body: JSON.stringify({ name, targetAmount, deadline: form.deadline.value || null }),
    });
    form.reset();
    await loadGoals();
    showStatus('已新增目標');
  } catch (err) {
    showStatus(err.message || '新增失敗', true);
  }
});

// Recurring create form
document.querySelector('#recurring-create-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const amount = Number(form.amount.value);
  if (!amount || amount <= 0) { showStatus('請輸入有效金額', true); return; }
  try {
    await api('/api/recurring', {
      method: 'POST',
      body: JSON.stringify({
        type: form.type.value,
        ledgerId: Number(form.ledgerId.value),
        category: form.category.value,
        subcategory: form.subcategory.value,
        paymentMethod: form.paymentMethod.value,
        amount,
        dayOfMonth: Number(form.dayOfMonth.value) || 1,
        description: form.description.value.trim(),
      }),
    });
    form.reset();
    await loadRecurring();
    showStatus('已新增定期交易');
  } catch (err) {
    showStatus(err.message || '新增失敗', true);
  }
});

// Reminder create form
document.querySelector('#reminder-create-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const name = form.name.value.trim();
  const dueDay = Number(form.dueDay.value);
  if (!name) { showStatus('請輸入提醒名稱', true); return; }
  if (!dueDay || dueDay < 1 || dueDay > 28) { showStatus('請輸入有效到期日（1-28）', true); return; }
  try {
    await api('/api/reminders', {
      method: 'POST',
      body: JSON.stringify({
        name,
        amount: Number(form.amount.value || 0),
        dueDay,
        note: form.note.value.trim(),
      }),
    });
    form.reset();
    await loadReminders();
    showStatus('已新增提醒');
  } catch (err) {
    showStatus(err.message || '新增失敗', true);
  }
});

// Split create form
document.querySelector('#split-create-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const title = form.title.value.trim();
  const totalAmount = Number(form.totalAmount.value);
  if (!title) { showStatus('請輸入分帳標題', true); return; }
  if (!totalAmount || totalAmount <= 0) { showStatus('請輸入有效總金額', true); return; }
  const participantRows = document.querySelectorAll('#split-participants-rows .participant-row');
  const participants = [];
  for (const row of participantRows) {
    const pname = row.querySelector('input[name="pname"]')?.value.trim();
    const pamount = Number(row.querySelector('input[name="pamount"]')?.value);
    if (pname) participants.push({ name: pname, amount: pamount || 0 });
  }
  try {
    await api('/api/splits', {
      method: 'POST',
      body: JSON.stringify({
        title,
        totalAmount,
        note: form.note.value.trim(),
        participants,
      }),
    });
    form.reset();
    document.querySelector('#split-participants-rows').innerHTML = '';
    await loadSplits();
    showStatus('已建立分帳');
  } catch (err) {
    showStatus(err.message || '新增失敗', true);
  }
});

// Settings create forms
document.querySelectorAll('.setting-create').forEach((form) => {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = form.name.value.trim();
    if (!name) return;
    try {
      if (form.dataset.kind === 'payment') {
        await api('/api/settings/payment', { method: 'POST', body: JSON.stringify({ name }) });
      } else {
        const type = form.dataset.kind.startsWith('income') ? 'income' : 'expense';
        await api('/api/settings/category', { method: 'POST', body: JSON.stringify({ type, name }) });
      }
      form.reset();
      await loadSettings();
      showStatus('已新增設定');
    } catch (err) {
      showStatus(err.message || '新增失敗', true);
    }
  });
});

// Subcategory create forms + utility forms (delegated)
document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;

  if (form.dataset.addReading) {
    event.preventDefault();
    const meterId = form.dataset.addReading;
    const data = Object.fromEntries(new FormData(form));
    try {
      await apiFetch(`/api/utility/meters/${meterId}/readings`, { method: 'POST', body: JSON.stringify(data) });
      loadUtility();
    } catch (err) { alert('新增失敗：' + err.message); }
    return;
  }
  if (form.dataset.saveMeter) {
    event.preventDefault();
    const meterId = form.dataset.saveMeter;
    const data = Object.fromEntries(new FormData(form));
    try {
      await apiFetch(`/api/utility/meters/${meterId}`, { method: 'PATCH', body: JSON.stringify(data) });
      loadUtility();
    } catch (err) { alert('儲存失敗：' + err.message); }
    return;
  }

  if (!form.classList.contains('subcategory-create')) return;
  event.preventDefault();
  const name = form.name.value.trim();
  if (!name) return;
  try {
    await api('/api/settings/subcategory', {
      method: 'POST',
      body: JSON.stringify({ type: form.dataset.type, categoryName: form.dataset.category, name }),
    });
    form.reset();
    await loadSettings();
    showStatus('已新增子類別');
  } catch (err) {
    showStatus(err.message || '新增失敗', true);
  }
});

// Budget month navigation
document.querySelector('#budget-prev-month').addEventListener('click', async () => {
  state.budgetMonth--;
  if (state.budgetMonth === 0) { state.budgetMonth = 12; state.budgetYear--; }
  await loadBudgets();
});

document.querySelector('#budget-next-month').addEventListener('click', async () => {
  state.budgetMonth++;
  if (state.budgetMonth === 13) { state.budgetMonth = 1; state.budgetYear++; }
  await loadBudgets();
});

// Budget add form
document.querySelector('#budget-add-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const category = form.category.value;
  const amount = Number(form.amount.value);
  if (!category) { showStatus('請選擇類別', true); return; }
  if (!amount || amount <= 0) { showStatus('請輸入有效金額', true); return; }
  try {
    await api('/api/budgets', {
      method: 'POST',
      body: JSON.stringify({ category, amount, year: state.budgetYear, month: state.budgetMonth }),
    });
    form.reset();
    await loadBudgets();
    showStatus('預算已設定');
  } catch (err) {
    showStatus(err.message || '設定失敗', true);
  }
});

// Trend months select
document.querySelector('#trend-months').addEventListener('change', async () => {
  try { await loadReports(); } catch (err) { showStatus(err.message || '載入失敗', true); }
});

// ── Init ──────────────────────────────────────────────────────────────────
(async function init() {
  await checkAuth();

  applyTheme(localStorage.getItem('theme') === 'dark');

  const filter = document.querySelector('#transaction-filter');
  filter.start.value = toDateInput(monthStart);
  filter.end.value = toDateInput(today);
  updateBudgetMonthLabel();

  // Annual report year navigation
  document.getElementById('annual-prev-year')?.addEventListener('click', () => { annualState.year--; loadAnnualReport(); });
  document.getElementById('annual-next-year')?.addEventListener('click', () => { annualState.year++; loadAnnualReport(); });

  // Receipt upload
  document.getElementById('receipt-upload-btn')?.addEventListener('click', () => { document.getElementById('modal-receipt-file')?.click(); });
  document.getElementById('modal-receipt-file')?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try { showReceiptPreview(await compressImageToBase64(file)); }
    catch { showStatus('圖片處理失敗', true); }
  });
  document.getElementById('receipt-remove-btn')?.addEventListener('click', clearReceiptPreview);

  // Search events
  document.getElementById('search-btn')?.addEventListener('click', openSearch);
  document.getElementById('search-close')?.addEventListener('click', closeSearch);
  document.getElementById('search-input')?.addEventListener('input', e => {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => runSearch(e.target.value), 280);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeSearch();
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') { e.preventDefault(); openSearch(); }
  });

  // Calendar navigation
  document.getElementById('cal-prev')?.addEventListener('click', () => {
    calState.month--;
    if (calState.month < 1) { calState.month = 12; calState.year--; }
    loadCalendar();
  });
  document.getElementById('cal-next')?.addEventListener('click', () => {
    calState.month++;
    if (calState.month > 12) { calState.month = 1; calState.year++; }
    loadCalendar();
  });
  document.getElementById('calendar-grid')?.addEventListener('click', e => {
    const cell = e.target.closest('[data-cal-date]');
    if (cell) showCalDayDetail(cell.dataset.calDate, _calDayMap.get(cell.dataset.calDate));
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  if (Notification.permission === 'granted') {
    scheduleNotifications();
  }

  try {
    await loadContext();
    await loadLedgers();
    await Promise.all([loadDashboard(), loadSettings()]);
  } catch (err) {
    showStatus(err.message || '載入失敗', true);
  }
})();
