function getToken() { return localStorage.getItem('token'); }
function getUser() { return JSON.parse(localStorage.getItem('user') || '{}'); }
function logout() { localStorage.clear(); window.location.href = '/login.html'; }

async function api(path, options = {}) {
  const token = getToken();
  if (!token) { window.location.href = '/login.html'; return null; }
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...options.headers };
  const res = await fetch(path, { ...options, headers });
  if (res.status === 401) { logout(); return null; }
  return res;
}

let allEntries = [];
let allAllocations = [];
let currentUser = {};
let myPermissions = {};

document.addEventListener('DOMContentLoaded', async () => {
  const token = getToken();
  if (!token) { window.location.href = '/login.html'; return; }
  currentUser = getUser();

  const nameEl = document.getElementById('userNameDisplay');
  if (nameEl) nameEl.textContent = currentUser.name || currentUser.username;

  const addByName = document.getElementById('moneyAddByName');
  if (addByName) addByName.textContent = currentUser.name || currentUser.username;

  document.getElementById('date').value = new Date().toISOString().split('T')[0];

  const meRes = await api('/api/permissions/me');
  if (meRes) myPermissions = await meRes.json() || {};

  if (currentUser.role === 'admin') {
    const link = document.getElementById('adminLink');
    if (link) link.classList.remove('hidden');
  }

  setupTabs();
  setupEventListeners();
  await loadDashboard();
});

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.remove('text-emerald-300', 'border-emerald-400');
        b.classList.add('text-slate-400', 'border-transparent');
      });
      btn.classList.remove('text-slate-400', 'border-transparent');
      btn.classList.add('text-emerald-300', 'border-emerald-400');

      document.querySelectorAll('.tab-content').forEach(tc => tc.classList.add('hidden'));
      const tab = document.getElementById('tab-' + btn.dataset.tab);
      if (tab) tab.classList.remove('hidden');

      if (btn.dataset.tab === 'entries') loadAllEntries();
      if (btn.dataset.tab === 'allocations') loadAllocationsTab();
    });
  });
}

async function loadDashboard() {
  const res = await api('/api/stats');
  if (!res) return;
  const stats = await res.json();

  document.getElementById('totalMoney').textContent = '₹' + stats.totalMoney.toLocaleString();
  document.getElementById('entryCount').textContent = stats.entryCount;
  document.getElementById('ideaCount').textContent = stats.ideaCount;
  document.getElementById('userCount').textContent = stats.userCount;

  const slices = drawPieChart('pieChart', stats.allocations, stats.totalMoney, 'chartTotal');
  if (slices) renderChartLegend('chartLegend', slices);

  allAllocations = stats.allocations;
  await loadRecentEntries();
  await loadIdeas();
}

async function loadRecentEntries() {
  const res = await api('/api/money');
  if (!res) return;
  allEntries = await res.json();
  const container = document.getElementById('recentEntries');
  if (!container) return;

  if (allEntries.length === 0) {
    container.innerHTML = '<div class="text-center text-slate-600 py-6 text-sm">No entries yet.</div>';
    return;
  }

  const isAdmin = currentUser.role === 'admin';
  container.innerHTML = allEntries.slice(0, 10).map(e => {
    const d = new Date(e.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    return `
      <div class="entry-card flex items-center justify-between bg-white/[0.03] rounded-xl px-4 py-3 border border-white/5 fade-in">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-emerald-400 font-semibold">₹${Number(e.amount).toLocaleString()}</span>
            <span class="text-xs text-slate-500">•</span>
            <span class="text-sm text-slate-300">${e.addedBy}</span>
          </div>
          <div class="flex items-center gap-2 mt-0.5">
            <span class="text-xs text-slate-600">${d}</span>
            ${e.note ? `<span class="text-xs text-slate-500">• ${e.note}</span>` : ''}
          </div>
        </div>
        ${isAdmin ? `<button onclick="deleteEntry('${e._id}')" class="text-[11px] text-rose-400/50 hover:text-rose-400 transition-colors shrink-0 ml-2">Delete</button>` : ''}
      </div>
    `;
  }).join('');
}

async function loadIdeas() {
  const res = await api('/api/ideas');
  if (!res) return;
  const ideas = await res.json();
  const container = document.getElementById('ideasList');
  if (!container) return;
  if (ideas.length === 0) {
    container.innerHTML = '<div class="text-center text-slate-600 py-6 text-sm">No ideas yet.</div>';
    return;
  }
  container.innerHTML = ideas.slice(0, 5).map(idea => `
    <div class="idea-card bg-white/[0.03] rounded-xl px-4 py-2.5 border border-white/5 fade-in">
      <div class="flex items-start justify-between gap-2">
        <p class="text-sm font-medium text-white">${idea.title}</p>
        <p class="text-[10px] text-blue-400 shrink-0">${idea.proposedBy}</p>
      </div>
    </div>
  `).join('');
}

async function loadAllEntries() {
  if (allEntries.length === 0) {
    const res = await api('/api/money');
    if (res) allEntries = await res.json();
  }
  const tbody = document.getElementById('entriesTableBody');
  const totalEl = document.getElementById('entriesTotal');
  if (!tbody) return;

  const filter = document.getElementById('entryFilter')?.value || 'all';
  const search = (document.getElementById('entrySearch')?.value || '').toLowerCase();

  let filtered = allEntries;
  if (filter !== 'all') filtered = filtered.filter(e => e.addedBy === filter);
  if (search) filtered = filtered.filter(e => e.addedBy.toLowerCase().includes(search) || (e.note || '').toLowerCase().includes(search));

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-slate-600 py-8 text-sm">No entries found.</td></tr>';
    if (totalEl) totalEl.textContent = '';
    return;
  }

  const isAdmin = currentUser.role === 'admin';
  const total = filtered.reduce((s, e) => s + Number(e.amount), 0);
  tbody.innerHTML = filtered.map((e, i) => {
    const d = new Date(e.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    return `
      <tr class="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
        <td class="py-3 px-2 text-slate-500 text-xs">${i + 1}</td>
        <td class="py-3 px-2 text-emerald-400 font-medium">₹${Number(e.amount).toLocaleString()}</td>
        <td class="py-3 px-2 text-slate-300">${e.addedBy}</td>
        <td class="py-3 px-2 text-slate-400 text-xs">${d}</td>
        <td class="py-3 px-2 text-slate-500 text-xs hidden md:table-cell">${e.note || '—'}</td>
        <td class="py-3 px-2 text-right">${isAdmin ? `<button onclick="deleteEntry('${e._id}')" class="text-[11px] text-rose-400/60 hover:text-rose-400 transition-colors">Delete</button>` : ''}</td>
      </tr>
    `;
  }).join('');
  if (totalEl) totalEl.textContent = `Total: ₹${total.toLocaleString()} (${filtered.length} entries)`;

  updateEntryFilter();
}

function updateEntryFilter() {
  const sel = document.getElementById('entryFilter');
  if (!sel) return;
  const unique = [...new Set(allEntries.map(e => e.addedBy))];
  const current = sel.value;
  sel.innerHTML = '<option value="all" class="bg-slate-800">All People</option>' +
    unique.map(u => `<option value="${u}" class="bg-slate-800">${u}</option>`).join('');
  sel.value = current;
}

async function loadAllocationsTab() {
  const res = await api('/api/stats');
  if (!res) return;
  const stats = await res.json();
  allAllocations = stats.allocations;

  const slices = drawPieChart('allocPieChart', stats.allocations, stats.totalMoney, 'allocChartTotal');
  if (slices) renderChartLegend('allocChartLegend', slices);
  drawBarChart('barChartContainer', stats.allocations, stats.totalMoney);
}

function setupEventListeners() {
  const moneyForm = document.getElementById('moneyForm');
  if (moneyForm) {
    moneyForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const amount = document.getElementById('amount').value;
      const date = document.getElementById('date').value;
      const note = document.getElementById('note').value.trim();

      const res = await api('/api/money', {
        method: 'POST',
        body: JSON.stringify({ amount, date, note }),
      });
      if (!res) return;
      const data = await res.json();
      if (data.success) {
        const successEl = document.getElementById('moneySuccess');
        if (successEl) {
          successEl.textContent = 'Entry added!';
          successEl.classList.remove('hidden');
          setTimeout(() => successEl.classList.add('hidden'), 3000);
        }
        moneyForm.reset();
        document.getElementById('date').value = new Date().toISOString().split('T')[0];
        allEntries = [];
        loadDashboard();
      }
    });
  }

  const ideaForm = document.getElementById('ideaForm');
  if (ideaForm) {
    ideaForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('ideaTitle').value.trim();
      const res = await api('/api/ideas', { method: 'POST', body: JSON.stringify({ title }) });
      if (!res) return;
      const data = await res.json();
      if (data.success) {
        document.getElementById('ideaTitle').value = '';
        loadIdeas();
      }
    });
  }

  const searchEl = document.getElementById('entrySearch');
  const filterEl = document.getElementById('entryFilter');
  if (searchEl) searchEl.addEventListener('input', loadAllEntries);
  if (filterEl) filterEl.addEventListener('change', loadAllEntries);
}

async function deleteEntry(id) {
  if (!confirm('Delete this entry?')) return;
  const res = await api(`/api/money/${id}`, { method: 'DELETE' });
  if (!res) return;
  const data = await res.json();
  if (data.success) {
    allEntries = [];
    loadAllEntries();
    loadDashboard();
  }
}
