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

const chartColors = ['#146c94', '#0f7b45', '#f59e0b', '#7c3aed', '#dc2626', '#0891b2', '#64748b'];

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

// ── Dashboard ─────────────────────────────────────────────────────────────
async function loadDashboard() {
  const dashboard = await api('/api/dashboard');
  document.querySelector('#metric-income').textContent = formatMoney(dashboard.totalIncome);
  document.querySelector('#metric-expense').textContent = formatMoney(dashboard.totalExpense);
  document.querySelector('#metric-balance').textContent = formatMoney(dashboard.balance);
  document.querySelector('#metric-count').textContent = dashboard.transactionCount || 0;
  renderIncomeExpenseChart(dashboard);
  renderExpenseCategoryChart(dashboard.expenseCategories || []);
  renderLedgerExpenseChart(dashboard.ledgerStats || []);
  renderDashboardAlerts(dashboard.alerts);
  loadInsights();
  document.querySelector('#dashboard-ledgers').innerHTML =
    state.ledgers
      .map(
        (ledger) => `
          <div class="row">
            <div class="row-main">
              <div class="row-title">${escapeHtml(ledger.name)}</div>
              <div class="row-meta">ledgerId: ${ledger.ledgerId}</div>
            </div>
          </div>`
      )
      .join('') || '<div class="row">尚無帳本</div>';
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
      ? `conic-gradient(#0f7b45 0deg ${incomeDeg}deg, #b42318 ${incomeDeg}deg ${incomeDeg + expenseDeg}deg)`
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
        <div class="legend-item"><span class="swatch" style="background:#0f7b45"></span><span>進帳</span><strong>${formatMoney(income)}</strong></div>
        <div class="legend-item"><span class="swatch" style="background:#b42318"></span><span>支出</span><strong>${formatMoney(expense)}</strong></div>
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
  const maxExpense = Math.max(...ledgerStats.map((item) => Number(item.totalExpense || 0)), 0);
  document.querySelector('#ledger-expense-chart').innerHTML =
    ledgerStats
      .map((item) => {
        const percent = maxExpense > 0 ? (Number(item.totalExpense || 0) / maxExpense) * 100 : 0;
        return `
          <div class="bar-row">
            <div class="bar-label" title="${escapeAttr(item.name)}">${escapeHtml(item.name)}</div>
            <div class="bar-track"><div class="bar-fill" style="width:${percent}%"></div></div>
            <div class="bar-value">${formatMoney(item.totalExpense)}</div>
          </div>`;
      })
      .join('') || '<div class="row">尚無帳本資料</div>';
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
        <div class="row-meta">ledgerId: ${ledger.ledgerId}</div>
      </div>
      <div class="actions">
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

function renderTransactionRow(t) {
  const tags = t.tags ? t.tags.split(',').filter(Boolean) : [];
  const tagsHtml = tags.map((tag) => `<span class="tag" style="padding:2px 6px;font-size:11px;">${escapeHtml(tag.trim())}</span>`).join('');
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
      <td>${escapeHtml(t.description || '')}</td>
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

async function loadAccounts() {
  try {
    const data = await api('/api/accounts');
    renderAccounts(data);
  } catch (err) {
    document.querySelector('#accounts-list').innerHTML = '<div class="row">尚無帳戶資料</div>';
  }
}

function renderAccounts(data) {
  const accounts = data.accounts || [];
  document.querySelector('#account-total-assets').textContent = formatMoney(data.totalAssets);
  document.querySelector('#account-total-liabilities').textContent = formatMoney(data.totalLiabilities);
  document.querySelector('#account-net-worth').textContent = formatMoney(data.netWorth);
  document.querySelector('#account-count').textContent = accounts.length;
  document.querySelector('#accounts-list').innerHTML =
    accounts.map(renderAccount).join('') || '<div class="row">尚無帳戶</div>';

  const fromSel = document.querySelector('#transfer-from');
  const toSel = document.querySelector('#transfer-to');
  const opts =
    '<option value="">選擇帳戶</option>' +
    accounts.map((a) => `<option value="${a.accountId}">${escapeHtml(a.name)}</option>`).join('');
  fromSel.innerHTML = opts;
  toSel.innerHTML = opts;
}

function renderAccount(a) {
  const typeLabel = accountTypeLabels[a.type] || a.type;
  return `
    <div class="row">
      <div class="row-main">
        <div class="row-title">${escapeHtml(a.name)}<span class="account-badge">${escapeHtml(typeLabel)}</span></div>
        <div class="row-meta">${formatMoney(a.balance)} ${escapeHtml(a.currency || 'TWD')}</div>
      </div>
      <div class="actions">
        <button class="secondary" data-account-edit="${a.accountId}">改名</button>
        <button class="danger" data-account-delete="${a.accountId}">刪除</button>
      </div>
    </div>`;
}

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
async function loadReports() {
  const months = Number(document.querySelector('#trend-months')?.value || 6);
  const [trendData, categoryTrendData] = await Promise.allSettled([
    api(`/api/reports/trend?months=${months}`),
    api(`/api/reports/category-trend?months=${months}`),
  ]);
  if (trendData.status === 'fulfilled') {
    renderReportsMetrics(trendData.value);
    renderTrendChart(trendData.value);
  }
  if (categoryTrendData.status === 'fulfilled') {
    renderCategoryTrend(categoryTrendData.value);
  }
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

// ════════════════════════════════════════════════════════
//  UTILITY METER TRACKING
// ════════════════════════════════════════════════════════

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
    // Render usage charts
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
          <th>抄錶日期</th>
          <th>錶度數</th>
          <th>用量 (${m.unit})</th>
          <th>費用 (TWD)</th>
          <th>備註</th>
          <th></th>
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
          </tr>
        `).join('')}
      </tbody>
    </table>
  ` : '<div class="empty-state" style="font-size:13px">尚無抄錶記錄</div>';

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

      <!-- Usage trend chart -->
      <canvas id="chart-meter-${m.meterId}" class="utility-chart" height="80"></canvas>

      <!-- Add reading form -->
      <div id="reading-form-${m.meterId}" class="reading-form" hidden>
        <form data-add-reading="${m.meterId}" class="form-row" style="align-items:flex-end;gap:8px">
          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">
            抄錶日期
            <input type="date" name="readDate" value="${new Date().toISOString().slice(0,10)}" required style="width:140px" />
          </label>
          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">
            錶度數 (${m.unit})
            <input type="number" name="reading" placeholder="${latestVal !== '—' ? '上次：' + latestVal : '首次抄錶'}" step="0.01" min="0" required style="width:120px" />
          </label>
          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">
            備註
            <input type="text" name="note" placeholder="選填" style="width:120px" />
          </label>
          <button type="submit" class="primary small">記錄</button>
          <button type="button" class="secondary small" data-hide-reading-form="${m.meterId}">取消</button>
        </form>
      </div>

      <div class="meter-card-footer">
        <button class="secondary" data-show-reading-form="${m.meterId}">+ 新增抄錶</button>
      </div>

      <!-- Readings history -->
      <details class="readings-history">
        <summary>抄錶記錄（${m.readings.length} 筆）</summary>
        ${readingsHtml}
      </details>
    </div>
  `;
}

function renderUsageChart(m) {
  const canvas = document.getElementById(`chart-meter-${m.meterId}`);
  if (!canvas) return;
  const readings = [...m.readings].reverse(); // oldest first
  if (readings.length < 2) {
    canvas.hidden = true;
    return;
  }
  canvas.hidden = false;
  const usages = readings.slice(1).map((r, i) => ({
    label: r.readDate,
    usage: parseFloat((r.reading - readings[i].reading).toFixed(4)),
    cost: parseFloat(((r.reading - readings[i].reading) * m.ratePerUnit + m.baseCharge).toFixed(2))
  }));
  if (!usages.length) { canvas.hidden = true; return; }

  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth || 600;
  const H = 80;
  canvas.width = W;
  canvas.height = H;

  const maxUsage = Math.max(...usages.map(u => u.usage), 1);
  const barW = Math.max(20, (W - 40) / usages.length - 6);
  const padding = { left: 10, right: 10, top: 10, bottom: 20 };
  const chartW = W - padding.left - padding.right;
  const chartH = H - padding.top - padding.bottom;

  ctx.clearRect(0, 0, W, H);

  const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#38bdf8';

  usages.forEach((u, i) => {
    const x = padding.left + (i / usages.length) * chartW;
    const barHeight = (u.usage / maxUsage) * chartH;
    const y = padding.top + chartH - barHeight;

    ctx.fillStyle = accentColor + '99';
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barHeight, 3);
    ctx.fill();

    // Label
    ctx.fillStyle = accentColor;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(u.usage.toString(), x + barW / 2, y - 2);

    // Date label
    ctx.fillStyle = '#888';
    ctx.font = '9px sans-serif';
    const shortDate = u.label.slice(5); // MM-DD
    ctx.fillText(shortDate, x + barW / 2, H - 2);
  });
}

// Edit meter inline
function openMeterEdit(meterId, meter) {
  const card = document.getElementById(`meter-card-${meterId}`);
  if (!card) return;
  const header = card.querySelector('.meter-card-header');
  const existingEdit = card.querySelector('.meter-edit-form');
  if (existingEdit) { existingEdit.remove(); return; }
  const editDiv = document.createElement('div');
  editDiv.className = 'meter-edit-form form-card';
  editDiv.style.marginTop = '12px';
  editDiv.innerHTML = `
    <form data-save-meter="${meterId}" class="form-row" style="flex-wrap:wrap;gap:8px;align-items:flex-end">
      <input type="text" name="name" value="${meter.name}" placeholder="名稱" required style="width:120px" />
      <select name="type">
        ${['electricity','water','gas','other'].map(t => `<option value="${t}" ${meter.type===t?'selected':''}>${METER_TYPE_LABEL[t]||t}</option>`).join('')}
      </select>
      <input type="text" name="unit" value="${meter.unit}" placeholder="單位" style="width:60px" />
      <input type="number" name="ratePerUnit" value="${meter.ratePerUnit}" step="0.01" min="0" style="width:80px" placeholder="費率" />
      <input type="number" name="baseCharge" value="${meter.baseCharge}" step="0.01" min="0" style="width:80px" placeholder="基本費" />
      <input type="text" name="note" value="${meter.note||''}" placeholder="備註" style="width:120px" />
      <button type="submit" class="primary small">儲存</button>
      <button type="button" class="secondary small" data-cancel-meter-edit="${meterId}">取消</button>
    </form>
  `;
  card.insertBefore(editDiv, header.nextSibling);
}

// To-transaction modal
function showReadingToTxModal(readingId, meterId) {
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
        <div class="form-row" style="flex-direction:column;gap:8px">
          <label style="font-size:13px">選擇帳本</label>
          <select name="ledgerId" id="reading-tx-ledger" style="width:100%">
            ${(state.ledgers||[]).map(l => `<option value="${l.ledgerId}">${l.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-row" style="flex-direction:column;gap:8px;margin-top:10px">
          <label style="font-size:13px">付款方式</label>
          <select name="paymentMethod" style="width:100%">
            ${(state.settings?.paymentMethods||[]).map(m => `<option value="${m.name}">${m.name}</option>`).join('')}
            <option value="轉帳">轉帳</option>
            <option value="現金">現金</option>
          </select>
        </div>
        <div class="form-row" style="margin-top:16px;gap:8px">
          <button type="submit" class="primary" style="flex:1">記入帳本</button>
          <button type="button" id="reading-tx-cancel" class="secondary">取消</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById('reading-tx-cancel')?.addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.getElementById('reading-tx-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const ledgerId = fd.get('ledgerId');
    const paymentMethod = fd.get('paymentMethod');
    try {
      const resp = await apiFetch(`/api/utility/readings/${readingId}/to-transaction`, {
        method: 'POST',
        body: JSON.stringify({ ledgerId, paymentMethod })
      });
      const data = await resp.json();
      modal.remove();
      alert(`✓ 已記入帳本！\n費用：NT$ ${data.cost}\n用量：${data.usage}\n${data.description}`);
    } catch (err) {
      alert('記帳失敗：' + err.message);
    }
  });
}

// Meter create form submit
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
  };
  document.querySelector('#page-title').textContent = titles[view] || view;

  // Initialize recurring form when navigating to it
  if (view === 'recurring') initRecurringForm();
  // Load templates when navigating to transactions
  if (view === 'transactions') {
    loadTemplates();
    initTemplateForm();
  }
  // Load utility meters when navigating to utility
  if (view === 'utility') loadUtility();
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
}

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
    if (target.id === 'add-tx-fab') {
      openTxModal();
      return;
    } else if (target.id === 'tx-modal-cancel') {
      closeTxModal();
      return;
    } else if (target.id === 'export-csv-btn') {
      exportCsv();
      return;
    } else if (target.id === 'print-report-btn') {
      window.print();
      return;
    } else if (target.id === 'add-participant-btn') {
      const row = document.createElement('div');
      row.className = 'participant-row';
      row.innerHTML = `<input name="pname" placeholder="名稱" /><input type="number" name="pamount" placeholder="金額" min="0" step="0.01" /><button type="button" class="danger participant-remove">✕</button>`;
      document.querySelector('#split-participants-rows').appendChild(row);
      return;
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
      const name = prompt('新的帳戶名稱');
      if (name) {
        await api(`/api/accounts/${target.dataset.accountEdit}`, { method: 'PATCH', body: JSON.stringify({ name }) });
        await loadAccounts();
      }
    } else if (target.dataset.accountDelete) {
      if (confirm('確定要刪除此帳戶？')) {
        await api(`/api/accounts/${target.dataset.accountDelete}`, { method: 'DELETE' });
        await loadAccounts();
      }
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
      const id = target.dataset.showReadingForm;
      const form = document.getElementById(`reading-form-${id}`);
      if (form) form.hidden = false;
      return;
    } else if (target.dataset.hideReadingForm) {
      const id = target.dataset.hideReadingForm;
      const form = document.getElementById(`reading-form-${id}`);
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
      const card = document.getElementById(`meter-card-${target.dataset.cancelMeterEdit}`);
      card?.querySelector('.meter-edit-form')?.remove();
      return;
    } else if (target.dataset.readingDelete) {
      if (!confirm('確定刪除此抄錶記錄？')) return;
      await apiFetch(`/api/utility/readings/${target.dataset.readingDelete}`, { method: 'DELETE' });
      loadUtility();
      return;
    } else if (target.dataset.readingToTx) {
      showReadingToTxModal(target.dataset.readingToTx, target.dataset.meterId);
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
    await api('/api/transactions', {
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
document.querySelector('#account-create-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const name = form.name.value.trim();
  if (!name) { showStatus('請輸入帳戶名稱', true); return; }
  try {
    await api('/api/accounts', {
      method: 'POST',
      body: JSON.stringify({
        name,
        type: form.type.value,
        balance: Number(form.balance.value || 0),
        currency: form.currency.value,
      }),
    });
    form.reset();
    await loadAccounts();
    showStatus('已新增帳戶');
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

// Subcategory create forms (delegated)
document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;

  // Add meter reading (delegated)
  if (form.dataset.addReading) {
    event.preventDefault();
    const meterId = form.dataset.addReading;
    const data = Object.fromEntries(new FormData(form));
    try {
      await apiFetch(`/api/utility/meters/${meterId}/readings`, {
        method: 'POST', body: JSON.stringify(data)
      });
      loadUtility();
    } catch (err) { alert('新增失敗：' + err.message); }
    return;
  }

  // Save meter edits (delegated)
  if (form.dataset.saveMeter) {
    event.preventDefault();
    const meterId = form.dataset.saveMeter;
    const data = Object.fromEntries(new FormData(form));
    try {
      await apiFetch(`/api/utility/meters/${meterId}`, {
        method: 'PATCH', body: JSON.stringify(data)
      });
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
