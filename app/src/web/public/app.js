const state = {
  userId: null,
  ledgers: [],
  archivedLedgers: [],
  settings: null,
  currentView: 'dashboard',
};

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
  setTimeout(() => {
    status.hidden = true;
  }, 3500);
}

async function loadContext() {
  const context = await api('/api/context');
  state.userId = context.userId;
  document.querySelector('#user-label').textContent = `userId: ${context.userId}`;
}

async function loadLedgers() {
  const [ledgers, archivedLedgers] = await Promise.all([
    api('/api/ledgers'),
    api('/api/ledgers/archived'),
  ]);
  state.ledgers = ledgers;
  state.archivedLedgers = archivedLedgers;
  renderLedgerSelect();
  renderLedgers();
}

async function loadDashboard() {
  const dashboard = await api('/api/dashboard');
  document.querySelector('#metric-income').textContent = formatMoney(dashboard.totalIncome);
  document.querySelector('#metric-expense').textContent = formatMoney(dashboard.totalExpense);
  document.querySelector('#metric-balance').textContent = formatMoney(dashboard.balance);
  document.querySelector('#metric-count').textContent = dashboard.transactionCount || 0;
  renderIncomeExpenseChart(dashboard);
  renderExpenseCategoryChart(dashboard.expenseCategories || []);
  renderLedgerExpenseChart(dashboard.ledgerStats || []);
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

function renderLedgerSelect() {
  const select = document.querySelector('#transaction-filter select[name="ledgerId"]');
  select.innerHTML = state.ledgers
    .map((ledger) => `<option value="${ledger.ledgerId}">${escapeHtml(ledger.name)}</option>`)
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

async function loadTransactions(event) {
  if (event) event.preventDefault();
  const form = document.querySelector('#transaction-filter');
  const ledgerId = form.ledgerId.value;
  const start = form.start.value;
  const end = form.end.value;
  if (!ledgerId || !start || !end) return;

  const data = await api(`/api/transactions&ledgerId=${ledgerId}&start=${start}&end=${end}`.replace('&', '?'));
  const stats = data.stats || {};
  document.querySelector('#transaction-summary').textContent =
    `進帳 ${formatMoney(stats.totalIncome)} / 支出 ${formatMoney(stats.totalExpense)} / 結餘 ${formatMoney((stats.totalIncome || 0) - (stats.totalExpense || 0))} / 筆數 ${stats.transactionCount || 0}`;
  document.querySelector('#transactions-table').innerHTML =
    data.transactions.map(renderTransactionRow).join('') ||
    '<tr><td colspan="7">這個區間沒有交易</td></tr>';
}

function renderTransactionRow(transaction) {
  return `
    <tr>
      <td>${escapeHtml(String(transaction.createdAt || ''))}</td>
      <td>${transaction.type === 'income' ? '進帳' : '支出'}</td>
      <td>${formatMoney(transaction.amount)}</td>
      <td>${escapeHtml(transaction.category)} / ${escapeHtml(transaction.subcategory)}</td>
      <td>${escapeHtml(transaction.paymentMethod)}</td>
      <td>${escapeHtml(transaction.description || '')}</td>
      <td>
        <div class="actions">
          <button class="secondary" data-tx-amount="${transaction.transactionId}">金額</button>
          <button class="secondary" data-tx-note="${transaction.transactionId}">備註</button>
          <button class="danger" data-tx-delete="${transaction.transactionId}">刪除</button>
        </div>
      </td>
    </tr>`;
}

async function loadSettings() {
  state.settings = await api('/api/settings');
  renderSettings();
}

function renderSettings() {
  renderPaymentSettings();
  renderCategorySettings('expense', state.settings.expenseCategories, '#expense-settings');
  renderCategorySettings('income', state.settings.incomeCategories, '#income-settings');
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

function setView(view) {
  state.currentView = view;
  document.querySelectorAll('.nav-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });
  document.querySelectorAll('.view').forEach((section) => {
    section.classList.toggle('active', section.id === `${view}-view`);
  });
  const titles = { dashboard: '總覽', ledgers: '帳本', transactions: '交易', settings: '設定' };
  document.querySelector('#page-title').textContent = titles[view];
}

async function refreshCurrentView() {
  await loadLedgers();
  if (state.currentView === 'dashboard') await loadDashboard();
  if (state.currentView === 'settings') await loadSettings();
  if (state.currentView === 'transactions') await loadTransactions();
}

function escapeHtml(value) {
  return String(value)
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

document.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const nav = target.closest('.nav-button');
  if (nav) {
    setView(nav.dataset.view);
    await refreshCurrentView();
    return;
  }

  try {
    if (target.dataset.ledgerRename) {
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
    } else if (target.dataset.txDelete) {
      if (confirm('確定要刪除這筆交易？')) {
        await api(`/api/transactions/${target.dataset.txDelete}`, { method: 'DELETE' });
        await loadTransactions();
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
    }
    showStatus('已更新');
  } catch (err) {
    showStatus(err.message || '操作失敗', true);
  }
});

document.querySelector('#refresh-button').addEventListener('click', refreshCurrentView);
document.querySelector('#transaction-filter').addEventListener('submit', loadTransactions);

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

document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.classList.contains('subcategory-create')) return;
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

(async function init() {
  const filter = document.querySelector('#transaction-filter');
  filter.start.value = toDateInput(monthStart);
  filter.end.value = toDateInput(today);
  try {
    await loadContext();
    await loadLedgers();
    await Promise.all([loadDashboard(), loadSettings()]);
  } catch (err) {
    showStatus(err.message || '載入失敗', true);
  }
})();
