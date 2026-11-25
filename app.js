// app.js
let currentUser = null;
let allAssets = [];
let currentFilteredAssets = [];
let currentFilteredTickets = [];
let allUsers = [];
let allSchools = [];
let usersMap = {};
let parsedBulkRows = [];
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
    document.getElementById('btn-toggle-event-form').classList.remove('hidden');
    document.getElementById('ws-assign-bar').classList.remove('hidden');
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

  renderSpecFields();
  await loadUsers();
  await loadSchools();
  await loadAssets();
  await loadTickets();
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
function renderSpecFields() {
  const cat = document.getElementById('asset-category').value;
  const container = document.getElementById('dynamic-specs');
  let html = '';

  if (['Desktop', 'Laptop', 'All-in-One'].includes(cat)) {
    html = `
      <input id="sp-mb-model" placeholder="Motherboard Brand/Model" class="px-3 py-2 border rounded-lg text-sm">
      <input id="sp-mb-chipset" placeholder="Motherboard Chipset (H61, H81, H110...)" class="px-3 py-2 border rounded-lg text-sm">
      <input id="sp-cpu" placeholder="Processor Model (Core i3, i5...)" class="px-3 py-2 border rounded-lg text-sm">
      <input id="sp-cpu-gen" placeholder="Processor Gen (4th Gen, 10th Gen...)" class="px-3 py-2 border rounded-lg text-sm">
      <select id="sp-ram-type" class="px-3 py-2 border rounded-lg text-sm">
        <option value="">RAM Type</option><option>DDR2</option><option>DDR3</option><option>DDR3L</option><option>DDR4</option><option>DDR5</option>
      </select>
      <input id="sp-ram-cap" placeholder="RAM Capacity (4GB, 8GB, 16GB)" class="px-3 py-2 border rounded-lg text-sm">
      <select id="sp-storage-type" class="px-3 py-2 border rounded-lg text-sm">
        <option value="">Storage Type</option><option>HDD</option><option>SATA SSD</option><option>NVMe SSD</option>
      </select>
      <input id="sp-storage-cap" placeholder="Storage Capacity (256GB, 500GB, 1TB)" class="px-3 py-2 border rounded-lg text-sm">
      <input id="sp-monitor" placeholder="Monitor වර්ගය & ප්‍රමාණය (LED 19)" class="px-3 py-2 border rounded-lg text-sm">
      <input id="sp-os" placeholder="OS (Windows 10/11, Ubuntu)" class="px-3 py-2 border rounded-lg text-sm">
    `;
  } else if (cat === 'Projector') {
    html = `
      <select id="sp-proj-tech" class="px-3 py-2 border rounded-lg text-sm"><option value="LCD">LCD</option><option value="DLP">DLP</option></select>
      <input id="sp-proj-res" placeholder="Resolution (XGA, Full HD)" class="px-3 py-2 border rounded-lg text-sm">
      <input id="sp-proj-lumens" placeholder="Brightness (Lumens)" class="px-3 py-2 border rounded-lg text-sm">
      <input id="sp-proj-lamp" placeholder="Lamp Hours / Status" class="px-3 py-2 border rounded-lg text-sm">
    `;
  } else if (cat === 'Smart Panel') {
    html = `
      <input id="sp-sp-size" placeholder="Screen Size (65, 75, 86 inch)" class="px-3 py-2 border rounded-lg text-sm">
      <input id="sp-sp-android" placeholder="Android OS Version" class="px-3 py-2 border rounded-lg text-sm">
      <input id="sp-sp-ops" placeholder="Windows OPS Specs (තිබේ නම්)" class="px-3 py-2 border rounded-lg text-sm">
    `;
  } else if (cat === 'Printer') {
    html = `
      <select id="sp-pr-type" class="px-3 py-2 border rounded-lg text-sm"><option>Ink Tank</option><option>Laser</option><option>Dot Matrix</option></select>
      <select id="sp-pr-color" class="px-3 py-2 border rounded-lg text-sm"><option>Color</option><option>Monochrome</option></select>
      <input id="sp-pr-conn" placeholder="Connectivity (USB / Wi-Fi / LAN)" class="px-3 py-2 border rounded-lg text-sm">
    `;
  } else if (cat === 'UPS') {
    html = `
      <input id="sp-ups-cap" placeholder="Capacity (650VA, 1200VA, 2kVA)" class="px-3 py-2 border rounded-lg text-sm">
      <input id="sp-ups-batt" placeholder="Battery Status / අවසන් මාරු කළ දිනය" class="px-3 py-2 border rounded-lg text-sm">
    `;
  }
  container.innerHTML = html;
}

document.getElementById('asset-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const specs = {};
  document.querySelectorAll('#dynamic-specs input, #dynamic-specs select').forEach(el => {
    if (el.value) specs[el.id.replace('sp-', '')] = el.value;
  });

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
  renderSpecFields();
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
      datasets: [{
        label: 'උපකරණ ගණන',
        data: catCounts,
        backgroundColor: '#2563eb',
        borderRadius: 6
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
  });

  if (statusChartInstance) statusChartInstance.destroy();
  statusChartInstance = new Chart(document.getElementById('chart-status'), {
    type: 'doughnut',
    data: {
      labels: ['Working', 'Faulty / Under Repair', 'Condemned'],
      datasets: [{
        data: [workingCount, faultyCount, condemnedCount],
        backgroundColor: ['#16a34a', '#d97706', '#dc2626']
      }]
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
      <td class="p-2 font-medium">${a.schools?.school_name || '-'}</td>
      <td class="p-2">${a.category}</td>
      <td class="p-2 text-xs"><b>${a.inventory_no}</b><br><span class="text-slate-500">SN: ${a.serial_no || '-'}</span></td>
      <td class="p-2 text-xs text-slate-600">${Object.entries(a.specs || {}).map(([k,v]) => `${k}: ${v}`).join(', ') || '-'}</td>
      <td class="p-2"><span class="px-2 py-0.5 rounded-full text-xs ${statusColor(a.current_status)}">${a.current_status}</span></td>
      <td class="p-2 space-x-1 whitespace-nowrap">
        <button onclick="openQrModal('${a.asset_id}')" class="bg-slate-800 text-white px-2 py-1 rounded text-xs">QR</button>
        <button onclick="openAssetDetail('${a.asset_id}')" class="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs font-medium">Details</button>
        <button onclick="openFaultModal('${a.asset_id}')" class="bg-amber-100 text-amber-800 px-2 py-1 rounded text-xs font-medium">🔧 Fault</button>
      </td>
    </tr>
  `).join('');
}

// 5. QR CODE GENERATION & SCANNER


function openQrModal(assetId) {
  const a = allAssets.find(x => x.asset_id === assetId);
  if (!a) return;

  document.getElementById('qr-school-name').textContent = a.schools?.school_name || '';
  document.getElementById('qr-asset-info').textContent = `${a.category} | ${a.inventory_no}`;

  let serialEl = document.getElementById('qr-serial-no');
  if (!serialEl) {
    serialEl = document.createElement('p');
    serialEl.id = 'qr-serial-no';
    serialEl.className = 'text-xs font-semibold text-slate-700 mt-0.5';
    document.getElementById('qr-asset-info').after(serialEl);
  }
  serialEl.textContent = `S/N: ${a.serial_no || 'N/A'}`;

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
  if (!win) return alert('Popup blocker නිසා Print කවුළුව විවෘත නොවීය. කරුණාකර Popups Allow කරන්න.');

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

// 6. REPAIR TICKETING & ASSIGNMENT
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

// 7. REPAIR EVENTS MANAGEMENT & EVENT WORKSPACE
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

// 8. EXCEL EXPORT FUNCTIONS (ASSETS, TICKETS & EVENT SUMMARY)
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
    MB_Chipset: a.specs?.['mb-chipset'] || a.specs?.mb_chipset || '',
    Processor: a.specs?.cpu || '',
    Processor_Gen: a.specs?.['cpu-gen'] || a.specs?.cpu_gen || '',
    RAM_Type: a.specs?.['ram-type'] || a.specs?.ram_type || '',
    RAM_Capacity: a.specs?.['ram-cap'] || a.specs?.ram_cap || '',
    Storage_Type: a.specs?.['storage-type'] || a.specs?.storage_type || '',
    Storage_Capacity: a.specs?.['storage-cap'] || a.specs?.storage_cap || '',
    Monitor: a.specs?.monitor || ''
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

// 9. OFFICIAL A4 PDF STATUS REPORT GENERATOR
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
    ? specsEntries.map(([k, v]) => `<div class="border p-1.5 bg-slate-50"><span class="text-slate-500 uppercase text-[10px] block">${k.replace(/_/g, ' ')}</span><b>${v}</b></div>`).join('')
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

// 10. EXCEL BULK UPLOAD
function downloadExcelTemplate() {
  const sample = [{
    category: 'Desktop', inventory_no: 'INV-001', serial_no: 'SN12345', brand_model: 'Dell Optiplex 3020',
    location: 'IT Lab 1', received_year: 2023, funding_source: 'Ministry', current_status: 'Working',
    mb_chipset: 'H81', processor: 'Intel Core i3', processor_gen: '4th Gen',
    ram_type: 'DDR3', ram_capacity: '8GB', storage_type: 'SATA SSD', storage_capacity: '256GB', monitor: 'LED 19"'
  }];
  const ws = XLSX.utils.json_to_sheet(sample);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Assets_Template');
  XLSX.writeFile(wb, 'Zonal_IT_Assets_Template.xlsx');
}

function handleBulkFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    const wb = XLSX.read(evt.target.result, { type: 'binary' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    parsedBulkRows = [];
    const tbody = document.getElementById('bulk-preview-body');
    tbody.innerHTML = '';
    let validCount = 0;

    rows.forEach(r => {
      const isValid = r.category && r.inventory_no;
      if (isValid) {
        validCount++;
        parsedBulkRows.push({
          school_id: document.getElementById('bulk-school').value,
          category: r.category,
          inventory_no: String(r.inventory_no),
          serial_no: r.serial_no ? String(r.serial_no) : null,
          brand_model: r.brand_model || null,
          location: r.location || null,
          received_year: parseInt(r.received_year) || null,
          funding_source: r.funding_source || null,
          current_status: r.current_status || 'Working',
          specs: {
            mb_chipset: r.mb_chipset || '', cpu: r.processor || '', cpu_gen: r.processor_gen || '',
            ram_type: r.ram_type || '', ram_cap: r.ram_capacity || '',
            storage_type: r.storage_type || '', storage_cap: r.storage_capacity || '', monitor: r.monitor || ''
          }
        });
      }
      tbody.innerHTML += `<tr>
        <td class="p-2">${r.category || '-'}</td><td class="p-2">${r.inventory_no || '-'}</td>
        <td class="p-2">${r.serial_no || '-'}</td><td class="p-2">${r.brand_model || '-'}</td>
        <td class="p-2">${r.mb_chipset || ''} / ${r.processor || ''} / ${r.ram_capacity || ''}</td>
        <td class="p-2 ${isValid ? 'text-green-600' : 'text-red-600'} font-semibold">${isValid ? 'OK' : 'Missing Fields'}</td>
      </tr>`;
    });

    document.getElementById('bulk-status-msg').textContent = `මුළු පේළි: ${rows.length} | නිවැරදි පේළි: ${validCount}`;
    document.getElementById('bulk-preview-container').classList.remove('hidden');
  };
  reader.readAsBinaryString(file);
}

async function confirmBulkUpload() {
  if (!parsedBulkRows.length) return alert('ඇතුළත් කිරීමට නිවැරදි දත්ත නොමැත.');
  const { error } = await supabaseClient.from('assets').insert(parsedBulkRows);
  if (error) return alert('Bulk Upload දෝෂය: ' + error.message);
  alert(`උපකරණ ${parsedBulkRows.length}ක් සාර්ථකව ඇතුළත් කරන ලදී!`);
  document.getElementById('bulk-preview-container').classList.add('hidden');
  document.getElementById('bulk-file').value = '';
  await loadAssets();
}

// 11. DIGITAL SIGNATURE PAD & PROFILE UPDATE
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
