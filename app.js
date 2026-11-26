// app.js
let currentUser = null;
let allAssets = [];
let currentFilteredAssets = [];
let currentFilteredTickets = [];
let allUsers = [];
let allSchools = [];
let usersMap = {};
let parsedBulkRows = [];
let lastBulkUploadedAssets = [];
let selectedAssetIds = new Set();
let html5QrScanner = null;
let activeEventId = null;
let activeEventObj = null;
let activeEventLogs = [];
let categoryChartInstance = null;
let statusChartInstance = null;

// 1. INITIALIZATION & AUTH
window.addEventListener('DOMContentLoaded', async () => {
  initSignaturePad();
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) await loadUserProfile(session.user.id);
  } catch (err) {
    console.error('Session check error:', err);
  }
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  const btn = e.target.querySelector('button[type="submit"]');

  errEl.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = 'Signing in...';

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      errEl.textContent = 'Login අසාර්ථකයි: ' + error.message;
      errEl.classList.remove('hidden');
    } else if (data?.user) {
      await loadUserProfile(data.user.id);
    }
  } catch (err) {
    errEl.textContent = 'දෝෂයක් ඇති විය: ' + err.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
});

async function loadUserProfile(uid) {
  const { data, error } = await supabaseClient.from('users').select('*').eq('user_id', uid).single();
  if (error || !data) return alert('User profile සොයාගත නොහැක. Admin අමතන්න.');
  currentUser = data;

  document.getElementById('login-section').classList.add('hidden');
  document.getElementById('app-section').classList.remove('hidden');
  document.getElementById('user-badge').textContent = `${data.full_name} (${data.role})`;

  if (data.role === 'Admin') {
    document.getElementById('nav-schools').classList.remove('hidden');
    document.getElementById('nav-users').classList.remove('hidden');
    document.getElementById('nav-approvals').classList.remove('hidden');
    document.getElementById('btn-toggle-event-form').classList.remove('hidden');
    document.getElementById('ws-assign-bar').classList.remove('hidden');
  } else {
    document.getElementById('my-requests-box').classList.remove('hidden');
  }

  if (['Admin', 'Tech_Team'].includes(data.role)) {
    document.getElementById('nav-events').classList.remove('hidden');
  }

  document.getElementById('prof-name').value = data.full_name || '';
  document.getElementById('prof-workplace').value = data.workplace || '';
  if (data.signature_url) {
    document.getElementById('saved-sig-img').src = data.signature_url;
    document.getElementById('saved-sig-preview').classList.remove('hidden');
  }

  renderSpecFields('asset-category', 'dynamic-specs');
  await loadUsers();
  await loadSchools();
  await loadAssets();
  await loadTickets();
  await loadChangeRequests();
  if (['Admin', 'Tech_Team'].includes(data.role)) await loadEvents();
  showTab('dashboard');
}

async function logout() {
  await supabaseClient.auth.signOut();
  location.reload();
}

function showTab(tabId) {
  if (tabId !== 'scanner') stopScanner();
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.getElementById(`tab-${tabId}`).classList.remove('hidden');
}

// 2. USERS MANAGEMENT
async function loadUsers() {
  const { data } = await supabaseClient.from('users').select('*, schools(school_name)').order('full_name');
  allUsers = data || [];
  usersMap = {};
  allUsers.forEach(u => usersMap[u.user_id] = u);

  const tbody = document.getElementById('users-table-body');
  if (tbody) {
    tbody.innerHTML = allUsers.map(u => `
      <tr>
        <td class="p-2 font-medium">${u.full_name}</td>
        <td class="p-2">${u.email}</td>
        <td class="p-2"><span class="px-2 py-0.5 rounded text-xs bg-slate-200">${u.role}</span></td>
        <td class="p-2 text-xs">${u.schools?.school_name || u.workplace || '-'}</td>
      </tr>
    `).join('');
  }
}

document.getElementById('user-create-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('usr-email').value;
  const password = document.getElementById('usr-password').value;
  const tempClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });

  const { data: signUpData, error: authErr } = await tempClient.auth.signUp({ email, password });
  if (authErr) return alert('Auth Error: ' + authErr.message);

  const newUid = signUpData.user?.id;
  if (!newUid) return alert('User ID ලබාගත නොහැකි විය.');

  const { error: dbErr } = await supabaseClient.from('users').insert({
    user_id: newUid,
    full_name: document.getElementById('usr-name').value,
    email,
    role: document.getElementById('usr-role').value,
    school_id: document.getElementById('usr-school').value || null,
    workplace: document.getElementById('usr-workplace').value || null
  });
  if (dbErr) return alert('Profile Error: ' + dbErr.message);

  e.target.reset();
  await loadUsers();
  alert('නව පරිශීලක ගිණුම සාර්ථකව සාදන ලදී!');
});

// 3. SCHOOLS MANAGEMENT
async function loadSchools() {
  const { data } = await supabaseClient.from('schools').select('*').order('school_name');
  allSchools = data || [];
  const assetSel = document.getElementById('asset-school');
  const bulkSel = document.getElementById('bulk-school');
  const filterSel = document.getElementById('filter-school');
  const usrSel = document.getElementById('usr-school');
  const evHostSel = document.getElementById('ev-host-school');
  const evRepSel = document.getElementById('ev-rep-school');
  const tbody = document.getElementById('schools-table-body');

  assetSel.innerHTML = ''; bulkSel.innerHTML = ''; tbody.innerHTML = '';
  filterSel.innerHTML = '<option value="">සියලුම පාසල් (All Schools)</option>';
  if (usrSel) usrSel.innerHTML = '<option value="">-- පාසල (School IT සඳහා පමණි) --</option>';
  if (evHostSel) evHostSel.innerHTML = '<option value="">-- තෝරන්න (Optional) --</option>';
  if (evRepSel) evRepSel.innerHTML = '<option value="">-- පාසල තෝරන්න --</option>';

  allSchools.forEach(s => {
    const opt = `<option value="${s.school_id}">${s.school_name} (${s.census_no})</option>`;
    if (usrSel) usrSel.innerHTML += opt;
    if (evHostSel) evHostSel.innerHTML += opt;
    if (evRepSel) evRepSel.innerHTML += opt;
    tbody.innerHTML += `<tr><td class="p-2">${s.census_no}</td><td class="p-2 font-medium">${s.school_name}</td><td class="p-2">${s.division}</td><td class="p-2">${s.school_type || '-'}</td></tr>`;

    if (currentUser.role === 'School_IT' && s.school_id !== currentUser.school_id) return;
    assetSel.innerHTML += opt;
    bulkSel.innerHTML += opt;
    filterSel.innerHTML += opt;
  });
}

document.getElementById('school-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { error } = await supabaseClient.from('schools').insert({
    census_no: document.getElementById('sch-census').value,
    school_name: document.getElementById('sch-name').value,
    division: document.getElementById('sch-division').value,
    school_type: document.getElementById('sch-type').value,
    contact_no: document.getElementById('sch-phone').value
  });
  if (error) return alert('Error: ' + error.message);
  e.target.reset();
  await loadSchools();
  alert('පාසල සාර්ථකව ඇතුළත් කරන ලදී!');
});

// 4. DYNAMIC HARDWARE SPECS, ASSETS & DASHBOARD CHARTS
function renderSpecFields(catSelectId = 'asset-category', containerId = 'dynamic-specs', existingSpecs = {}) {
  const cat = document.getElementById(catSelectId).value;
  const container = document.getElementById(containerId);
  const s = existingSpecs || {};
  const val = (...keys) => {
    for (const k of keys) if (s[k] !== undefined && s[k] !== null) return String(s[k]).replace(/"/g, '&quot;');
    return '';
  };

  let html = '';
  if (['Desktop', 'Laptop', 'All-in-One'].includes(cat)) {
    html = `
      <input data-spec="mb_model" value="${val('mb_model', 'mb-model')}" placeholder="Motherboard Brand/Model" class="px-3 py-2 border rounded-lg text-sm">
      <input data-spec="mb_chipset" value="${val('mb_chipset', 'mb-chipset')}" placeholder="Motherboard Chipset (H61, H81, H110...)" class="px-3 py-2 border rounded-lg text-sm">
      <input data-spec="cpu" value="${val('cpu')}" placeholder="Processor Model (Core i3, i5...)" class="px-3 py-2 border rounded-lg text-sm">
      <input data-spec="cpu_gen" value="${val('cpu_gen', 'cpu-gen')}" placeholder="Processor Gen (4th Gen, 10th Gen...)" class="px-3 py-2 border rounded-lg text-sm">
      <select data-spec="ram_type" class="px-3 py-2 border rounded-lg text-sm">
        <option value="">RAM Type</option>
        ${['DDR2', 'DDR3', 'DDR3L', 'DDR4', 'DDR5'].map(t => `<option value="${t}" ${val('ram_type', 'ram-type') === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <input data-spec="ram_cap" value="${val('ram_cap', 'ram-cap')}" placeholder="RAM Capacity (4GB, 8GB, 16GB)" class="px-3 py-2 border rounded-lg text-sm">
      <select data-spec="storage_type" class="px-3 py-2 border rounded-lg text-sm">
        <option value="">Storage Type</option>
        ${['HDD', 'SATA SSD', 'NVMe SSD'].map(t => `<option value="${t}" ${val('storage_type', 'storage-type') === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <input data-spec="storage_cap" value="${val('storage_cap', 'storage-cap')}" placeholder="Storage Capacity (256GB, 500GB, 1TB)" class="px-3 py-2 border rounded-lg text-sm">
      <input data-spec="monitor" value="${val('monitor')}" placeholder="Monitor වර්ගය & ප්‍රමාණය (LED 19)" class="px-3 py-2 border rounded-lg text-sm">
      <input data-spec="os" value="${val('os')}" placeholder="OS (Windows 10/11, Ubuntu)" class="px-3 py-2 border rounded-lg text-sm">
    `;
  } else if (cat === 'Projector') {
    html = `
      <select data-spec="proj_tech" class="px-3 py-2 border rounded-lg text-sm">
        <option value="LCD" ${val('proj_tech', 'proj-tech') === 'LCD' ? 'selected' : ''}>LCD</option>
        <option value="DLP" ${val('proj_tech', 'proj-tech') === 'DLP' ? 'selected' : ''}>DLP</option>
      </select>
      <input data-spec="proj_res" value="${val('proj_res', 'proj-res')}" placeholder="Resolution (XGA, Full HD)" class="px-3 py-2 border rounded-lg text-sm">
      <input data-spec="proj_lumens" value="${val('proj_lumens', 'proj-lumens')}" placeholder="Brightness (Lumens)" class="px-3 py-2 border rounded-lg text-sm">
      <input data-spec="proj_lamp" value="${val('proj_lamp', 'proj-lamp')}" placeholder="Lamp Hours / Status" class="px-3 py-2 border rounded-lg text-sm">
    `;
  } else if (cat === 'Smart Panel') {
    html = `
      <input data-spec="sp_size" value="${val('sp_size', 'sp-size')}" placeholder="Screen Size (65, 75, 86 inch)" class="px-3 py-2 border rounded-lg text-sm">
      <input data-spec="sp_android" value="${val('sp_android', 'sp-android')}" placeholder="Android OS Version" class="px-3 py-2 border rounded-lg text-sm">
      <input data-spec="sp_ops" value="${val('sp_ops', 'sp-ops')}" placeholder="Windows OPS Specs (තිබේ නම්)" class="px-3 py-2 border rounded-lg text-sm">
    `;
  } else if (cat === 'Printer') {
    html = `
      <select data-spec="pr_type" class="px-3 py-2 border rounded-lg text-sm">
        ${['Ink Tank', 'Laser', 'Dot Matrix'].map(t => `<option ${val('pr_type', 'pr-type') === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <select data-spec="pr_color" class="px-3 py-2 border rounded-lg text-sm">
        ${['Color', 'Monochrome'].map(t => `<option ${val('pr_color', 'pr-color') === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <input data-spec="pr_conn" value="${val('pr_conn', 'pr-conn')}" placeholder="Connectivity (USB / Wi-Fi / LAN)" class="px-3 py-2 border rounded-lg text-sm">
    `;
  } else if (cat === 'UPS') {
    html = `
      <input data-spec="ups_cap" value="${val('ups_cap', 'ups-cap')}" placeholder="Capacity (650VA, 1200VA, 2kVA)" class="px-3 py-2 border rounded-lg text-sm">
      <input data-spec="ups_batt" value="${val('ups_batt', 'ups-batt')}" placeholder="Battery Status / අවසන් මාරු කළ දිනය" class="px-3 py-2 border rounded-lg text-sm">
    `;
  }
  container.innerHTML = html;
}

function collectSpecsFromContainer(containerId) {
  const specs = {};
  document.querySelectorAll(`#${containerId} [data-spec]`).forEach(el => {
    if (el.value) specs[el.getAttribute('data-spec')] = el.value;
  });
  return specs;
}

document.getElementById('asset-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const specs = collectSpecsFromContainer('dynamic-specs');

  const { error } = await supabaseClient.from('assets').insert({
    school_id: document.getElementById('asset-school').value,
    category: document.getElementById('asset-category').value,
    inventory_no: document.getElementById('asset-inv').value,
    serial_no: document.getElementById('asset-serial').value,
    brand_model: document.getElementById('asset-brand').value,
    location: document.getElementById('asset-location').value,
    received_year: parseInt(document.getElementById('asset-year').value) || null,
    funding_source: document.getElementById('asset-funding').value,
    current_status: document.getElementById('asset-status').value,
    specs
  });
  if (error) return alert('Error: ' + error.message);
  e.target.reset();
  renderSpecFields('asset-category', 'dynamic-specs');
  await loadAssets();
  alert('උපකරණය සාර්ථකව ඇතුළත් කරන ලදී!');
});

async function loadAssets() {
  const { data } = await supabaseClient.from('assets').select('*, schools(school_name, census_no)').order('created_at', { ascending: false });
  allAssets = data || [];

  const workingCount = allAssets.filter(r => r.current_status === 'Working').length;
  const faultyCount = allAssets.filter(r => ['Faulty', 'Under Repair', 'Waiting for Parts'].includes(r.current_status)).length;
  const condemnedCount = allAssets.filter(r => r.current_status === 'Condemned').length;

  document.getElementById('stat-total').textContent = allAssets.length;
  document.getElementById('stat-working').textContent = workingCount;
  document.getElementById('stat-faulty').textContent = faultyCount;
  document.getElementById('stat-condemned').textContent = condemnedCount;

  renderDashboardCharts(workingCount, faultyCount, condemnedCount);
  renderSchoolSummaryTable();
  filterAssets();
}

function renderDashboardCharts(workingCount, faultyCount, condemnedCount) {
  const categories = ['Desktop', 'Laptop', 'All-in-One', 'Projector', 'Smart Panel', 'Printer', 'UPS'];
  const catCounts = categories.map(c => allAssets.filter(a => a.category === c).length);

  if (categoryChartInstance) categoryChartInstance.destroy();
  categoryChartInstance = new Chart(document.getElementById('chart-category'), {
    type: 'bar',
    data: {
      labels: categories,
      datasets: [{ label: 'උපකරණ ගණන', data: catCounts, backgroundColor: '#2563eb', borderRadius: 6 }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
  });

  if (statusChartInstance) statusChartInstance.destroy();
  statusChartInstance = new Chart(document.getElementById('chart-status'), {
    type: 'doughnut',
    data: {
      labels: ['Working', 'Faulty / Under Repair', 'Condemned'],
      datasets: [{ data: [workingCount, faultyCount, condemnedCount], backgroundColor: ['#16a34a', '#d97706', '#dc2626'] }]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

function renderSchoolSummaryTable() {
  const summaryMap = {};
  allAssets.forEach(a => {
    const sName = a.schools?.school_name || 'Unknown';
    if (!summaryMap[sName]) summaryMap[sName] = { total: 0, working: 0, faulty: 0, condemned: 0 };
    summaryMap[sName].total++;
    if (a.current_status === 'Working') summaryMap[sName].working++;
    else if (a.current_status === 'Condemned') summaryMap[sName].condemned++;
    else summaryMap[sName].faulty++;
  });

  const tbody = document.getElementById('dashboard-school-summary');
  tbody.innerHTML = Object.entries(summaryMap).map(([name, st]) => `
    <tr>
      <td class="p-2 font-medium">${name}</td>
      <td class="p-2 text-center font-bold">${st.total}</td>
      <td class="p-2 text-center text-green-700 font-semibold">${st.working}</td>
      <td class="p-2 text-center text-amber-700 font-semibold">${st.faulty}</td>
      <td class="p-2 text-center text-red-700 font-semibold">${st.condemned}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="p-3 text-center text-slate-500">දත්ත නොමැත</td></tr>';
}

function filterAssets() {
  const sch = document.getElementById('filter-school').value;
  const cat = document.getElementById('filter-category').value;
  const st = document.getElementById('filter-status').value;
  const q = document.getElementById('filter-search').value.toLowerCase();

  currentFilteredAssets = allAssets.filter(a => {
    if (sch && a.school_id !== sch) return false;
    if (cat && a.category !== cat) return false;
    if (st && a.current_status !== st) return false;
    if (q) {
      const hay = `${a.inventory_no} ${a.serial_no || ''} ${a.brand_model || ''} ${JSON.stringify(a.specs || {})}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const statusColor = (s) => s === 'Working' ? 'bg-green-100 text-green-800' : s === 'Condemned' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800';

  document.getElementById('assets-table-body').innerHTML = currentFilteredAssets.map(a => `
    <tr>
      <td class="p-2 text-center">
        <input type="checkbox" ${selectedAssetIds.has(a.asset_id) ? 'checked' : ''} onchange="toggleAssetSelection('${a.asset_id}', this.checked)" class="w-4 h-4 accent-blue-600 cursor-pointer">
      </td>
      <td class="p-2 font-medium">${a.schools?.school_name || '-'}</td>
      <td class="p-2">${a.category}</td>
      <td class="p-2 text-xs"><b>${a.inventory_no}</b><br><span class="text-slate-500">SN: ${a.serial_no || '-'}</span></td>
      <td class="p-2 text-xs text-slate-600">${Object.entries(a.specs || {}).map(([k,v]) => `${k}: ${v}`).join(', ') || '-'}</td>
      <td class="p-2"><span class="px-2 py-0.5 rounded-full text-xs ${statusColor(a.current_status)}">${a.current_status}</span></td>
      <td class="p-2 space-x-1 whitespace-nowrap">
        <button onclick="openQrModal('${a.asset_id}')" class="bg-slate-800 text-white px-2 py-1 rounded text-xs">QR</button>
        <button onclick="openAssetDetail('${a.asset_id}')" class="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs font-medium">Details</button>
        <button onclick="openEditAssetModal('${a.asset_id}')" class="bg-indigo-100 text-indigo-800 px-2 py-1 rounded text-xs font-medium">✏️ Edit</button>
        <button onclick="requestDeleteAsset('${a.asset_id}')" class="bg-red-100 text-red-800 px-2 py-1 rounded text-xs font-medium">🗑️</button>
        <button onclick="openFaultModal('${a.asset_id}')" class="bg-amber-100 text-amber-800 px-2 py-1 rounded text-xs font-medium">🔧</button>
      </td>
    </tr>
  `).join('');

  updateSelectedQrCount();
}

// 5. EDIT & DELETE ASSET WITH ADMIN APPROVAL WORKFLOW
function openEditAssetModal(assetId) {
  const a = allAssets.find(x => x.asset_id === assetId);
  if (!a) return;

  document.getElementById('edit-asset-id').value = a.asset_id;
  document.getElementById('edit-asset-category').value = a.category;
  document.getElementById('edit-asset-inv').value = a.inventory_no || '';
  document.getElementById('edit-asset-serial').value = a.serial_no || '';
  document.getElementById('edit-asset-brand').value = a.brand_model || '';
  document.getElementById('edit-asset-location').value = a.location || '';
  document.getElementById('edit-asset-status').value = a.current_status || 'Working';
  document.getElementById('edit-asset-reason').value = '';

  renderSpecFields('edit-asset-category', 'edit-dynamic-specs', a.specs || {});

  const notice = document.getElementById('edit-role-notice');
  const submitBtn = document.getElementById('btn-submit-edit-asset');
  if (currentUser.role === 'Admin') {
    notice.textContent = 'Admin වරප්‍රසාදය: ඔබ සිදුකරන වෙනස්කම් කෙලින්ම Database එකට යාවත්කාලීන වේ.';
    submitBtn.textContent = 'Save Changes Now';
  } else {
    notice.textContent = 'සැ.යු: ඔබ යොමු කරන වෙනස්කම් System Admin අනුමත කළ පසු පමණක් පද්ධතියේ යාවත්කාලීන වේ.';
    submitBtn.textContent = 'Submit for Admin Approval';
  }

  document.getElementById('edit-asset-modal').classList.remove('hidden');
}

document.getElementById('edit-asset-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const assetId = document.getElementById('edit-asset-id').value;
  const a = allAssets.find(x => x.asset_id === assetId);
  if (!a) return;

  const updatedFields = {
    category: document.getElementById('edit-asset-category').value,
    inventory_no: document.getElementById('edit-asset-inv').value,
    serial_no: document.getElementById('edit-asset-serial').value || null,
    brand_model: document.getElementById('edit-asset-brand').value || null,
    location: document.getElementById('edit-asset-location').value || null,
    current_status: document.getElementById('edit-asset-status').value,
    specs: collectSpecsFromContainer('edit-dynamic-specs')
  };
  const reason = document.getElementById('edit-asset-reason').value.trim();

  if (currentUser.role === 'Admin') {
    const { error } = await supabaseClient.from('assets').update({
      ...updatedFields,
      updated_at: new Date().toISOString()
    }).eq('asset_id', assetId);
    if (error) return alert('Update Error: ' + error.message);

    document.getElementById('edit-asset-modal').classList.add('hidden');
    await loadAssets();
    alert('උපකරණ තොරතුරු සාර්ථකව යාවත්කාලීන කරන ලදී!');
  } else {
    const oldData = {
      school_name: a.schools?.school_name || '',
      category: a.category,
      inventory_no: a.inventory_no,
      serial_no: a.serial_no,
      brand_model: a.brand_model,
      location: a.location,
      current_status: a.current_status,
      specs: a.specs || {}
    };

    const { error } = await supabaseClient.from('asset_change_requests').insert({
      asset_id: assetId,
      school_id: a.school_id,
      request_type: 'EDIT',
      old_data: oldData,
      proposed_data: updatedFields,
      reason,
      requested_by: currentUser.user_id,
      status: 'Pending'
    });
    if (error) return alert('Request Error: ' + error.message);

    document.getElementById('edit-asset-modal').classList.add('hidden');
    await loadChangeRequests();
    alert('ඔබගේ සංස්කරණ ඉල්ලීම Admin අනුමැතිය (Approval) සඳහා යොමු කරන ලදී. Admin අනුමත කළ පසු දත්ත යාවත්කාලීන වේ.');
  }
});

async function requestDeleteAsset(assetId) {
  const a = allAssets.find(x => x.asset_id === assetId);
  if (!a) return;

  if (currentUser.role === 'Admin') {
    if (!confirm(`"${a.category} - ${a.inventory_no}" ස්ථිරවම මකා දැමීමට (Delete) අවශ්‍ය බව තහවුරු කරන්න.`)) return;
    const { error } = await supabaseClient.from('assets').delete().eq('asset_id', assetId);
    if (error) return alert('Delete Error: ' + error.message);
    await loadAssets();
    alert('උපකරණය පද්ධතියෙන් ඉවත් කරන ලදී.');
  } else {
    const reason = prompt(`"${a.category} - ${a.inventory_no}" ඉවත් කිරීමට (Delete) Admin අනුමැතිය අවශ්‍ය වේ.\n\nඉවත් කිරීමට හේතුව සඳහන් කරන්න:`);
    if (!reason || !reason.trim()) return;

    const { error } = await supabaseClient.from('asset_change_requests').insert({
      asset_id: assetId,
      school_id: a.school_id,
      request_type: 'DELETE',
      old_data: {
        school_name: a.schools?.school_name || '',
        category: a.category,
        inventory_no: a.inventory_no,
        serial_no: a.serial_no,
        brand_model: a.brand_model,
        specs: a.specs || {}
      },
      proposed_data: {},
      reason: reason.trim(),
      requested_by: currentUser.user_id,
      status: 'Pending'
    });
    if (error) return alert('Request Error: ' + error.message);
    await loadChangeRequests();
    alert('උපකරණය ඉවත් කිරීමේ ඉල්ලීම Admin අනුමැතිය සඳහා යොමු කරන ලදී.');
  }
}

async function loadChangeRequests() {
  const statusFilter = document.getElementById('approval-filter-status')?.value;
  let query = supabaseClient.from('asset_change_requests')
    .select('*, schools(school_name)')
    .order('requested_at', { ascending: false });

  if (currentUser.role === 'Admin' && statusFilter) {
    query = query.eq('status', statusFilter);
  } else if (currentUser.role !== 'Admin') {
    query = query.eq('requested_by', currentUser.user_id);
  }

  const { data } = await query;
  const requests = data || [];

  if (currentUser.role === 'Admin') {
    // Count all pending requests for badge
    const { count } = await supabaseClient.from('asset_change_requests')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'Pending');

    const badge = document.getElementById('pending-approvals-badge');
    if (count && count > 0) {
      badge.textContent = count;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }

    const container = document.getElementById('approvals-list');
    container.innerHTML = requests.length ? requests.map(r => {
      const reqUser = usersMap[r.requested_by]?.full_name || 'User';
      const oldSpecsStr = Object.entries(r.old_data?.specs || {}).map(([k,v]) => `${k}: ${v}`).join(', ') || '-';
      const newSpecsStr = Object.entries(r.proposed_data?.specs || {}).map(([k,v]) => `${k}: ${v}`).join(', ') || '-';
      const isEdit = r.request_type === 'EDIT';

      return `
        <div class="bg-white p-5 rounded-xl shadow-sm border space-y-3">
          <div class="flex flex-wrap justify-between items-start gap-2 border-b pb-2">
            <div>
              <span class="px-2.5 py-0.5 rounded text-xs font-bold ${isEdit ? 'bg-indigo-100 text-indigo-800' : 'bg-red-100 text-red-800'}">${r.request_type} REQUEST</span>
              <span class="font-bold text-sm ml-2">${r.schools?.school_name || r.old_data?.school_name || ''} — ${r.old_data?.category || ''} (${r.old_data?.inventory_no || ''})</span>
              <p class="text-xs text-slate-500 mt-1">ඉල්ලීම කළේ: <b>${reqUser}</b> | දිනය: ${new Date(r.requested_at).toLocaleString()}</p>
            </div>
            <span class="px-2.5 py-1 rounded-full text-xs font-semibold ${r.status === 'Pending' ? 'bg-amber-100 text-amber-800' : r.status === 'Approved' ? 'bg-green-100 text-green-800' : 'bg-slate-200 text-slate-700'}">${r.status}</span>
          </div>

          <p class="text-xs bg-amber-50 p-2 rounded border border-amber-200"><b>හේතුව (Reason):</b> ${r.reason || '-'}</p>

          ${isEdit ? `
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div class="bg-slate-50 p-3 rounded-lg border">
                <p class="font-bold text-slate-600 mb-1">පැරණි දත්ත (Current Values)</p>
                <p><b>Inv / SN:</b> ${r.old_data?.inventory_no || '-'} / ${r.old_data?.serial_no || '-'}</p>
                <p><b>Brand/Model:</b> ${r.old_data?.brand_model || '-'} | <b>Status:</b> ${r.old_data?.current_status || '-'}</p>
                <p class="mt-1"><b>Specs:</b> ${oldSpecsStr}</p>
              </div>
              <div class="bg-blue-50 p-3 rounded-lg border border-blue-200">
                <p class="font-bold text-blue-800 mb-1">අලුතින් යෝජිත දත්ත (Proposed Values)</p>
                <p><b>Inv / SN:</b> ${r.proposed_data?.inventory_no || '-'} / ${r.proposed_data?.serial_no || '-'}</p>
                <p><b>Brand/Model:</b> ${r.proposed_data?.brand_model || '-'} | <b>Status:</b> ${r.proposed_data?.current_status || '-'}</p>
                <p class="mt-1"><b>Specs:</b> ${newSpecsStr}</p>
              </div>
            </div>
          ` : `<p class="text-xs text-red-700 font-semibold">⚠️ මෙම උපකරණය පද්ධතියෙන් ස්ථිරවම ඉවත් කිරීමට (Delete) අනුමැතිය ඉල්ලා ඇත.</p>`}

          ${r.status === 'Pending' ? `
            <div class="flex justify-end gap-2 pt-2">
              <button onclick="processChangeRequest('${r.request_id}', 'Rejected')" class="bg-slate-200 hover:bg-slate-300 text-slate-800 px-4 py-1.5 rounded-lg text-xs font-semibold">❌ Reject</button>
              <button onclick="processChangeRequest('${r.request_id}', 'Approved')" class="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-1.5 rounded-lg text-xs font-semibold">✅ Approve & Apply</button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('') : '<div class="bg-white p-6 rounded-xl border text-center text-sm text-slate-500">අනුමැතිය සඳහා ඉල්ලීම් නොමැත.</div>';
  } else {
    const tbody = document.getElementById('my-requests-body');
    if (tbody) {
      tbody.innerHTML = requests.length ? requests.map(r => `
        <tr>
          <td class="p-2">${new Date(r.requested_at).toLocaleDateString()}</td>
          <td class="p-2 font-bold">${r.request_type}</td>
          <td class="p-2">${r.old_data?.category || ''} (${r.old_data?.inventory_no || ''})</td>
          <td class="p-2">${r.reason || '-'}</td>
          <td class="p-2 font-semibold ${r.status === 'Approved' ? 'text-green-700' : r.status === 'Rejected' ? 'text-red-600' : 'text-amber-600'}">${r.status}</td>
        </tr>
      `).join('') : '<tr><td colspan="5" class="p-2 text-center text-slate-400">ඉල්ලීම් නොමැත</td></tr>';
    }
  }
}

async function processChangeRequest(requestId, decision) {
  const { data: req, error: fetchErr } = await supabaseClient.from('asset_change_requests').select('*').eq('request_id', requestId).single();
  if (fetchErr || !req) return alert('Request සොයාගත නොහැක.');

  if (decision === 'Approved') {
    if (req.request_type === 'EDIT' && req.asset_id) {
      const { error: upErr } = await supabaseClient.from('assets').update({
        ...req.proposed_data,
        updated_at: new Date().toISOString()
      }).eq('asset_id', req.asset_id);
      if (upErr) return alert('Asset Update Error: ' + upErr.message);
    } else if (req.request_type === 'DELETE' && req.asset_id) {
      await supabaseClient.from('asset_change_requests').update({
        status: 'Approved',
        reviewed_by: currentUser.user_id,
        reviewed_at: new Date().toISOString()
      }).eq('request_id', requestId);

      const { error: delErr } = await supabaseClient.from('assets').delete().eq('asset_id', req.asset_id);
      if (delErr) return alert('Asset Delete Error: ' + delErr.message);

      await loadAssets();
      await loadChangeRequests();
      return alert('ඉල්ලීම අනුමත කර උපකරණය පද්ධතියෙන් ඉවත් කරන ලදී.');
    }
  }

  const { error } = await supabaseClient.from('asset_change_requests').update({
    status: decision,
    reviewed_by: currentUser.user_id,
    reviewed_at: new Date().toISOString()
  }).eq('request_id', requestId);

  if (error) return alert('Error: ' + error.message);
  await loadAssets();
  await loadChangeRequests();
  alert(decision === 'Approved' ? 'ඉල්ලීම අනුමත කර දත්ත යාවත්කාලීන කරන ලදී!' : 'ඉල්ලීම ප්‍රතික්ෂේප කරන ලදී.');
}

// 6. SINGLE & BATCH QR CODE GENERATION (A4 GRID PRINT)
function toggleAssetSelection(assetId, checked) {
  if (checked) selectedAssetIds.add(assetId);
  else selectedAssetIds.delete(assetId);
  updateSelectedQrCount();
}

function toggleSelectAllAssets(checked) {
  currentFilteredAssets.forEach(a => {
    if (checked) selectedAssetIds.add(a.asset_id);
    else selectedAssetIds.delete(a.asset_id);
  });
  filterAssets();
}

function updateSelectedQrCount() {
  const el = document.getElementById('selected-qr-count');
  if (el) el.textContent = selectedAssetIds.size;
}

function batchPrintSelectedQRs() {
  const chosen = allAssets.filter(a => selectedAssetIds.has(a.asset_id));
  if (!chosen.length) return alert('කරුණාකර QR Print කිරීමට අවශ්‍ය උපකරණ තෝරන්න (Checkbox ටික් කරන්න).');
  const cols = parseInt(document.getElementById('batch-qr-cols').value) || 3;
  batchPrintAssets(chosen, cols);
}

function batchPrintAssets(assetsList, cols = 3) {
  if (!assetsList || !assetsList.length) return alert('Print කිරීමට උපකරණ නොමැත.');
  const pool = document.getElementById('batch-qr-hidden-pool');
  pool.innerHTML = '';

  const stickerItems = assetsList.map((a, idx) => {
    const holder = document.createElement('div');
    holder.id = `tmp-qr-${idx}`;
    pool.appendChild(holder);
    new QRCode(holder, { text: a.asset_id, width: 140, height: 140 });
    const canvas = holder.querySelector('canvas');
    const img = holder.querySelector('img');
    const dataUrl = canvas ? canvas.toDataURL('image/png') : (img ? img.src : '');
    const sName = a.schools?.school_name || allSchools.find(s => s.school_id === a.school_id)?.school_name || '';

    return `
      <div class="sticker">
        <p class="school">${sName}</p>
        <img class="qr-img" src="${dataUrl}" />
        <p class="info">${a.category} | ${a.inventory_no}</p>
        <p class="serial">S/N: ${a.serial_no || 'N/A'}</p>
        <p class="uuid">${a.asset_id}</p>
      </div>
    `;
  }).join('');

  pool.innerHTML = '';
  const qrSize = cols === 4 ? '105px' : '130px';

  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) return alert('Popup blocker නිසා Print කවුළුව විවෘත නොවීය. කරුණාකර Popups Allow කරන්න.');

  win.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Batch QR Stickers (A4)</title>
      <style>
        @page { size: A4 portrait; margin: 10mm; }
        body { font-family: sans-serif; margin: 0; padding: 0; }
        .grid { display: grid; grid-template-columns: repeat(${cols}, 1fr); gap: 8px; }
        .sticker {
          border: 1.5px solid #1e293b;
          border-radius: 8px;
          padding: 8px 6px;
          text-align: center;
          page-break-inside: avoid;
          break-inside: avoid;
        }
        .school { font-size: 10px; font-weight: bold; color: #334155; margin: 0 0 5px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .qr-img { width: ${qrSize}; height: ${qrSize}; display: block; margin: 0 auto; }
        .info { font-size: 11px; font-weight: bold; color: #0f172a; margin: 5px 0 1px 0; }
        .serial { font-size: 10px; font-weight: bold; color: #1e293b; margin: 1px 0 3px 0; }
        .uuid { font-size: 7.5px; color: #64748b; word-break: break-all; margin: 0; }
      </style>
    </head>
    <body onload="setTimeout(() => { window.focus(); window.print(); }, 250);">
      <div class="grid">${stickerItems}</div>
    </body>
    </html>
  `);
  win.document.close();
}

function openQrModal(assetId) {
  const a = allAssets.find(x => x.asset_id === assetId);
  if (!a) return;

  document.getElementById('qr-school-name').textContent = a.schools?.school_name || '';
  document.getElementById('qr-asset-info').textContent = `${a.category} | ${a.inventory_no}`;
  document.getElementById('qr-serial-no').textContent = `S/N: ${a.serial_no || 'N/A'}`;
  document.getElementById('qr-asset-id').textContent = a.asset_id;
  const qrBox = document.getElementById('qr-code-container');
  qrBox.innerHTML = '';
  new QRCode(qrBox, { text: a.asset_id, width: 160, height: 160 });
  document.getElementById('qr-modal').classList.remove('hidden');
}

function printQrSticker() {
  const schoolName = document.getElementById('qr-school-name').textContent;
  const assetInfo = document.getElementById('qr-asset-info').textContent;
  const serialNo = document.getElementById('qr-serial-no')?.textContent || '';
  const assetId = document.getElementById('qr-asset-id').textContent;

  const canvas = document.querySelector('#qr-code-container canvas');
  const img = document.querySelector('#qr-code-container img');
  const qrDataUrl = canvas ? canvas.toDataURL('image/png') : (img ? img.src : '');

  if (!qrDataUrl) return alert('QR Code රූපය සකස් වී නොමැත. නැවත උත්සාහ කරන්න.');

  const win = window.open('', '_blank', 'width=420,height=500');
  if (!win) return alert('Popup blocker නිසා Print කවුළුව විවෘත නොවීය.');

  win.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>QR Sticker - ${assetInfo}</title>
      <style>
        body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; min-height: 90vh; margin: 0; }
        .sticker { border: 2px solid #1e293b; border-radius: 12px; padding: 16px 20px; text-align: center; width: 240px; }
        .school { font-size: 12px; font-weight: bold; color: #334155; margin: 0 0 10px 0; }
        .qr-img { width: 160px; height: 160px; display: block; margin: 0 auto; }
        .info { font-size: 13px; font-weight: bold; color: #0f172a; margin: 10px 0 2px 0; }
        .serial { font-size: 12px; font-weight: bold; color: #1e293b; margin: 2px 0 6px 0; }
        .uuid { font-size: 9px; color: #64748b; word-break: break-all; margin: 0; }
      </style>
    </head>
    <body>
      <div class="sticker">
        <p class="school">${schoolName}</p>
        <img class="qr-img" src="${qrDataUrl}" onload="setTimeout(() => { window.focus(); window.print(); }, 150);" />
        <p class="info">${assetInfo}</p>
        <p class="serial">${serialNo}</p>
        <p class="uuid">${assetId}</p>
      </div>
    </body>
    </html>
  `);
  win.document.close();
}

// 7. QR SCANNER & ASSET DETAIL MODAL
function startScanner() {
  const msg = document.getElementById('scan-result-msg');
  msg.textContent = 'Camera ආරම්භ වෙමින් පවතී...';
  html5QrScanner = new Html5Qrcode('qr-reader');
  html5QrScanner.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: { width: 220, height: 220 } },
    async (decodedText) => {
      msg.textContent = 'Scan සාර්ථකයි: ' + decodedText;
      await stopScanner();
      openAssetDetail(decodedText.trim());
    },
    () => {}
  ).catch(err => {
    msg.textContent = 'Camera විවෘත කළ නොහැක (HTTPS අවශ්‍ය විය හැක): ' + err;
  });
}

async function stopScanner() {
  if (html5QrScanner && html5QrScanner.isScanning) {
    await html5QrScanner.stop();
    html5QrScanner.clear();
  }
}

async function openAssetDetail(assetId) {
  if (!assetId) return;
  const { data: a, error } = await supabaseClient.from('assets').select('*, schools(school_name, census_no)').eq('asset_id', assetId).single();
  if (error || !a) return alert('අදාළ උපකරණය සොයාගත නොහැක.');

  document.getElementById('detail-asset-header').innerHTML = `
    <h3 class="font-bold text-lg text-blue-700">${a.category} - ${a.inventory_no}</h3>
    <p class="text-xs text-slate-500">${a.schools?.school_name || ''} | SN: ${a.serial_no || '-'} | Status: <b>${a.current_status}</b></p>
  `;
  document.getElementById('detail-asset-specs').innerHTML = `
    <p class="font-semibold mb-1">Brand/Model: ${a.brand_model || '-'} | Location: ${a.location || '-'}</p>
    <div class="grid grid-cols-2 gap-1 text-xs text-slate-700 mt-2">
      ${Object.entries(a.specs || {}).map(([k, v]) => `<div><b>${k}:</b> ${v}</div>`).join('') || 'Specs ඇතුළත් කර නොමැත'}
    </div>
  `;
  document.getElementById('btn-detail-edit-asset').onclick = () => {
    document.getElementById('asset-detail-modal').classList.add('hidden');
    openEditAssetModal(a.asset_id);
  };
  document.getElementById('btn-detail-report-fault').onclick = () => {
    document.getElementById('asset-detail-modal').classList.add('hidden');
    openFaultModal(a.asset_id);
  };

  const { data: logs } = await supabaseClient.from('maintenance_logs').select('*').eq('asset_id', assetId).order('reported_date', { ascending: false });
  document.getElementById('detail-asset-history').innerHTML = (logs || []).length
    ? logs.map(l => `
      <div class="border rounded-lg p-3 bg-slate-50">
        <div class="flex justify-between text-xs text-slate-500"><span><b>${l.report_no}</b> (${new Date(l.reported_date).toLocaleDateString()})</span><span class="font-bold text-blue-700">${l.repair_status}</span></div>
        <p class="font-medium mt-1">දෝෂය: ${l.fault_description}</p>
        ${l.action_taken ? `<p class="text-xs text-slate-700 mt-1">පිළියම: ${l.action_taken} (Parts: ${l.parts_replaced || 'නැත'})</p>` : ''}
        ${['Completed', 'Unrepairable'].includes(l.repair_status) ? `<button onclick="openPdfReport('${l.log_id}')" class="mt-2 bg-emerald-600 text-white px-2.5 py-1 rounded text-xs">📄 තත්ව වාර්තාව (PDF)</button>` : ''}
      </div>`).join('')
    : '<p class="text-xs text-slate-500">මෙම උපකරණයට අදාළ අලුත්වැඩියා වාර්තා නොමැත.</p>';

  document.getElementById('asset-detail-modal').classList.remove('hidden');
}

// 8. REPAIR TICKETING & ASSIGNMENT
function openFaultModal(assetId) {
  const a = allAssets.find(x => x.asset_id === assetId);
  document.getElementById('fault-asset-id').value = assetId;
  document.getElementById('fault-asset-label').textContent = a ? `${a.schools?.school_name} — ${a.category} (${a.inventory_no})` : assetId;
  document.getElementById('fault-modal').classList.remove('hidden');
}

document.getElementById('fault-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const asset_id = document.getElementById('fault-asset-id').value;
  const fault_description = document.getElementById('fault-description').value;

  const { error } = await supabaseClient.from('maintenance_logs').insert({
    asset_id,
    reported_by: currentUser.user_id,
    fault_description,
    repair_status: 'Pending'
  });
  if (error) return alert('Error: ' + error.message);

  await supabaseClient.from('assets').update({ current_status: 'Faulty' }).eq('asset_id', asset_id);
  e.target.reset();
  document.getElementById('fault-modal').classList.add('hidden');
  await loadAssets();
  await loadTickets();
  alert('අලුත්වැඩියා ඉල්ලීම (Repair Ticket) සාර්ථකව යොමු කරන ලදී!');
});

async function loadTickets() {
  const statusFilter = document.getElementById('ticket-filter-status')?.value;
  let query = supabaseClient.from('maintenance_logs').select('*, assets(inventory_no, category, schools(school_name)), repair_events(event_name)').order('reported_date', { ascending: false });
  if (statusFilter) query = query.eq('repair_status', statusFilter);

  const { data } = await query;
  const tickets = data || [];
  currentFilteredTickets = tickets;
  document.getElementById('stat-open-tickets').textContent = tickets.filter(t => !['Completed', 'Unrepairable'].includes(t.repair_status)).length;

  const techMembers = allUsers.filter(u => ['Tech_Team', 'Admin'].includes(u.role));

  document.getElementById('tickets-table-body').innerHTML = tickets.map(t => {
    const techName = t.assigned_tech_id ? (usersMap[t.assigned_tech_id]?.full_name || 'Assigned') : 'Assign කර නැත';
    const eventBadge = t.repair_events?.event_name ? `<div class="text-[11px] text-emerald-700 font-semibold mt-0.5">📅 ${t.repair_events.event_name}</div>` : '';
    const assignControl = currentUser.role === 'Admin' && !t.event_id
      ? `<select onchange="assignTicket('${t.log_id}', this.value)" class="border rounded px-2 py-1 text-xs bg-white">
           <option value="">-- Select Member --</option>
           ${techMembers.map(m => `<option value="${m.user_id}" ${t.assigned_tech_id === m.user_id ? 'selected' : ''}>${m.full_name}</option>`).join('')}
         </select>`
      : `<span class="text-xs font-medium">${t.event_id ? 'Event Team' : techName}</span>${eventBadge}`;

    const canRepair = currentUser.role === 'Admin' || (currentUser.role === 'Tech_Team' && t.assigned_tech_id === currentUser.user_id);
    const canPrintPdf = ['Completed', 'Unrepairable'].includes(t.repair_status);

    return `
      <tr>
        <td class="p-2 text-xs font-bold">${t.report_no}<br><span class="font-normal text-slate-400">${new Date(t.reported_date).toLocaleDateString()}</span></td>
        <td class="p-2 text-xs"><b>${t.assets?.schools?.school_name || '-'}</b><br>${t.assets?.category || ''} (${t.assets?.inventory_no || ''})</td>
        <td class="p-2 text-xs max-w-xs">${t.fault_description}</td>
        <td class="p-2">${assignControl}</td>
        <td class="p-2"><span class="px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-800">${t.repair_status}</span></td>
        <td class="p-2 space-x-1 whitespace-nowrap">
          ${canRepair ? `<button onclick="openRepairModal('${t.log_id}', '${t.asset_id}', '${t.report_no}')" class="bg-blue-600 text-white px-2.5 py-1 rounded text-xs">🛠️ Update</button>` : ''}
          ${canPrintPdf ? `<button onclick="openPdfReport('${t.log_id}')" class="bg-emerald-600 text-white px-2.5 py-1 rounded text-xs">📄 PDF වාර්තාව</button>` : ''}
        </td>
      </tr>
    `;
  }).join('');
}

async function assignTicket(logId, techId) {
  if (!techId) return;
  const { error } = await supabaseClient.from('maintenance_logs').update({
    assigned_by: currentUser.user_id,
    assigned_tech_id: techId,
    assigned_date: new Date().toISOString(),
    repair_status: 'Assigned'
  }).eq('log_id', logId);
  if (error) return alert('Assign Error: ' + error.message);
  await loadTickets();
  alert('Ticket එක සාමාජිකයා වෙත යොමු කරන ලදී!');
}

function openRepairModal(logId, assetId, reportNo) {
  document.getElementById('rep-log-id').value = logId;
  document.getElementById('rep-asset-id').value = assetId;
  document.getElementById('rep-header-info').textContent = `Report No: ${reportNo} | Technical Officer: ${currentUser.full_name}`;
  document.getElementById('repair-modal').classList.remove('hidden');
}

document.getElementById('repair-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const log_id = document.getElementById('rep-log-id').value;
  const asset_id = document.getElementById('rep-asset-id').value;
  const repair_status = document.getElementById('rep-status').value;

  const { error } = await supabaseClient.from('maintenance_logs').update({
    assigned_tech_id: currentUser.user_id,
    diagnosis: document.getElementById('rep-diagnosis').value,
    action_taken: document.getElementById('rep-action').value,
    parts_replaced: document.getElementById('rep-parts').value,
    final_condition: document.getElementById('rep-condition').value,
    repair_status,
    remarks: document.getElementById('rep-remarks').value,
    completed_date: ['Completed', 'Unrepairable'].includes(repair_status) ? new Date().toISOString() : null
  }).eq('log_id', log_id);
  if (error) return alert('Error: ' + error.message);

  const newAssetStatus = repair_status === 'Completed' ? 'Working' : repair_status === 'Unrepairable' ? 'Condemned' : 'Under Repair';
  await supabaseClient.from('assets').update({ current_status: newAssetStatus }).eq('asset_id', asset_id);

  e.target.reset();
  document.getElementById('repair-modal').classList.add('hidden');
  await loadAssets();
  await loadTickets();
  alert('අලුත්වැඩියා විස්තර සාර්ථකව සුරැකුණි!');
});

// 9. REPAIR EVENTS MANAGEMENT & EVENT WORKSPACE
async function loadEvents() {
  const { data } = await supabaseClient.from('repair_events').select('*').order('event_date', { ascending: false });
  const events = data || [];
  document.getElementById('events-table-body').innerHTML = events.map(ev => `
    <tr>
      <td class="p-2 font-medium">${ev.event_date}</td>
      <td class="p-2 font-bold text-blue-700">${ev.event_name}</td>
      <td class="p-2 text-xs">${ev.venue_name} <span class="text-slate-400">(${ev.venue_type})</span></td>
      <td class="p-2"><span class="px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-800">${ev.status}</span></td>
      <td class="p-2">
        <button onclick="openEventWorkspace('${ev.event_id}')" class="bg-slate-800 hover:bg-slate-900 text-white px-3 py-1 rounded text-xs font-medium">Open Workspace</button>
      </td>
    </tr>
  `).join('');
}

document.getElementById('event-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const { error } = await supabaseClient.from('repair_events').insert({
    event_name: document.getElementById('ev-name').value,
    event_date: document.getElementById('ev-date').value,
    venue_type: document.getElementById('ev-venue-type').value,
    venue_name: document.getElementById('ev-venue-name').value,
    host_school_id: document.getElementById('ev-host-school').value || null,
    status: document.getElementById('ev-status').value,
    description: document.getElementById('ev-desc').value,
    created_by: currentUser.user_id
  });
  if (error) return alert('Event Error: ' + error.message);
  e.target.reset();
  document.getElementById('create-event-box').classList.add('hidden');
  await loadEvents();
  alert('අලුත්වැඩියා වැඩසටහන සාර්ථකව සාදන ලදී!');
});

async function openEventWorkspace(eventId) {
  activeEventId = eventId;
  const { data: ev } = await supabaseClient.from('repair_events').select('*').eq('event_id', eventId).single();
  if (!ev) return;
  activeEventObj = ev;

  document.getElementById('ws-event-title').textContent = ev.event_name;
  document.getElementById('ws-event-meta').textContent = `📅 ${ev.event_date} | 📍 ${ev.venue_name} (${ev.venue_type}) | Status: ${ev.status}`;

  const techMembers = allUsers.filter(u => ['Tech_Team', 'Admin'].includes(u.role));
  document.getElementById('ws-member-select').innerHTML = techMembers.map(m => `<option value="${m.user_id}">${m.full_name} (${m.workplace || 'Tech Team'})</option>`).join('');

  await loadEventParticipants();
  await loadEventLogs();
  document.getElementById('event-workspace').classList.remove('hidden');
  document.getElementById('event-workspace').scrollIntoView({ behavior: 'smooth' });
}

async function loadEventParticipants() {
  const { data } = await supabaseClient.from('event_participants').select('*, users(full_name, workplace, signature_url)').eq('event_id', activeEventId);
  const list = data || [];
  document.getElementById('ws-participants-list').innerHTML = list.length
    ? list.map(p => `
      <div class="flex items-center justify-between bg-white p-2.5 rounded-lg border">
        <div>
          <p class="font-semibold text-xs">${p.users?.full_name || '-'}</p>
          <p class="text-[11px] text-slate-500">${p.users?.workplace || '-'}</p>
        </div>
        <label class="flex items-center gap-1.5 text-xs font-medium cursor-pointer">
          <input type="checkbox" ${p.participated ? 'checked' : ''} ${currentUser.role !== 'Admin' ? 'disabled' : ''} onchange="toggleEventAttendance('${p.id}', this.checked)" class="w-4 h-4 accent-emerald-600">
          <span class="${p.participated ? 'text-emerald-700' : 'text-slate-400'}">${p.participated ? 'සහභාගී විය' : 'Assign කළ'}</span>
        </label>
      </div>
    `).join('')
    : '<p class="text-xs text-slate-500">තවම සාමාජිකයින් Assign කර නොමැත.</p>';
}

async function assignMemberToEvent() {
  const userId = document.getElementById('ws-member-select').value;
  if (!userId || !activeEventId) return;
  const { error } = await supabaseClient.from('event_participants').insert({
    event_id: activeEventId,
    user_id: userId,
    participated: true
  });
  if (error) return alert('Error (දැනටමත් Assign කර තිබිය හැක): ' + error.message);
  await loadEventParticipants();
}

async function toggleEventAttendance(participantId, participated) {
  const { error } = await supabaseClient.from('event_participants').update({ participated }).eq('id', participantId);
  if (error) return alert('Attendance Error: ' + error.message);
  await loadEventParticipants();
}

function loadSchoolAssetsForEvent() {
  const schId = document.getElementById('ev-rep-school').value;
  const sel = document.getElementById('ev-rep-asset');
  const schAssets = allAssets.filter(a => a.school_id === schId);
  sel.innerHTML = schAssets.length
    ? schAssets.map(a => `<option value="${a.asset_id}">${a.category} - ${a.inventory_no} (SN: ${a.serial_no || '-'})</option>`).join('')
    : '<option value="">-- මෙම පාසලේ උපකරණ ඇතුළත් කර නැත --</option>';
}

document.getElementById('event-repair-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const asset_id = document.getElementById('ev-rep-asset').value;
  if (!asset_id || !activeEventId) return alert('කරුණාකර පාසල සහ උපකරණය තෝරන්න.');

  const repair_status = document.getElementById('ev-rep-status').value;
  const { error } = await supabaseClient.from('maintenance_logs').insert({
    asset_id,
    event_id: activeEventId,
    reported_by: currentUser.user_id,
    assigned_tech_id: currentUser.user_id,
    fault_description: document.getElementById('ev-rep-fault').value,
    diagnosis: document.getElementById('ev-rep-diag').value,
    action_taken: document.getElementById('ev-rep-action').value,
    parts_replaced: document.getElementById('ev-rep-parts').value,
    final_condition: document.getElementById('ev-rep-condition').value,
    repair_status,
    completed_date: ['Completed', 'Unrepairable'].includes(repair_status) ? new Date().toISOString() : null
  });
  if (error) return alert('Error: ' + error.message);

  const newAssetStatus = repair_status === 'Completed' ? 'Working' : repair_status === 'Unrepairable' ? 'Condemned' : 'Under Repair';
  await supabaseClient.from('assets').update({ current_status: newAssetStatus }).eq('asset_id', asset_id);

  e.target.reset();
  await loadAssets();
  await loadEventLogs();
  await loadTickets();
  alert('වැඩසටහනේ අලුත්වැඩියා වාර්තාව සාර්ථකව ඇතුළත් කරන ලදී!');
});

async function loadEventLogs() {
  const { data } = await supabaseClient.from('maintenance_logs')
    .select('*, assets(inventory_no, serial_no, category, schools(school_name))')
    .eq('event_id', activeEventId)
    .order('reported_date', { ascending: false });

  activeEventLogs = data || [];
  document.getElementById('ws-event-logs-body').innerHTML = activeEventLogs.length
    ? activeEventLogs.map(l => `
      <tr>
        <td class="p-2 font-bold">${l.report_no}</td>
        <td class="p-2">${l.assets?.schools?.school_name || '-'}</td>
        <td class="p-2">${l.assets?.category} (${l.assets?.inventory_no})</td>
        <td class="p-2"><b>දෝෂය:</b> ${l.fault_description}<br><b>පිළියම:</b> ${l.action_taken || '-'}</td>
        <td class="p-2 font-semibold text-blue-700">${l.repair_status}</td>
        <td class="p-2">
          <button onclick="openPdfReport('${l.log_id}')" class="bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1 rounded text-xs font-medium">📄 PDF වාර්තාව</button>
        </td>
      </tr>
    `).join('')
    : '<tr><td colspan="6" class="p-3 text-center text-slate-500">මෙම වැඩසටහන සඳහා තවම අලුත්වැඩියා වාර්තා ඇතුළත් කර නොමැත.</td></tr>';
}

// 10. EXCEL EXPORT FUNCTIONS
function exportAssetsToExcel() {
  if (!currentFilteredAssets.length) return alert('Export කිරීමට දත්ත නොමැත.');
  const rows = currentFilteredAssets.map(a => ({
    School_Name: a.schools?.school_name || '',
    Census_No: a.schools?.census_no || '',
    Category: a.category,
    Inventory_No: a.inventory_no,
    Serial_No: a.serial_no || '',
    Brand_Model: a.brand_model || '',
    Location: a.location || '',
    Received_Year: a.received_year || '',
    Funding_Source: a.funding_source || '',
    Status: a.current_status,
    MB_Model: a.specs?.mb_model || a.specs?.['mb-model'] || '',
    MB_Chipset: a.specs?.mb_chipset || a.specs?.['mb-chipset'] || '',
    Processor: a.specs?.cpu || '',
    Processor_Gen: a.specs?.cpu_gen || a.specs?.['cpu-gen'] || '',
    RAM_Type: a.specs?.ram_type || a.specs?.['ram-type'] || '',
    RAM_Capacity: a.specs?.ram_cap || a.specs?.['ram-cap'] || '',
    Storage_Type: a.specs?.storage_type || a.specs?.['storage-type'] || '',
    Storage_Capacity: a.specs?.storage_cap || a.specs?.['storage-cap'] || '',
    Monitor: a.specs?.monitor || '',
    OS: a.specs?.os || ''
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Zonal_IT_Assets');
  XLSX.writeFile(wb, `Zonal_IT_Assets_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function exportTicketsToExcel() {
  if (!currentFilteredTickets.length) return alert('Export කිරීමට Tickets නොමැත.');
  const rows = currentFilteredTickets.map(t => ({
    Report_No: t.report_no,
    Reported_Date: new Date(t.reported_date).toLocaleDateString(),
    School: t.assets?.schools?.school_name || '',
    Category: t.assets?.category || '',
    Inventory_No: t.assets?.inventory_no || '',
    Fault_Description: t.fault_description,
    Event_Name: t.repair_events?.event_name || 'Standard Ticket',
    Assigned_To: t.assigned_tech_id ? (usersMap[t.assigned_tech_id]?.full_name || '') : '',
    Diagnosis: t.diagnosis || '',
    Action_Taken: t.action_taken || '',
    Parts_Replaced: t.parts_replaced || '',
    Final_Condition: t.final_condition || '',
    Status: t.repair_status
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Repair_Tickets');
  XLSX.writeFile(wb, `Repair_Tickets_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function exportEventReportToExcel() {
  if (!activeEventLogs.length) return alert('මෙම වැඩසටහන සඳහා Export කිරීමට වාර්තා නොමැත.');
  const schoolMap = {};
  activeEventLogs.forEach(l => {
    const s = l.assets?.schools?.school_name || 'Unknown';
    if (!schoolMap[s]) schoolMap[s] = { School: s, Total_Repaired_Items: 0, Completed: 0, Waiting_for_Parts: 0, Unrepairable: 0 };
    schoolMap[s].Total_Repaired_Items++;
    if (l.repair_status === 'Completed') schoolMap[s].Completed++;
    else if (l.repair_status === 'Unrepairable') schoolMap[s].Unrepairable++;
    else schoolMap[s].Waiting_for_Parts++;
  });

  const detailRows = activeEventLogs.map(l => ({
    Report_No: l.report_no,
    School: l.assets?.schools?.school_name || '',
    Category: l.assets?.category || '',
    Inventory_No: l.assets?.inventory_no || '',
    Serial_No: l.assets?.serial_no || '',
    Fault: l.fault_description,
    Action_Taken: l.action_taken || '',
    Parts_Replaced: l.parts_replaced || '',
    Final_Condition: l.final_condition || l.repair_status
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Object.values(schoolMap)), 'School_Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows), 'Detailed_Logs');
  const safeName = (activeEventObj?.event_name || 'Repair_Event').replace(/[^a-zA-Z0-9]/g, '_');
  XLSX.writeFile(wb, `${safeName}_Report.xlsx`);
}

// 11. OFFICIAL A4 PDF STATUS REPORT GENERATOR
async function openPdfReport(logId) {
  const { data: log, error } = await supabaseClient.from('maintenance_logs')
    .select('*, assets(*, schools(*)), repair_events(*)')
    .eq('log_id', logId)
    .single();

  if (error || !log) return alert('වාර්තා දත්ත ලබාගත නොහැක.');

  const asset = log.assets || {};
  const school = asset.schools || {};
  const specsEntries = Object.entries(asset.specs || {});
  const specsHtml = specsEntries.length
    ? specsEntries.map(([k, v]) => `<div class="border p-1.5 bg-slate-50"><span class="text-slate-500 uppercase text-[10px] block">${k.replace(/[_-]/g, ' ')}</span><b>${v}</b></div>`).join('')
    : '<p class="text-slate-500 text-xs">තාක්ෂණික පිරිවිතර ඇතුළත් කර නොමැත.</p>';

  let signers = [];
  if (log.event_id) {
    const { data: parts } = await supabaseClient.from('event_participants')
      .select('users(full_name, workplace, signature_url)')
      .eq('event_id', log.event_id)
      .eq('participated', true);
    signers = (parts || []).map(p => p.users).filter(Boolean);
  }
  if (!signers.length && log.assigned_tech_id && usersMap[log.assigned_tech_id]) {
    signers = [usersMap[log.assigned_tech_id]];
  }
  if (!signers.length) {
    signers = [currentUser];
  }

  const eventBanner = log.repair_events
    ? `<div class="border-2 border-slate-800 bg-slate-50 p-3 rounded">
         <p class="font-bold text-xs uppercase text-slate-600">අලුත්වැඩියා වැඩසටහනේ විස්තර (Repair Event Details)</p>
         <p class="font-bold text-base mt-0.5">${log.repair_events.event_name}</p>
         <p class="text-xs mt-0.5"><b>දිනය:</b> ${log.repair_events.event_date} &nbsp;|&nbsp; <b>ස්ථානය:</b> ${log.repair_events.venue_name} (${log.repair_events.venue_type})</p>
       </div>`
    : '';

  const signaturesGridHtml = signers.map(s => `
    <div class="border border-slate-400 rounded p-3 text-center flex flex-col justify-between min-h-[125px]">
      <div class="h-14 flex items-center justify-center">
        ${s.signature_url ? `<img src="${s.signature_url}" class="max-h-14 mx-auto object-contain" />` : '<span class="text-slate-300 text-xs italic">........................................</span>'}
      </div>
      <div class="border-t border-slate-300 pt-1.5 mt-1 text-xs">
        <p class="font-bold">${s.full_name || '-'}</p>
        <p class="text-[11px] text-slate-600">${s.workplace || 'Zonal Digital Education Technical Team'}</p>
      </div>
    </div>
  `).join('');

  const reportDate = log.completed_date ? new Date(log.completed_date).toLocaleDateString() : new Date().toLocaleDateString();

  document.getElementById('pdf-print-sheet').innerHTML = `
    <div class="border-b-2 border-slate-900 pb-3 flex justify-between items-end">
      <div>
        <h1 class="text-xl font-bold uppercase tracking-wide">පරිගණක / තොරතුරු තාක්ෂණ උපකරණ තත්ව වාර්තාව</h1>
        <p class="text-xs font-semibold text-slate-600">Zonal Digital Education Technical Team — IT Equipment Condition Report</p>
      </div>
      <div class="text-right text-xs">
        <p><b>වාර්තා අංකය:</b> ${log.report_no}</p>
        <p><b>දිනය:</b> ${reportDate}</p>
      </div>
    </div>

    ${eventBanner}

    <div class="space-y-1.5">
      <h2 class="font-bold text-xs uppercase bg-slate-800 text-white px-2.5 py-1">1. පාසලේ සහ උපකරණයේ තොරතුරු (School & Asset Identification)</h2>
      <table class="w-full border-collapse border border-slate-400 text-xs">
        <tr>
          <td class="border border-slate-400 p-2 bg-slate-50 w-1/4 font-semibold">පාසලේ නම:</td>
          <td class="border border-slate-400 p-2 font-bold" colspan="3">${school.school_name || '-'} (සංගණන අංකය: ${school.census_no || '-'})</td>
        </tr>
        <tr>
          <td class="border border-slate-400 p-2 bg-slate-50 font-semibold">උපකරණ වර්ගය:</td>
          <td class="border border-slate-400 p-2">${asset.category || '-'}</td>
          <td class="border border-slate-400 p-2 bg-slate-50 font-semibold w-1/4">Brand / Model:</td>
          <td class="border border-slate-400 p-2">${asset.brand_model || '-'}</td>
        </tr>
        <tr>
          <td class="border border-slate-400 p-2 bg-slate-50 font-semibold">Inventory අංකය:</td>
          <td class="border border-slate-400 p-2 font-bold">${asset.inventory_no || '-'}</td>
          <td class="border border-slate-400 p-2 bg-slate-50 font-semibold">Serial Number:</td>
          <td class="border border-slate-400 p-2 font-bold">${asset.serial_no || '-'}</td>
        </tr>
      </table>
    </div>

    <div class="space-y-1.5">
      <h2 class="font-bold text-xs uppercase bg-slate-800 text-white px-2.5 py-1">2. තාක්ෂණික පිරිවිතර (Hardware Specifications)</h2>
      <div class="grid grid-cols-3 gap-2 text-xs">${specsHtml}</div>
    </div>

    <div class="space-y-1.5">
      <h2 class="font-bold text-xs uppercase bg-slate-800 text-white px-2.5 py-1">3. දෝෂය සහ අලුත්වැඩියා විස්තර (Fault & Maintenance Summary)</h2>
      <table class="w-full border-collapse border border-slate-400 text-xs">
        <tr>
          <td class="border border-slate-400 p-2 bg-slate-50 w-1/3 font-semibold">වාර්තා වූ දෝෂය (Reported Fault):</td>
          <td class="border border-slate-400 p-2">${log.fault_description || '-'}</td>
        </tr>
        <tr>
          <td class="border border-slate-400 p-2 bg-slate-50 font-semibold">හඳුනාගත් දෝෂය (Technical Diagnosis):</td>
          <td class="border border-slate-400 p-2">${log.diagnosis || '-'}</td>
        </tr>
        <tr>
          <td class="border border-slate-400 p-2 bg-slate-50 font-semibold">සිදුකළ අලුත්වැඩියාව (Action Taken):</td>
          <td class="border border-slate-400 p-2">${log.action_taken || '-'}</td>
        </tr>
        <tr>
          <td class="border border-slate-400 p-2 bg-slate-50 font-semibold">මාරු කළ කොටස් (Parts Replaced):</td>
          <td class="border border-slate-400 p-2">${log.parts_replaced || 'නැත'}</td>
        </tr>
        <tr>
          <td class="border border-slate-400 p-2 bg-slate-50 font-semibold">අලුත්වැඩියාවෙන් පසු තත්ත්වය (Final Condition):</td>
          <td class="border border-slate-400 p-2 font-bold text-base">${log.final_condition || log.repair_status}</td>
        </tr>
      </table>
    </div>

    <div class="space-y-2 pt-2">
      <h2 class="font-bold text-xs uppercase bg-slate-800 text-white px-2.5 py-1">4. තාක්ෂණික නිලධාරීන්ගේ සහතික කිරීම (Certification & Signatures)</h2>
      <p class="text-xs text-slate-600">ඉහත සඳහන් උපකරණය පරීක්ෂා කර අදාළ තාක්ෂණික කටයුතු සිදුකළ බවට මෙයින් සහතික කරමු.</p>
      <div class="grid grid-cols-2 md:grid-cols-3 gap-3 pt-1">${signaturesGridHtml}</div>
    </div>
  `;

  document.getElementById('pdf-modal').classList.remove('hidden');
}

// 12. EXCEL BULK UPLOAD (TEMPLATE DOWNLOAD + VALIDATION + POST-UPLOAD BATCH QR)
function downloadExcelTemplate() {
  const sampleRows = [
    {
      category: 'Desktop', inventory_no: 'INV-2026-001', serial_no: 'SN-DELL-001', brand_model: 'Dell Optiplex 3020',
      location: 'IT Lab 1', received_year: 2023, funding_source: 'Ministry', current_status: 'Working',
      mb_model: 'Dell 0WMJ54', mb_chipset: 'H81', processor: 'Intel Core i3', processor_gen: '4th Gen',
      ram_type: 'DDR3', ram_capacity: '8GB', storage_type: 'SATA SSD', storage_capacity: '256GB', monitor: 'LED 19"', os: 'Windows 10'
    },
    {
      category: 'Projector', inventory_no: 'INV-2026-002', serial_no: 'SN-EPS-002', brand_model: 'Epson EB-X41',
      location: 'Smart Classroom', received_year: 2024, funding_source: 'Provincial', current_status: 'Working',
      mb_model: '', mb_chipset: '', processor: '', processor_gen: '',
      ram_type: '', ram_capacity: '', storage_type: '', storage_capacity: '', monitor: '', os: ''
    }
  ];

  const instructions = [
    { Field: 'category (Required)', Allowed_Values: 'Desktop, Laptop, All-in-One, Projector, Smart Panel, Printer, UPS' },
    { Field: 'inventory_no (Required)', Allowed_Values: 'පාසලේ බඩු වට්ටෝරු අංකය (උදා: INV-001)' },
    { Field: 'serial_no', Allowed_Values: 'උපකරණයේ Serial Number එක' },
    { Field: 'current_status', Allowed_Values: 'Working, Faulty, Under Repair, Waiting for Parts, Condemned' },
    { Field: 'ram_type', Allowed_Values: 'DDR2, DDR3, DDR3L, DDR4, DDR5' },
    { Field: 'storage_type', Allowed_Values: 'HDD, SATA SSD, NVMe SSD' }
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sampleRows), 'Assets_Upload');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(instructions), 'Instructions');
  XLSX.writeFile(wb, 'Zonal_IT_Assets_Bulk_Template.xlsx');
}

function handleBulkFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  document.getElementById('bulk-success-qr-banner').classList.add('hidden');

  const reader = new FileReader();
  reader.onload = (evt) => {
    const wb = XLSX.read(evt.target.result, { type: 'binary' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    parsedBulkRows = [];
    const tbody = document.getElementById('bulk-preview-body');
    tbody.innerHTML = '';
    let validCount = 0;

    const validCategories = ['Desktop', 'Laptop', 'All-in-One', 'Projector', 'Smart Panel', 'Printer', 'UPS'];

    rows.forEach(r => {
      const cat = String(r.category || '').trim();
      const inv = String(r.inventory_no || '').trim();
      const isValid = validCategories.includes(cat) && inv.length > 0;

      if (isValid) {
        validCount++;
        const specs = {};
        if (r.mb_model) specs.mb_model = String(r.mb_model);
        if (r.mb_chipset) specs.mb_chipset = String(r.mb_chipset);
        if (r.processor) specs.cpu = String(r.processor);
        if (r.processor_gen) specs.cpu_gen = String(r.processor_gen);
        if (r.ram_type) specs.ram_type = String(r.ram_type);
        if (r.ram_capacity) specs.ram_cap = String(r.ram_capacity);
        if (r.storage_type) specs.storage_type = String(r.storage_type);
        if (r.storage_capacity) specs.storage_cap = String(r.storage_capacity);
        if (r.monitor) specs.monitor = String(r.monitor);
        if (r.os) specs.os = String(r.os);

        parsedBulkRows.push({
          school_id: document.getElementById('bulk-school').value,
          category: cat,
          inventory_no: inv,
          serial_no: r.serial_no ? String(r.serial_no).trim() : null,
          brand_model: r.brand_model ? String(r.brand_model).trim() : null,
          location: r.location ? String(r.location).trim() : null,
          received_year: parseInt(r.received_year) || null,
          funding_source: r.funding_source ? String(r.funding_source).trim() : null,
          current_status: r.current_status ? String(r.current_status).trim() : 'Working',
          specs
        });
      }

      tbody.innerHTML += `<tr>
        <td class="p-2">${cat || '-'}</td><td class="p-2">${inv || '-'}</td>
        <td class="p-2">${r.serial_no || '-'}</td><td class="p-2">${r.brand_model || '-'}</td>
        <td class="p-2">${r.mb_chipset || ''} / ${r.processor || ''} / ${r.ram_capacity || ''}</td>
        <td class="p-2 ${isValid ? 'text-green-600' : 'text-red-600'} font-semibold">${isValid ? 'OK' : 'Invalid Category/Inv'}</td>
      </tr>`;
    });

    document.getElementById('bulk-status-msg').textContent = `මුළු පේළි: ${rows.length} | නිවැරදි පේළි: ${validCount}`;
    document.getElementById('bulk-preview-container').classList.remove('hidden');
  };
  reader.readAsBinaryString(file);
}

async function confirmBulkUpload() {
  if (!parsedBulkRows.length) return alert('ඇතුළත් කිරීමට නිවැරදි දත්ත නොමැත.');
  const { data, error } = await supabaseClient.from('assets').insert(parsedBulkRows).select('*, schools(school_name, census_no)');
  if (error) return alert('Bulk Upload දෝෂය: ' + error.message);

  lastBulkUploadedAssets = data || [];
  document.getElementById('bulk-preview-container').classList.add('hidden');
  document.getElementById('bulk-file').value = '';
  document.getElementById('bulk-success-text').textContent = `✅ උපකරණ ${lastBulkUploadedAssets.length}ක් සාර්ථකව Database එකට ඇතුළත් කරන ලදී!`;
  document.getElementById('bulk-success-qr-banner').classList.remove('hidden');
  await loadAssets();
}

// 13. DIGITAL SIGNATURE PAD & PROFILE UPDATE
let sigCanvas, sigCtx, drawing = false;
function initSignaturePad() {
  sigCanvas = document.getElementById('sig-canvas');
  sigCtx = sigCanvas.getContext('2d');
  sigCtx.lineWidth = 2; sigCtx.lineCap = 'round'; sigCtx.strokeStyle = '#0f172a';

  const getPos = (e) => {
    const rect = sigCanvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: (clientX - rect.left) * (sigCanvas.width / rect.width), y: (clientY - rect.top) * (sigCanvas.height / rect.height) };
  };

  const start = (e) => { drawing = true; const p = getPos(e); sigCtx.beginPath(); sigCtx.moveTo(p.x, p.y); };
  const move = (e) => { if (!drawing) return; e.preventDefault(); const p = getPos(e); sigCtx.lineTo(p.x, p.y); sigCtx.stroke(); };
  const end = () => { drawing = false; };

  sigCanvas.addEventListener('mousedown', start); sigCanvas.addEventListener('mousemove', move); window.addEventListener('mouseup', end);
  sigCanvas.addEventListener('touchstart', start); sigCanvas.addEventListener('touchmove', move); window.addEventListener('touchend', end);
}

function clearSignature() { sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height); }

async function saveProfile() {
  let signature_url = currentUser.signature_url;
  const blob = await new Promise(res => sigCanvas.toBlob(res, 'image/png'));
  if (blob) {
    const filePath = `${currentUser.user_id}.png`;
    const { error: upErr } = await supabaseClient.storage.from('signatures').upload(filePath, blob, { upsert: true });
    if (!upErr) {
      const { data } = supabaseClient.storage.from('signatures').getPublicUrl(filePath);
      signature_url = data.publicUrl + '?t=' + Date.now();
    }
  }

  const { error } = await supabaseClient.from('users').update({
    full_name: document.getElementById('prof-name').value,
    workplace: document.getElementById('prof-workplace').value,
    signature_url
  }).eq('user_id', currentUser.user_id);

  if (error) return alert('Error: ' + error.message);
  alert('Profile සහ ඩිජිටල් අත්සන සාර්ථකව සුරැකුණි!');
  await loadUserProfile(currentUser.user_id);
}
