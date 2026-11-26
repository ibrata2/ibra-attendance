// مدير بصمة IBRA — تطبيق الايفون
window.addEventListener('error', (e) => { try { const t = document.getElementById('toast'); t.textContent = '⚠️ ' + (e.message || 'خطأ'); t.classList.remove('hidden'); } catch (x) {} });
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KEY = 'ibra_mgr_v1';
  const Cap = window.Capacitor;
  const native = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  let LN = null;
  try {
    const reg = (window.capacitorExports && window.capacitorExports.registerPlugin) || (Cap && Cap.registerPlugin);
    if (native && reg) LN = reg('LocalNotifications');
    else if (native && Cap.Plugins && Cap.Plugins.LocalNotifications) LN = Cap.Plugins.LocalNotifications;
  } catch (e) { LN = null; }

  let db = load();
  let tab = 'live', branchFilter = 'all', salaryYm = L.dateStr(Date.now()).slice(0, 7), openEmp = null, busy = false, lastOk = 0, syncErr = '';

  function load() {
    try { return Object.assign(blank(), JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { return blank(); }
  }
  function blank() { return { cfg: null, lastSrv: 0, lastNotified: 0, employees: {}, punches: {}, days: {}, settings: {}, notify: true, pin: '' }; }
  function save() {
    // الصور المصغرة نخليها لآخر 10 أيام حتى ما تمتلي ذاكرة التطبيق
    const cut = Date.now() - 10 * 864e5;
    for (const p of Object.values(db.punches)) if (p.thumb && p.ts < cut) delete p.thumb;
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {
      for (const p of Object.values(db.punches)) delete p.thumb;
      try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e2) {}
    }
  }
  const S = () => Object.assign({}, L.DEFAULT_SETTINGS, (db.settings.main || {}));
  const ctx = () => ({ settings: S(), punches: db.punches, days: db.days });
  const emps = () => Object.values(db.employees).filter(e => !e._del && e.active !== false).sort((a, b) => String(a.name).localeCompare(b.name, 'ar'));
  const money = (n) => `${Math.round(n || 0).toLocaleString('en-US')} ${S().currency || 'د.ع'}`;
  const empName = (p) => (db.employees[p.empId] || {}).name || p.empName || 'موظف';
  const branches = () => [...new Set(Object.values(db.punches).map(p => p.branch).filter(Boolean))];

  function toast(t) { const el = $('toast'); el.textContent = t; el.classList.remove('hidden'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.add('hidden'), 3500); }

  // ===== المزامنة =====
  const authH = (key) => { const h = { apikey: key }; if (/^eyJ/.test(key)) h.Authorization = 'Bearer ' + key; return h; };
  const H = () => authH(db.cfg.key);
  const base = () => db.cfg.url.replace(/\/+$/, '');
  async function pull(first) {
    if (!db.cfg || busy) return;
    busy = true; setSub('جاري التحديث…');
    try {
      const fresh = [];
      for (;;) {
        const url = `${base()}/rest/v1/att_sync?select=coll,id,data,updated_at,deleted,srv&workspace=eq.${encodeURIComponent(db.cfg.ws)}&coll=in.(employees,punches,days,settings)&srv=gt.${db.lastSrv}&order=srv.asc&limit=500`;
        const res = await fetch(url, { headers: H() });
        if (!res.ok) throw new Error('فشل الاتصال (' + res.status + ')');
        const rows = await res.json();
        for (const r of rows) {
          db.lastSrv = Math.max(db.lastSrv, Number(r.srv));
          const d = Object.assign({}, r.data || {}, { _u: Number(r.updated_at), _del: !!r.deleted });
          if (r.coll === 'employees') { delete d.descriptors; db.employees[r.id] = d; }
          else if (r.coll === 'punches') { db.punches[r.id] = d; if (!r.deleted && !d.edited) fresh.push({ srv: Number(r.srv), p: d }); }
          else if (r.coll === 'days') db.days[r.id] = d;
          else if (r.coll === 'settings') { delete d.adminHash; db.settings[r.id] = d; }
        }
        if (rows.length < 500) break;
      }
      lastOk = Date.now(); syncErr = '';
      if (first) db.lastNotified = db.lastSrv;
      else notifyNew(fresh);
      save();
      tellRunner(false);
      render();
    } catch (e) { syncErr = e.message || String(e); }
    finally { busy = false; setSub(); }
  }
  function setSub(t) {
    $('hdrSub').textContent = t || (syncErr ? '⚠️ ' + syncErr : lastOk ? 'آخر تحديث ' + L.timeText(lastOk) : 'حضور وانصراف الموظفين');
  }
  function noteText(p) {
    const d = new Date(p.ts);
    let body = `${p.branch || 'الفرع الرئيسي'} • الساعة ${L.timeText(p.ts)} • ${L.DAY_NAMES[d.getDay()]} ${L.dateStr(p.ts)}`;
    if (p.type === 'in' && p.lateMin > S().graceIn) body += ` • متأخر ${L.durText(p.lateMin)}`;
    return { title: `${p.type === 'in' ? '✅' : '👋'} ${empName(p)} ${p.type === 'in' ? 'سجّل حضور' : 'سجّل انصراف'}`, body };
  }
  async function notifyNew(fresh) {
    const list = fresh.filter(x => x.srv > db.lastNotified && Date.now() - x.p.ts < 36 * 3600e3);
    if (fresh.length) db.lastNotified = Math.max(db.lastNotified, ...fresh.map(x => x.srv));
    if (!list.length || !db.notify) return;
    const last = list[list.length - 1].p, n = noteText(last);
    toast(n.title + ' — ' + n.body + (list.length > 1 ? ` (+${list.length - 1})` : ''));
    if (LN) {
      try { await LN.schedule({ notifications: list.slice(-10).map(x => { const t = noteText(x.p); return { id: x.srv % 2000000000, title: t.title, body: t.body, threadIdentifier: 'punches' }; }) }); } catch (e) {}
    }
  }
  function tellRunner() {}
  async function askNotify() {
    if (LN) { try { await LN.requestPermissions(); } catch (e) {} }
  }

  // ===== الشاشات =====
  function render() {
    document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $('nav').classList.toggle('hidden', !db.cfg);
    if (!db.cfg) return renderSetup();
    ({ live: renderLive, today: renderToday, salary: renderSalary, settings: renderSettings })[tab]();
  }
  function branchChips() {
    const bs = branches(); if (bs.length < 2) return '';
    return `<div class="chips"><button data-b="all" class="${branchFilter === 'all' ? 'on' : ''}">كل الفروع</button>${bs.map(b => `<button data-b="${esc(b)}" class="${branchFilter === b ? 'on' : ''}">${esc(b)}</button>`).join('')}</div>`;
  }
  function bindChips() { document.querySelectorAll('[data-b]').forEach(b => b.onclick = () => { branchFilter = b.dataset.b; render(); }); }
  function bindPhotos() { document.querySelectorAll('[data-photo]').forEach(im => im.onclick = () => { const o = document.createElement('div'); o.className = 'overlay'; o.innerHTML = `<img src="${im.src}">`; o.onclick = () => o.remove(); document.body.appendChild(o); }); }

  function renderSetup() {
    $('main').innerHTML = `<div class="card" style="margin-top:8px">
      <div class="about"><img src="icon.png"><h2 style="color:var(--gold2);margin:10px 0 4px">ربط تطبيق المدير</h2>
      <p style="color:var(--muted);margin:0 0 14px">اربط مرة وحدة بس، وبعدها يوصلك سجل الحضور من كل الفروع</p></div>
      <button class="btn" id="scan" style="font-size:18px;padding:16px">📷 مسح رمز الربط</button>
      <div class="row" style="margin-top:10px"><button class="btn ghost" id="pick">🖼️ من صورة</button><button class="btn ghost" id="pasteShow">⌨️ لصق الكود</button></div>
      <div id="pasteBox" class="hidden" style="margin-top:12px"><div class="field"><textarea id="code" rows="4" dir="ltr" placeholder="IBRA1:..."></textarea></div><button class="btn" id="link">ربط</button></div>
      <input type="file" id="file" accept="image/*" class="hidden">
      <p id="err" style="color:var(--bad);text-align:center"></p></div>
      <div class="card"><h3 style="margin:0 0 8px;color:var(--gold2)">📖 طريقة الربط</h3>
        <ol class="steps">
          <li>على الحاسبة افتح برنامج <b>بصمة IBRA</b> ← <b>الإعدادات</b>.</li>
          <li>لازم البرنامج يكون <b>مربوط بالسحابة</b> (قسم ☁️ الربط بالسحابة — بيه شرح كامل). بدون ربط البرنامج يشتغل أوفلاين على الحاسبة بس.</li>
          <li>بقسم <b>📱 ربط تطبيق المدير</b> يطلع مربع QR.</li>
          <li>هنا اضغط <b>📷 مسح رمز الربط</b> ووجّه الكاميرا على المربع.</li>
          <li>وافق على الإشعارات — يوصلك إشعار بكل بصمة حضور وانصراف مع اسم الموظف والفرع والوقت.</li>
        </ol>
        <p style="color:var(--muted);font-size:12.5px;margin:0">الكاميرا ما تشتغل؟ صوّر المربع واختار <b>من صورة</b>، أو انسخ الكود من الحاسبة واختار <b>لصق الكود</b>.</p></div>`;
    $('scan').onclick = () => startScan();
    $('pasteShow').onclick = () => { $('pasteBox').classList.toggle('hidden'); $('code').focus(); };
    $('link').onclick = () => linkWith($('code').value);
    $('pick').onclick = () => $('file').click();
    $('file').onchange = async () => {
      const f = $('file').files[0]; if (!f) return;
      const img = new Image(); img.src = URL.createObjectURL(f);
      await img.decode().catch(() => {});
      const txt = decodeFromSource(img, img.naturalWidth, img.naturalHeight);
      if (txt) linkWith(txt); else $('err').textContent = 'ما لكيت رمز QR بالصورة — صوّره أقرب وبوضوح';
      $('file').value = '';
    };
  }
  function decodeFromSource(src, w, h) {
    if (!w || !h) return null;
    const max = 1000, k = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(src, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height);
    const r = window.jsQR && jsQR(d.data, d.width, d.height, { inversionAttempts: 'attemptBoth' });
    return r && r.data ? r.data : null;
  }
  let scanStream = null;
  async function startScan() {
    const ov = document.createElement('div'); ov.className = 'scan';
    ov.innerHTML = `<video id="sv" playsinline autoplay muted></video><div class="scan-frame"></div>
      <div class="scan-msg" id="smsg">وجّه الكاميرا على رمز QR بشاشة الحاسبة</div><button class="btn ghost scan-x" id="sx">إلغاء</button>`;
    document.body.appendChild(ov);
    let done = false;
    const stop = () => { done = true; if (scanStream) scanStream.getTracks().forEach(t => t.stop()); scanStream = null; ov.remove(); };
    ov.querySelector('#sx').onclick = stop;
    try {
      scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
    } catch (e) {
      stop(); $('err').textContent = 'ما كدرنا نفتح الكاميرا. من إعدادات الايفون ← مدير بصمة IBRA ← فعّل الكاميرا، أو استخدم "من صورة".'; return;
    }
    const v = ov.querySelector('#sv'); v.srcObject = scanStream; await v.play().catch(() => {});
    const loop = () => {
      if (done) return;
      if (v.readyState >= 2) {
        const txt = decodeFromSource(v, v.videoWidth, v.videoHeight);
        if (txt) {
          if (txt.startsWith('IBRA1:')) { if (navigator.vibrate) navigator.vibrate(80); stop(); linkWith(txt); return; }
          ov.querySelector('#smsg').textContent = 'هذا مو رمز ربط بصمة IBRA';
        }
      }
      setTimeout(loop, 180);
    };
    loop();
  }
  async function linkWith(raw) {
    raw = String(raw || '').trim();
    $('err').textContent = '';
    try {
      if (!raw.startsWith('IBRA1:')) throw new Error('الكود غير صحيح');
      let c; try { c = JSON.parse(decodeURIComponent(escape(atob(raw.slice(6).trim())))); } catch (e) { throw new Error('الكود غير صحيح'); }
      if (!c.url || !c.key || !c.ws) throw new Error('الكود ناقص');
      toast('⏳ جاري الربط…');
      const t = await fetch(c.url.replace(/\/+$/, '') + '/rest/v1/att_sync?select=id&limit=1', { headers: authH(c.key) }).catch(() => null);
      if (!t) throw new Error('ما كو إنترنت — تأكد من الاتصال وجرب مرة ثانية');
      if (!t.ok) throw new Error('تعذر الاتصال بالسحابة (' + t.status + ')');
      db = Object.assign(blank(), { cfg: c, notify: true }); save();
      await askNotify();
      await pull(true);
      toast('✅ تم الربط — ' + emps().length + ' موظف'); tab = 'live'; render();
    } catch (e) { if ($('err')) $('err').textContent = e.message || 'الكود غير صحيح'; toast('❌ ' + (e.message || 'فشل الربط')); }
  }

  function renderLive() {
    const list = Object.values(db.punches).filter(p => !p._del && (branchFilter === 'all' || p.branch === branchFilter)).sort((a, b) => b.ts - a.ts).slice(0, 300);
    let html = branchChips(), lastDay = '';
    if (!list.length) html += '<div class="empty">لا توجد بصمات بعد</div>';
    for (const p of list) {
      if (p.date !== lastDay) { lastDay = p.date; html += `<div class="day-h">${L.DAY_NAMES[L.weekday(p.date)]} ${p.date}</div>`; }
      const late = p.type === 'in' && p.lateMin > S().graceIn;
      const emp = db.employees[p.empId] || {};
      html += `<div class="feed"><img ${p.thumb || emp.photo ? 'data-photo' : ''} src="${p.thumb || emp.photo || 'icon.png'}">
        <div class="t"><b>${esc(empName(p))}</b>
          <div class="sub">${p.type === 'in' ? '<span class="tag ok">حضور</span>' : '<span class="tag warn">انصراف</span>'} ${late ? `<span class="tag bad">متأخر ${L.durText(p.lateMin)}</span>` : ''} ${p.flags && p.flags.early ? `<span class="tag warn">مبكر ${L.durText(p.flags.early)}</span>` : ''}</div>
          <div class="sub">📍 ${esc(p.branch || 'الفرع الرئيسي')}${p.manual ? ' • ✎ يدوي' : ''}${p.reason ? ' • ' + esc(p.reason) : ''}</div></div>
        <div class="tm">${L.timeText(p.ts)}</div></div>`;
    }
    $('main').innerHTML = html; bindChips(); bindPhotos();
  }

  function renderToday() {
    const t = Date.now(), rows = emps().map(e => ({ e, r: L.dayInfo(e, L.currentShiftDate(e, t, S()), t, ctx()) }));
    const c = (f) => rows.filter(f).length;
    let html = `<div class="stats">
      <div class="stat"><b class="pos">${c(x => x.r.inP)}</b><span>حضروا</span></div>
      <div class="stat"><b style="color:var(--warn)">${c(x => x.r.lateMin > S().graceIn && !x.r.off)}</b><span>متأخرين</span></div>
      <div class="stat"><b class="neg">${c(x => ['absent', 'notyet-late'].includes(x.r.status))}</b><span>لم يحضروا</span></div></div>`;
    if (!rows.length) html += '<div class="empty">لا يوجد موظفين</div>';
    for (const { e, r } of rows) {
      const [st, cl] = L.STATUS[r.status] || ['—', 'muted'];
      html += `<div class="card"><div class="emp-h"><img src="${e.photo || 'icon.png'}"><b>${esc(e.name)}</b><span class="tag ${cl}">${st}</span></div>
        <div class="kv" style="margin-top:10px"><span>الدوام</span><span>${L.hmText(e.start)} — ${L.hmText(e.end)}</span>
        <span>الحضور</span><span>${r.inP ? L.timeText(r.inP.ts) + (r.inP.branch ? ' • ' + esc(r.inP.branch) : '') : '—'}</span>
        <span>الانصراف</span><span>${r.outP ? L.timeText(r.outP.ts) : r.adj.manualOut ? L.hmText(r.adj.manualOut) + ' (يدوي)' : '—'}</span>
        ${r.lateMin > S().graceIn && !r.off ? `<span>التأخير</span><span style="color:var(--warn)">${L.durText(r.lateMin)}</span>` : ''}
        ${r.total ? `<span>خصم اليوم</span><span class="money neg">${money(r.total)}</span>` : ''}</div></div>`;
    }
    $('main').innerHTML = html;
  }

  function renderSalary() {
    const t = Date.now(), sums = emps().map(e => L.monthSummary(e, salaryYm, t, ctx()));
    const tot = sums.reduce((a, s) => ({ ded: a.ded + s.totalDed, net: a.net + s.net }), { ded: 0, net: 0 });
    let html = `<div class="field"><label>الشهر</label><input type="month" id="ym" value="${salaryYm}"></div>
      <div class="stats" style="grid-template-columns:1fr 1fr"><div class="stat"><b class="money neg" style="font-size:17px">${money(tot.ded)}</b><span>مجموع الخصومات</span></div><div class="stat"><b class="money pos" style="font-size:17px">${money(tot.net)}</b><span>الصافي المستحق</span></div></div>`;
    for (const s of sums) {
      const open = openEmp === s.emp.id;
      html += `<div class="card" data-emp="${s.emp.id}"><div class="emp-h"><img src="${s.emp.photo || 'icon.png'}"><b>${esc(s.emp.name)}</b><span class="money pos">${money(s.net)}</span></div>
        <div class="kv" style="margin-top:10px"><span>الراتب</span><span class="money">${money(s.salary)}</span>
        <span>تأخير / غياب / نصف غياب</span><span>${s.lateCount} / ${s.absentCount} / ${s.halfCount}</span>
        <span>انصراف مبكر / نسيان</span><span>${s.earlyCount} / ${s.forgotCount}</span>
        <span>الخصومات</span><span class="money neg">${s.totalDed ? money(s.totalDed) : '—'}</span></div>
        ${open ? s.days.filter(r => !['na', 'future'].includes(r.status)).reverse().map(r => { const [st, cl] = L.STATUS[r.status] || ['—', 'muted']; return `<div class="dl"><span style="width:84px">${r.date.slice(5)} ${L.DAY_NAMES[L.weekday(r.date)].slice(0, 3)}</span><span class="tag ${cl}">${st}</span><span class="sp"></span><span>${r.inP ? L.timeText(r.inP.ts) : ''}${r.outP ? ' ← ' + L.timeText(r.outP.ts) : ''}</span>${r.total ? `<span class="money neg">-${Math.round(r.total / 1000)}k</span>` : ''}</div>`; }).join('') : `<div style="color:var(--gold);font-size:12.5px;margin-top:8px;text-align:center">اضغط لعرض التفاصيل اليومية</div>`}</div>`;
    }
    $('main').innerHTML = html;
    $('ym').onchange = () => { salaryYm = $('ym').value || salaryYm; render(); };
    document.querySelectorAll('[data-emp]').forEach(c => c.onclick = () => { openEmp = openEmp === c.dataset.emp ? null : c.dataset.emp; render(); });
  }

  function renderSettings() {
    $('main').innerHTML = `
      <div class="card"><h3 style="margin-top:0;color:var(--gold2)">الإشعارات</h3>
        <label class="switch"><input type="checkbox" id="nt" ${db.notify ? 'checked' : ''}> إشعار بكل بصمة حضور وانصراف</label>
        <p style="color:var(--muted);font-size:12.5px;line-height:1.7">الإشعار يوصل فوراً والتطبيق مفتوح أو بالخلفية لفترة قصيرة. من تفتح التطبيق يجيك إشعار بكل البصمات الجديدة اللي صارت.</p>
        <button class="btn ghost" id="testN">تجربة إشعار</button></div>
      <div class="card"><h3 style="margin-top:0;color:var(--gold2)">قفل التطبيق</h3>
        <div class="field"><label>رمز من 4 أرقام (اتركه فارغ لإلغاء القفل)</label><input id="pin" inputmode="numeric" maxlength="4" value="${db.pin ? '••••' : ''}"></div>
        <button class="btn ghost" id="savePin">حفظ الرمز</button></div>
      <div class="card"><div class="kv"><span>عدد الموظفين</span><span>${emps().length}</span><span>عدد البصمات المحفوظة</span><span>${Object.keys(db.punches).length}</span><span>كود المحل</span><span dir="ltr">${esc(db.cfg.ws)}</span></div>
        <div class="row" style="margin-top:12px"><button class="btn ghost" id="full">إعادة تحميل كل السجل</button><button class="btn danger" id="unlink">إلغاء الربط</button></div></div>
      <div class="card about"><img src="icon.png"><h3 style="color:var(--gold2)">مدير بصمة IBRA</h3>
        <p>برمجة وتطوير <b style="color:var(--gold2)">ابراهيم الخزرجي</b></p>
        <a data-url="https://ibraprogram.netlify.app/">🌐 ibraprogram.netlify.app</a>
        <a data-url="https://t.me/ibraprogram">✈️ t.me/ibraprogram</a>
        <a data-url="https://www.tiktok.com/@ibraprogram">🎵 TikTok: ibraprogram</a></div>`;
    $('nt').onchange = async () => { db.notify = $('nt').checked; save(); if (db.notify) await askNotify(); tellRunner(false); };
    $('testN').onclick = async () => {
      await askNotify();
      const n = { title: '✅ موظف تجريبي سجّل حضور', body: `الفرع الرئيسي • الساعة ${L.timeText(Date.now())} • ${L.dateStr(Date.now())}` };
      if (LN) await LN.schedule({ notifications: [{ id: 7, title: n.title, body: n.body, schedule: { at: new Date(Date.now() + 3000) } }] }).catch(() => {});
      toast(LN ? 'سيظهر الإشعار خلال 3 ثواني (اقفل الشاشة للتجربة)' : n.title);
    };
    $('savePin').onclick = () => { const v = $('pin').value.trim(); if (v === '••••') return; if (v && !/^\d{4}$/.test(v)) return toast('الرمز 4 أرقام'); db.pin = v; save(); toast(v ? 'تم حفظ الرمز' : 'تم إلغاء القفل'); };
    $('full').onclick = () => { db.lastSrv = 0; db.punches = {}; db.employees = {}; db.days = {}; save(); pull(false); };
    $('unlink').onclick = () => { if (!confirm('إلغاء الربط ومسح السجل من هذا الايفون؟')) return; db = blank(); save(); render(); };
    document.querySelectorAll('[data-url]').forEach(a => a.onclick = () => window.open(a.dataset.url, '_blank'));
  }

  // ===== القفل =====
  function lockScreen() {
    return new Promise((resolve) => {
      if (!db.pin) return resolve();
      const el = document.createElement('div'); el.className = 'lock';
      let v = '';
      const draw = () => { el.innerHTML = `<img src="icon.png"><div style="color:var(--gold2);font-size:18px">أدخل رمز القفل</div><div class="dots">${[0, 1, 2, 3].map(i => `<i class="${i < v.length ? 'f' : ''}"></i>`).join('')}</div>
        <div class="pad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map(k => k ? `<button data-k="${k}">${k}</button>` : '<span></span>').join('')}</div>`;
        el.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
          const k = b.dataset.k; if (k === '⌫') v = v.slice(0, -1); else v += k;
          if (v.length === 4) { if (v === db.pin) { el.remove(); return resolve(); } v = ''; if (navigator.vibrate) navigator.vibrate(200); }
          draw();
        });
      };
      draw(); document.body.appendChild(el);
    });
  }

  // ===== التشغيل =====
  document.querySelectorAll('#nav button').forEach(b => b.onclick = () => { tab = b.dataset.tab; openEmp = null; render(); $('main').scrollTop = 0; });
  $('refreshBtn').onclick = () => pull(false);
  let wasHidden = false;
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) { wasHidden = true; return; }
    if (wasHidden && db.pin) await lockScreen();
    wasHidden = false; pull(false);
  });
  (async () => {
    await lockScreen();
    render(); setSub();
    if (db.cfg) { pull(false); tellRunner(false); }
    setInterval(() => { if (!document.hidden) pull(false); }, 15000);
    setInterval(() => { if (!document.hidden && tab === 'today') render(); }, 60000);
  })();
})();
