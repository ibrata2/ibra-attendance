// بصمة IBRA — الواجهة الرئيسية
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const money = (n) => `${Math.round(n || 0).toLocaleString('en-US')} ${S().currency || 'د.ع'}`;
  const MIN = 60e3;

  const App = window.App = {
    db: null,
    save: () => api.saveDB(App.db),
    saveSoon: debounce(() => api.saveDB(App.db), 400),
    renderSync, onRemoteChange: () => { refreshActive(); updateBadge(); }
  };
  const S = () => App.db.settings.main;
  const ctx = () => ({ settings: S(), punches: App.db.punches, days: App.db.days });
  const now = () => Sync.now();
  const employees = (all) => Object.values(App.db.employees).filter(e => !e._del && (all || e.active !== false)).sort((a, b) => String(a.name).localeCompare(b.name, 'ar'));
  const device = () => (App.db.local.deviceName || 'حاسبة');
  const branch = () => (App.db.local.branch || 'الفرع الرئيسي');

  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  const syncSoon = debounce(() => Sync.run(), 2000);

  function put(coll, rec) {
    rec._u = now();
    App.db[coll] = App.db[coll] || {};
    App.db[coll][rec.id] = rec;
    Sync.markDirty(coll, rec.id);
    App.saveSoon(); syncSoon();
    return rec;
  }
  function audit(action, detail, extra) {
    put('audit', Object.assign({ id: uid(), at: now(), device: device(), action, detail }, extra || {}));
  }

  // ================= النوافذ =================
  function beep(kind) {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const notes = kind === 'bad' ? [330, 220] : kind === 'warn' ? [660, 520, 660] : [523, 784];
      notes.forEach((f, i) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.frequency.value = f; o.type = 'sine'; o.connect(g); g.connect(ac.destination);
        const t = ac.currentTime + i * 0.18; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        o.start(t); o.stop(t + 0.17);
      });
    } catch (e) {}
  }
  function modal(html, cls) {
    const ov = document.createElement('div'); ov.className = 'overlay';
    ov.innerHTML = `<div class="modal ${cls || ''}">${html}</div>`;
    $('modalRoot').appendChild(ov);
    return { el: ov, box: ov.firstChild, close: () => ov.remove() };
  }
  function popup({ icon = 'ℹ️', title = '', text = '', sub = '', kind = '', buttons = [{ label: 'OK', value: true }], sound = true, input = null }) {
    return new Promise((resolve) => {
      if (sound) beep(kind);
      const m = modal(`<div class="ic">${icon}</div><h2>${esc(title)}</h2><p>${text}${sub ? `<small>${sub}</small>` : ''}</p>
        ${input ? `<div class="field" style="margin-top:14px;text-align:right"><label>${esc(input.label)}</label><input id="popInput" placeholder="${esc(input.placeholder || '')}"></div>` : ''}
        <div class="actions">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>`, 'popup ' + kind);
      const focusBtn = m.box.querySelector('.btn'); setTimeout(() => (input ? m.box.querySelector('#popInput') : focusBtn).focus(), 50);
      m.box.querySelectorAll('[data-i]').forEach(b => b.onclick = () => {
        const v = buttons[+b.dataset.i].value; const inp = m.box.querySelector('#popInput');
        m.close(); resolve(input ? { value: v, text: inp ? inp.value.trim() : '' } : v);
      });
    });
  }
  function toast(t) { const el = $('toast'); el.textContent = t; el.classList.remove('hidden'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.add('hidden'), 2600); }
  function askPassword(title) {
    return new Promise((resolve) => {
      const m = modal(`<h2>🔒 ${esc(title || 'كلمة مرور الإدارة')}</h2>
        <div class="field"><input type="password" id="pw" placeholder="كلمة المرور" autofocus></div>
        <div id="pwErr" class="flag" style="margin-top:8px"></div>
        <div class="actions"><button class="btn" id="pwOk">دخول</button><button class="btn ghost" id="pwCancel">إلغاء</button></div>`);
      const inp = m.box.querySelector('#pw'); setTimeout(() => inp.focus(), 50);
      const ok = async () => {
        const h = await api.hash(inp.value);
        if (h === S().adminHash) { m.close(); resolve(true); } else { m.box.querySelector('#pwErr').textContent = 'كلمة المرور غير صحيحة'; inp.select(); beep('bad'); }
      };
      m.box.querySelector('#pwOk').onclick = ok;
      inp.onkeydown = (e) => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') { m.close(); resolve(false); } };
      m.box.querySelector('#pwCancel').onclick = () => { m.close(); resolve(false); };
    });
  }

  // ================= الإدارة والتنقل =================
  let adminUntil = 0;
  const isAdmin = () => Date.now() < adminUntil;
  async function ensureAdmin() {
    if (isAdmin()) { adminUntil = Date.now() + 10 * MIN; return true; }
    const ok = await askPassword();
    if (ok) { adminUntil = Date.now() + 10 * MIN; $('lockBtn').classList.remove('hidden'); }
    return ok;
  }
  function lockAdmin() { adminUntil = 0; $('lockBtn').classList.add('hidden'); go('punch'); }
  document.addEventListener('click', () => { if (isAdmin()) adminUntil = Date.now() + 10 * MIN; }, true);

  let current = 'punch';
  const PROTECTED = ['today', 'employees', 'reports', 'review', 'settings'];
  async function go(tab) {
    if (PROTECTED.includes(tab) && !(await ensureAdmin())) return;
    current = tab;
    document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab').forEach(s => s.classList.toggle('active', s.id === 'tab-' + tab));
    render(tab);
    if (tab === 'punch') setTimeout(() => $('codeInput').focus(), 50);
  }
  function render(tab) {
    ({ today: renderToday, employees: renderEmployees, reports: renderReports, review: renderReview, settings: renderSettings, about: renderAbout })[tab]?.();
  }
  function refreshActive() { if (current !== 'punch' && current !== 'settings') render(current); }

  function renderSync() {
    const el = $('syncStatus'), st = Sync.state; if (!el) return;
    const p = st.pending ? ` • ${st.pending} بانتظار الرفع` : '';
    const map = { local: ['💾 محلي فقط' + p, 'muted'], syncing: ['⟳ جاري المزامنة…', 'muted'], ok: ['☁️ متصل' + p, 'ok'], offline: ['📴 بدون إنترنت' + p, 'warn'], error: ['⚠️ خطأ مزامنة' + p, 'bad'] };
    const [t, c] = map[st.status] || map.local;
    el.textContent = t; el.className = 'pill ' + c; el.title = st.error || (st.lastOk ? 'آخر مزامنة: ' + new Date(st.lastOk).toLocaleTimeString('ar-IQ') : '');
  }

  // ================= شاشة البصمة =================
  function buildKeypad() {
    const k = $('keypad'); const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'مسح', '0', '⌫'];
    k.innerHTML = keys.map(x => `<button data-k="${x}" class="${x === '⌫' || x === 'مسح' ? 'k-del' : ''}">${x}</button>`).join('');
    k.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return; const v = b.dataset.k, inp = $('codeInput');
      if (v === '⌫') inp.value = inp.value.slice(0, -1); else if (v === 'مسح') inp.value = ''; else if (inp.value.length < 10) inp.value += v;
      inp.focus(); updatePunchButtons();
    };
    $('codeInput').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/[^\d٠-٩]/g, '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)); });
    $('codeInput').addEventListener('input', updatePunchButtons);
    $('btnIn').onclick = () => startPunch('in');
    $('btnOut').onclick = () => startPunch('out');
  }
  function tickClock() {
    const t = now(), d = new Date(t);
    $('bigClock').innerHTML = `${L.timeText(t).replace(/ [صم]$/, '')}<span class="ampm">${d.getHours() < 12 ? 'صباحاً' : 'مساءً'}</span>`;
    $('bigDate').textContent = d.toLocaleDateString('ar-IQ', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }

  // تكبير الزر المناسب: الحضور بوقت الدخول، والانصراف بعد تسجيل الحضور
  function nextAction(emp, t) {
    const sd = L.currentShiftDate(emp, t, S()), r = L.dayInfo(emp, sd, t, ctx());
    if (r.inP && !r.outP) return { act: 'out', at: r.b.end };
    if (r.outP) { const nb = L.shiftBounds(emp, L.addDays(sd, 1)); return { act: 'in', at: nb.start }; }
    return { act: 'in', at: r.b.start };
  }
  function updatePunchButtons() {
    const t = now(), code = $('codeInput').value.trim();
    const emp = code && employees().find(e => String(e.code) === code);
    let act = 'in';
    if (emp) act = nextAction(emp, t).act;
    else {
      // بدون كود: حسب أقرب موعد (حضور أو انصراف) لكل الموظفين
      let best = Infinity;
      for (const e of employees()) { const n = nextAction(e, t), d = Math.abs(t - n.at); if (d < best) { best = d; act = n.act; } }
    }
    const box = document.querySelector('.punch-btns');
    box.classList.toggle('mode-in', act === 'in'); box.classList.toggle('mode-out', act === 'out');
  }

  // صورة مصغرة تنحفظ داخل سجل البصمة وتتزامن مع باقي الحاسبات
  function makeThumb(dataUrl, size = 140) {
    return new Promise((res) => {
      const im = new Image();
      im.onload = () => { const c = document.createElement('canvas'); c.width = c.height = size; c.getContext('2d').drawImage(im, 0, 0, size, size); res(c.toDataURL('image/jpeg', 0.7)); };
      im.onerror = () => res(null); im.src = dataUrl;
    });
  }
  async function punchPhoto(p) { return (p.hasPhoto && await api.getPhoto(p.id)) || p.thumb || null; }
  async function viewPunch(p) {
    const src = await punchPhoto(p); if (!src) return;
    const m = modal(`<h2>${esc(empName(p))} — ${p.type === 'in' ? 'حضور' : 'انصراف'}</h2><img src="${src}" style="width:100%;border-radius:16px">
      <p style="color:var(--muted);text-align:center">${esc(dayLabel(p.date))} • ${L.timeText(p.ts)} • ${esc(p.device || '')}</p>
      <div class="actions"><button class="btn">إغلاق</button></div>`);
    m.box.querySelector('.btn').onclick = m.close;
  }
  function ph(p) { return p && (p.thumb || p.hasPhoto) ? `<img class="thumb sm" data-pp="${p.id}" src="${p.thumb || 'icon.png'}" title="عرض الصورة">` : ''; }
  function bindPhotos(root) {
    root.querySelectorAll('[data-pp]').forEach(async img => {
      const p = App.db.punches[img.dataset.pp]; if (!p) return;
      if (!p.thumb) { const d = await api.getPhoto(p.id); if (d) img.src = d; else img.remove(); }
      img.onclick = (e) => { e.stopPropagation(); viewPunch(p); };
    });
  }

  let punching = false;
  async function startPunch(type, empDirect) {
    if (punching) return;
    const code = $('codeInput').value.trim();
    const emp = empDirect || employees().find(e => String(e.code) === code);
    if (!emp) { await popup({ icon: '❓', title: 'الكود غير صحيح', text: code ? 'لا يوجد موظف بهذا الكود' : 'أدخل الكود الخاص بك أولاً', kind: 'bad' }); $('codeInput').select(); return; }
    if (!emp.descriptors || !emp.descriptors.length) { await popup({ icon: '📷', title: 'لم يتم تسجيل وجهك', text: `${esc(emp.name)}، لم يتم تسجيل وجهك بعد.<small>راجع الإدارة لتسجيل بصمة الوجه</small>`, kind: 'warn' }); return; }
    punching = true;
    try {
      const t = now(), sd = L.currentShiftDate(emp, t, S()), info = L.dayInfo(emp, sd, t, ctx());
      // فحص الحالة قبل فتح الكاميرا
      if (type === 'in' && info.inP) {
        if (info.outP) { await popup({ icon: '✔️', title: 'تم التسجيل مسبقاً', text: `تم تسجيل حضورك الساعة ${L.timeText(info.inP.ts)}<br>وانصرافك الساعة ${L.timeText(info.outP.ts)}`, kind: 'warn' }); return clearCode(); }
        const left = Math.round((info.b.end - t) / MIN);
        await popup({ icon: '⏰', title: 'تم تسجيل الدخول مسبقاً', kind: 'warn',
          text: `تم تسجيل حضورك الساعة <b>${L.timeText(info.inP.ts)}</b><br>${left > 0 ? `وقت الانصراف بعد <b>${L.durText(left)}</b>` : 'انتهى وقت دوامك — سجّل الانصراف'}`,
          sub: `نهاية الدوام: ${L.timeText(info.b.end)}` });
        return clearCode();
      }
      if (type === 'out' && !info.inP) { await popup({ icon: '⚠️', title: 'لم تسجّل حضورك', text: 'لا يوجد تسجيل حضور لك اليوم.<small>سجّل الحضور أولاً أو راجع الإدارة</small>', kind: 'warn' }); return clearCode(); }
      if (type === 'out' && info.outP) { await popup({ icon: '✔️', title: 'تم تسجيل الانصراف مسبقاً', text: `تم تسجيل انصرافك الساعة ${L.timeText(info.outP.ts)}`, kind: 'warn' }); return clearCode(); }

      // التحقق من الوجه
      let res;
      try { res = await Face.verify(emp, { liveness: S().liveness, strictness: S().strictness, others: employees(true) }); }
      catch (e) { await popup({ icon: '📷', title: 'مشكلة بالكاميرا', text: esc(e.message), kind: 'bad' }); return; }
      if (!res.ok) {
        if (res.reason === 'cancel') return;
        if (res.photo) { const pid = 'fail_' + uid(); await api.savePhoto(pid, res.photo); audit('محاولة بصمة فاشلة', `بكود ${emp.name} (${type === 'in' ? 'حضور' : 'انصراف'})${res.who ? ' — الوجه يشبه ' + res.who : ''}`, { photoId: pid, empId: emp.id }); }
        await popup({ icon: '🚫', title: 'الوجه غير مطابق', text: res.reason === 'timeout' ? 'ما ظهر وجهك بالكاميرا.<small>تأكد من الإضاءة وضع وجهك داخل الدائرة ثم حاول مرة أخرى</small>' : res.reason === 'noblink' ? 'ما انقرت الرمشة.<small>ارمش ببطء مرة وحدة، أو الأدمن يطفي طلب الرمشة من الإعدادات</small>' : (res.who ? `هذا الوجه مو وجه ${esc(emp.name)}.` : 'الوجه غير مطابق لبيانات هذا الموظف.') + '<small>لم يتم تسجيل البصمة — وانحفظت صورة المحاولة عند الإدارة</small>', kind: 'bad' });
        return;
      }

      // إعادة الحساب بالوقت الفعلي بعد التحقق
      const t2 = now(), sd2 = L.currentShiftDate(emp, t2, S()), b = L.shiftBounds(emp, sd2), off = L.isOff(emp, sd2);
      const suspect = !!App.db.meta.clockSuspect && !Sync.hasTimeBase();
      const p = { id: uid(), empId: emp.id, empName: emp.name, date: sd2, type, ts: t2, device: device(), branch: branch(), hasPhoto: true, match: Math.round((1 - res.distance) * 100), flags: {} };
      if (suspect) p.flags.suspect = true;
      if (off) p.flags.offDay = true;

      if (type === 'out') {
        const early = Math.round((b.end - t2) / MIN);
        if (!off && early > S().graceOut) {
          const r = await popup({ icon: '⚠️', title: 'انصراف مبكر', kind: 'warn',
            text: `دوامك ينتهي بعد <b>${L.durText(early)}</b><br>إذا تسجّل الآن يُحسب انصراف مبكر وعليه خصم`,
            sub: `خصم الانصراف المبكر: ${money(S().dedEarly)}`,
            input: { label: 'السبب (اختياري)', placeholder: 'مثلاً: إذن من الإدارة' },
            buttons: [{ label: 'تأكيد الانصراف', value: true, cls: 'danger' }, { label: 'إلغاء', value: false, cls: 'ghost' }] });
          if (!r.value) return clearCode();
          p.flags.early = early; if (r.text) p.reason = r.text;
        }
      } else {
        p.lateMin = Math.max(0, Math.round((t2 - b.start) / MIN));
      }
      await api.savePhoto(p.id, res.photo);
      p.thumb = await makeThumb(res.photo);
      put('punches', p);

      // الرسائل بعد التسجيل
      if (type === 'in') {
        if (off) await popup({ icon: '📅', title: 'تم تسجيل الحضور', text: `أهلاً ${esc(emp.name)}<br>اليوم عطلتك — تم التسجيل كدوام بيوم عطلة`, kind: 'ok' });
        else if (p.lateMin > S().graceIn) await popup({ icon: '⏰', title: 'أنت متأخر عن الدوام', kind: 'warn',
          text: `${esc(emp.name)}، أنت متأخر عن العمل<br><b style="font-size:28px;color:var(--warn)">${L.durText(p.lateMin)}</b><br>عن الوقت الفعلي للدوام (${L.timeText(b.start)})`,
          sub: `تم تسجيل الحضور الساعة ${L.timeText(t2)}` });
        else await popup({ icon: '✅', title: 'تم تسجيل الحضور', text: `أهلاً ${esc(emp.name)}<br>الساعة ${L.timeText(t2)}`, sub: p.lateMin > 0 ? `تأخير ${L.durText(p.lateMin)} ضمن وقت السماح` : `وقت الانصراف: ${L.timeText(b.end)}`, kind: 'ok' });
        const missed = findMissedOut(emp, sd2);
        if (missed) await popup({ icon: '📝', title: 'تنبيه', text: `لم تسجّل انصرافك يوم <b>${esc(dayLabel(missed))}</b><br>تم إبلاغ الإدارة`, kind: 'warn' });
      } else {
        const inP = L.punchesOf(App.db.punches, emp.id, sd2).find(x => x.type === 'in');
        await popup({ icon: '👋', title: 'تم تسجيل الانصراف', text: `مع السلامة ${esc(emp.name)}<br>الساعة ${L.timeText(t2)}`, sub: inP ? `مدة العمل اليوم: ${L.durText((t2 - inP.ts) / MIN)}` : '', kind: 'ok' });
      }
      clearCode();
    } finally { punching = false; }
  }
  function clearCode() { $('codeInput').value = ''; $('codeInput').focus(); updatePunchButtons(); }
  function dayLabel(date) { return `${L.DAY_NAMES[L.weekday(date)]} ${date}`; }
  function findMissedOut(emp, fromDate) {
    for (let i = 1; i <= 7; i++) {
      const d = L.addDays(fromDate, -i), r = L.dayInfo(emp, d, now(), ctx());
      if (r.status === 'forgot' && !r.adj.reviewed && !r.adj.notified) { put('days', Object.assign({}, r.adj, { id: emp.id + '_' + d, empId: emp.id, date: d, notified: true })); return d; }
      if (r.inP || r.status === 'absent') return null;
    }
    return null;
  }

  // ================= لوحة اليوم =================
  function statusTag(r) { const [t, c] = L.STATUS[r.status] || ['—', 'muted']; return `<span class="tag ${c}">${t}</span>${r.inP && r.inP.flags && r.inP.flags.suspect ? ' <span class="flag" title="وقت الحاسبة غير مؤكد">⚠️</span>' : ''}`; }
  function renderToday() {
    const t = now(), list = employees();
    const rows = list.map(e => ({ e, r: L.dayInfo(e, L.currentShiftDate(e, t, S()), t, ctx()) }));
    const c = (f) => rows.filter(f).length;
    $('todayView').innerHTML = `
      <div class="page-head"><h1>لوحة اليوم — ${new Date(t).toLocaleDateString('ar-IQ', { weekday: 'long', day: 'numeric', month: 'long' })}</h1><button class="btn ghost" id="tdRefresh">تحديث</button></div>
      <div class="stats">
        <div class="stat"><b>${list.length}</b><span>الموظفين</span></div>
        <div class="stat"><b class="pos">${c(x => x.r.inP)}</b><span>حضروا</span></div>
        <div class="stat"><b style="color:var(--warn)">${c(x => x.r.lateMin > S().graceIn && !x.r.off)}</b><span>متأخرين</span></div>
        <div class="stat"><b class="neg">${c(x => ['absent', 'notyet-late'].includes(x.r.status))}</b><span>غائبين / لم يحضروا</span></div>
        <div class="stat"><b style="color:var(--info)">${c(x => x.r.status.startsWith('open'))}</b><span>في الدوام الآن</span></div>
        <div class="stat"><b>${c(x => x.r.status === 'off')}</b><span>عطلة</span></div>
      </div>
      <div class="card" style="padding:0;overflow:auto">
      ${list.length ? `<table><thead><tr><th></th><th>الموظف</th><th>الدوام</th><th>الحضور</th><th>الانصراف</th><th>الحالة</th><th>التأخير</th><th>خصم اليوم</th><th></th></tr></thead><tbody>
      ${rows.map(({ e, r }) => `<tr>
        <td><img class="avatar" src="${e.photo || 'icon.png'}"></td><td><b>${esc(e.name)}</b><br><small style="color:var(--muted)">كود ${esc(e.code)}</small></td>
        <td>${L.hmText(e.start)} — ${L.hmText(e.end)}</td>
        <td><div class="tcell">${ph(r.inP)}${r.inP ? L.timeText(r.inP.ts) : '—'}</div></td><td><div class="tcell">${ph(r.outP)}${r.outP ? L.timeText(r.outP.ts) : (r.adj.manualOut ? L.hmText(r.adj.manualOut) + ' (يدوي)' : '—')}</div></td>
        <td>${statusTag(r)}</td><td>${r.lateMin && !r.off ? L.durText(r.lateMin) : '—'}</td>
        <td class="money ${r.total ? 'neg' : ''}">${r.total ? money(r.total) : '—'}</td>
        <td><button class="btn ghost sm" data-adj="${e.id}|${r.date}">تعديل اليوم</button></td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">لا يوجد موظفين بعد — أضفهم من قسم الموظفين</div>'}</div>`;
    $('tdRefresh').onclick = renderToday;
    bindPhotos($('todayView'));
    bindAdj($('todayView'), renderToday);
  }
  function bindAdj(root, after) { root.querySelectorAll('[data-adj]').forEach(b => b.onclick = () => { const [id, d] = b.dataset.adj.split('|'); adjustDay(App.db.employees[id], d, after); }); }

  // تعديل يوم (إعفاء / إذن / وقت انصراف يدوي)
  function adjustDay(emp, date, after) {
    const key = emp.id + '_' + date, a = App.db.days[key] || {}, r = L.dayInfo(emp, date, now(), ctx());
    const m = modal(`<h2>تعديل يوم — ${esc(emp.name)}</h2>
      <p style="color:var(--muted);margin-top:-6px">${esc(dayLabel(date))} • الحالة: ${statusTag(r)}</p>
      <div class="grid" style="gap:10px">
        <label class="switch"><input type="checkbox" id="aLate" ${a.waiveLate ? 'checked' : ''}> إعفاء من خصم التأخير</label>
        <label class="switch"><input type="checkbox" id="aAbs" ${a.waiveAbsence ? 'checked' : ''}> إعفاء من خصم الغياب</label>
        <label class="switch"><input type="checkbox" id="aEarly" ${a.waiveEarly ? 'checked' : ''}> إذن انصراف مبكر (بدون خصم)</label>
        <label class="switch"><input type="checkbox" id="aLeave" ${a.leave ? 'checked' : ''}> إجازة / إذن لكامل اليوم (بدون أي خصم)</label>
        <label class="switch"><input type="checkbox" id="aForgot" ${a.forgotPenalty ? 'checked' : ''}> تطبيق خصم نسيان الانصراف (${money(S().dedForgot)})</label>
        <div class="grid g2">
          <div class="field"><label>وقت انصراف يدوي (إذا نسي البصمة)</label><input type="time" id="aOut" value="${esc(a.manualOut || '')}"></div>
          <div class="field"><label>ملاحظة</label><input id="aNote" value="${esc(a.note || '')}"></div>
        </div>
      </div>
      <div class="actions"><button class="btn" id="aSave">حفظ</button><button class="btn ghost" id="aCancel">إلغاء</button></div>`);
    const q = (id) => m.box.querySelector('#' + id);
    q('aCancel').onclick = m.close;
    q('aSave').onclick = () => {
      const rec = { id: key, empId: emp.id, date, waiveLate: q('aLate').checked, waiveAbsence: q('aAbs').checked, waiveEarly: q('aEarly').checked, leave: q('aLeave').checked, forgotPenalty: q('aForgot').checked, manualOut: q('aOut').value, note: q('aNote').value.trim(), reviewed: true, notified: a.notified };
      put('days', rec);
      audit('تعديل يوم', `${emp.name} — ${date}: ${[rec.waiveLate && 'إعفاء تأخير', rec.waiveAbsence && 'إعفاء غياب', rec.waiveEarly && 'إذن مبكر', rec.leave && 'إجازة', rec.forgotPenalty && 'خصم نسيان', rec.manualOut && 'انصراف ' + rec.manualOut].filter(Boolean).join('، ') || 'بدون تغيير'}`);
      m.close(); toast('تم الحفظ'); after && after(); updateBadge();
    };
  }

  // ================= الموظفين =================
  function renderEmployees() {
    const list = employees(true);
    $('empView').innerHTML = `
      <div class="page-head"><h1>الموظفين (${list.length})</h1><button class="btn" id="addEmp">+ إضافة موظف</button></div>
      ${list.length ? `<div class="emp-grid">${list.map(e => `
        <div class="emp-card ${e.active === false ? 'off' : ''}">
          <div class="emp-top"><img class="avatar" src="${e.photo || 'icon.png'}"><div><b>${esc(e.name)}</b><small>كود: ${esc(e.code)} ${e.active === false ? '• موقوف' : ''}</small></div></div>
          <div class="kv">
            <span>الدوام</span><span>${L.hmText(e.start)} — ${L.hmText(e.end)}</span>
            <span>العطلة</span><span>${(e.daysOff || []).length ? L.WEEK_ORDER.filter(d => e.daysOff.includes(d)).map(d => L.DAY_NAMES[d]).join('، ') : 'لا يوجد'}</span>
            <span>الراتب</span><span class="money">${money(e.salary)}</span>
            <span>بصمة الوجه</span><span>${e.descriptors && e.descriptors.length ? '<span class="tag ok">مسجلة ✓</span>' : '<span class="tag bad">غير مسجلة</span>'}</span>
          </div>
          <div class="row"><button class="btn ghost sm" data-edit="${e.id}">تعديل</button><button class="btn ghost sm" data-face="${e.id}">📷 إعادة تسجيل الوجه</button><button class="btn ghost sm" data-test="${e.id}">🧪 تجربة</button><span class="spacer"></span><button class="btn danger sm" data-del="${e.id}">حذف</button></div>
        </div>`).join('')}</div>` : '<div class="empty">لا يوجد موظفين بعد. اضغط "إضافة موظف" للبدء.</div>'}`;
    $('addEmp').onclick = () => editEmployee(null);
    $('empView').querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editEmployee(App.db.employees[b.dataset.edit]));
    $('empView').querySelectorAll('[data-test]').forEach(b => b.onclick = async () => {
      const e = App.db.employees[b.dataset.test];
      if (!e.descriptors) return popup({ icon: '📷', title: 'سجّل الوجه أولاً', text: 'هذا الموظف ما عنده بصمة وجه', kind: 'warn' });
      let r; try { r = await Face.verify(e, { liveness: false, strictness: S().strictness, others: employees(true) }); } catch (er) { return popup({ icon: '📷', title: 'مشكلة بالكاميرا', text: esc(er.message), kind: 'bad' }); }
      if (r.reason === 'cancel') return;
      const pct = Math.max(0, Math.round((1 - (r.ok ? r.distance : r.best)) * 100));
      popup({ icon: r.ok ? '✅' : '🚫', title: r.ok ? 'مطابق — تجربة فقط' : 'غير مطابق', kind: r.ok ? 'ok' : 'bad',
        text: `نسبة التطابق مع <b>${esc(e.name)}</b>: <b style="font-size:26px">${r.best < 9 || r.ok ? pct + '%' : '—'}</b>${r.who ? `<br>الوجه أقرب للموظف <b>${esc(r.who)}</b>` : ''}`,
        sub: `المطلوب للقبول: ${Math.round((1 - ({ low: 0.5, medium: 0.45, high: 0.4 }[S().strictness] || 0.45) + 0.02) * 100)}% أو أكثر بـ 3 لقطات متتالية • ما ينسجل أي حضور` });
    });
    $('empView').querySelectorAll('[data-face]').forEach(b => b.onclick = () => reEnroll(App.db.employees[b.dataset.face]));
    $('empView').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      const e = App.db.employees[b.dataset.del];
      const ok = await popup({ icon: '🗑️', title: 'حذف موظف', text: `هل تريد حذف <b>${esc(e.name)}</b>؟<small>سجلات حضوره القديمة تبقى محفوظة بالتقارير</small>`, kind: 'bad', buttons: [{ label: 'حذف', value: true, cls: 'danger' }, { label: 'إلغاء', value: false, cls: 'ghost' }] });
      if (!ok) return; put('employees', Object.assign({}, e, { _del: true })); audit('حذف موظف', e.name); renderEmployees();
    });
  }
  async function reEnroll(e) {
    let r; try { r = await Face.enroll(e.name); } catch (er) { return popup({ icon: '📷', title: 'مشكلة بالكاميرا', text: esc(er.message), kind: 'bad' }); }
    if (!r) return;
    const dup = Face.findSimilar(r.descriptors, employees(true), e.id, S().strictness);
    if (dup && !(await popup({ icon: '⚠️', title: 'وجه مشابه', text: `هذا الوجه يشبه الموظف <b>${esc(dup.name)}</b>.<br>هل تريد المتابعة؟`, kind: 'warn', buttons: [{ label: 'متابعة', value: true }, { label: 'إلغاء', value: false, cls: 'ghost' }] }))) return;
    put('employees', Object.assign({}, e, { descriptors: r.descriptors, photo: r.photo })); audit('تسجيل وجه', e.name); toast('تم تسجيل الوجه'); renderEmployees();
  }
  function editEmployee(e) {
    const isNew = !e; const nextCode = () => { const codes = employees(true).map(x => +x.code).filter(Boolean); return String(Math.max(100, ...codes) + 1); };
    e = e ? JSON.parse(JSON.stringify(e)) : { id: uid(), name: '', code: nextCode(), salary: '', start: '09:00', end: '17:00', daysOff: [5], active: true, startDate: L.dateStr(now()) };
    let face = e.descriptors ? { descriptors: e.descriptors, photo: e.photo } : null;
    const m = modal(`<h2>${isNew ? 'إضافة موظف' : 'تعديل موظف'}</h2>
      <div class="grid g2">
        <div class="field"><label>اسم الموظف</label><input id="fName" value="${esc(e.name)}" placeholder="الاسم الكامل"></div>
        <div class="field"><label>الكود (يكتبه الموظف عند البصمة)</label><input id="fCode" value="${esc(e.code)}" inputmode="numeric"></div>
        <div class="field"><label>الراتب الشهري (${esc(S().currency)})</label><input id="fSalary" type="number" min="0" step="1000" value="${esc(e.salary)}"></div>
        <div class="field"><label>تاريخ بداية العمل</label><input id="fStartDate" type="date" value="${esc(e.startDate || '')}"></div>
        <div class="field"><label>وقت الحضور</label><input id="fStart" type="time" value="${esc(e.start)}"></div>
        <div class="field"><label>وقت الانصراف</label><input id="fEnd" type="time" value="${esc(e.end)}"><span class="hint">إذا كان قبل وقت الحضور يُحسب دوام ليلي ينتهي باليوم التالي</span></div>
      </div>
      <div class="field" style="margin-top:12px"><label>أيام العطلة الأسبوعية</label>
        <div class="days">${L.WEEK_ORDER.map(d => `<label><input type="checkbox" value="${d}" ${(e.daysOff || []).includes(d) ? 'checked' : ''}> ${L.DAY_NAMES[d]}</label>`).join('')}</div></div>
      <label class="switch" style="margin-top:12px"><input type="checkbox" id="fActive" ${e.active !== false ? 'checked' : ''}> الموظف فعّال (إلغاء التحديد يوقفه بدون حذف)</label>
      <div class="card" style="margin-top:14px;display:flex;align-items:center;gap:14px">
        <img id="fPhoto" class="avatar" style="width:70px;height:70px" src="${face ? face.photo : 'icon.png'}">
        <div style="flex:1"><b>بصمة الوجه</b><br><small id="fFaceState" style="color:var(--muted)">${face ? 'مسجلة ✓' : 'غير مسجلة — مطلوبة للبصمة'}</small></div>
        <button class="btn green" id="fEnroll">📷 ${face ? 'إعادة تسجيل الوجه' : 'تسجيل الوجه'}</button>
      </div>
      <div id="fErr" class="flag"></div>
      <div class="actions"><button class="btn" id="fSave">حفظ</button><button class="btn ghost" id="fCancel">إلغاء</button></div>`);
    const q = (id) => m.box.querySelector('#' + id);
    q('fCancel').onclick = m.close;
    q('fEnroll').onclick = async () => {
      const name = q('fName').value.trim() || 'موظف جديد';
      m.el.style.display = 'none';
      let r; try { r = await Face.enroll(name); } catch (er) { m.el.style.display = ''; return popup({ icon: '📷', title: 'مشكلة بالكاميرا', text: esc(er.message), kind: 'bad' }); }
      m.el.style.display = '';
      if (!r) return;
      const dup = Face.findSimilar(r.descriptors, employees(true), e.id, S().strictness);
      if (dup && !(await popup({ icon: '⚠️', title: 'وجه مشابه', text: `هذا الوجه يشبه الموظف <b>${esc(dup.name)}</b>.<br>هل تريد المتابعة؟`, kind: 'warn', buttons: [{ label: 'متابعة', value: true }, { label: 'إلغاء', value: false, cls: 'ghost' }] }))) return;
      face = r; q('fPhoto').src = r.photo; q('fFaceState').textContent = 'مسجلة ✓'; q('fEnroll').textContent = '📷 إعادة تسجيل الوجه';
    };
    q('fSave').onclick = () => {
      const name = q('fName').value.trim(), code = q('fCode').value.trim();
      const err = (t) => { q('fErr').textContent = t; beep('bad'); };
      if (!name) return err('اكتب اسم الموظف');
      if (!/^\d{1,10}$/.test(code)) return err('الكود يجب أن يكون أرقام فقط');
      if (employees(true).some(x => x.id !== e.id && String(x.code) === code)) return err('هذا الكود مستخدم لموظف آخر');
      if (!q('fStart').value || !q('fEnd').value) return err('حدد وقت الحضور والانصراف');
      const rec = Object.assign(e, {
        name, code, salary: Number(q('fSalary').value) || 0, start: q('fStart').value, end: q('fEnd').value, startDate: q('fStartDate').value,
        daysOff: [...m.box.querySelectorAll('.days input:checked')].map(x => +x.value), active: q('fActive').checked
      });
      if (face) { rec.descriptors = face.descriptors; rec.photo = face.photo; }
      delete rec._u;
      put('employees', rec); audit(isNew ? 'إضافة موظف' : 'تعديل موظف', name);
      m.close(); toast('تم الحفظ'); renderEmployees();
    };
  }

  // ================= التقارير =================
  let repState = { ym: null, emp: 'all', view: 'salary', from: null, to: null };
  function renderReports() {
    const t = now(); repState.ym = repState.ym || L.dateStr(t).slice(0, 7);
    repState.from = repState.from || repState.ym + '-01'; repState.to = repState.to || L.dateStr(t);
    const emps = employees(true);
    $('repView').innerHTML = `
      <div class="page-head"><h1>التقارير</h1>
        <div class="row">
          <button class="btn ${repState.view === 'salary' ? '' : 'ghost'}" data-v="salary">الرواتب والخصومات</button>
          <button class="btn ${repState.view === 'log' ? '' : 'ghost'}" data-v="log">سجل البصمات</button>
          <button class="btn ${repState.view === 'audit' ? '' : 'ghost'}" data-v="audit">سجل التعديلات</button>
        </div></div>
      <div class="card row">
        ${repState.view === 'salary' ? `<div class="field"><label>الشهر</label><input type="month" id="rYm" value="${repState.ym}"></div>` : `<div class="field"><label>من</label><input type="date" id="rFrom" value="${repState.from}"></div><div class="field"><label>إلى</label><input type="date" id="rTo" value="${repState.to}"></div>`}
        <div class="field"><label>الموظف</label><select id="rEmp"><option value="all">كل الموظفين</option>${emps.map(e => `<option value="${e.id}" ${repState.emp === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select></div>
        <span class="spacer"></span>
        ${repState.view === 'log' ? '<button class="btn ghost" id="rAdd">+ بصمة يدوية</button>' : ''}
        <button class="btn" id="rExcel">⬇ تصدير Excel</button>
      </div>
      <div id="repBody"></div>`;
    $('repView').querySelectorAll('[data-v]').forEach(b => b.onclick = () => { repState.view = b.dataset.v; renderReports(); });
    const rer = () => { if ($('rYm')) repState.ym = $('rYm').value || repState.ym; if ($('rFrom')) { repState.from = $('rFrom').value; repState.to = $('rTo').value; } repState.emp = $('rEmp').value; renderRepBody(); };
    ['rYm', 'rFrom', 'rTo', 'rEmp'].forEach(id => $(id) && ($(id).onchange = rer));
    $('rExcel').onclick = exportExcel;
    if ($('rAdd')) $('rAdd').onclick = () => editPunch(null);
    renderRepBody();
  }
  function selectedEmps() { const all = employees(true); return repState.emp === 'all' ? all : all.filter(e => e.id === repState.emp); }
  function renderRepBody() {
    if (repState.view === 'salary') return renderSalary();
    if (repState.view === 'log') return renderLog();
    return renderAudit();
  }
  function renderSalary() {
    const t = now(), sums = selectedEmps().map(e => L.monthSummary(e, repState.ym, t, ctx()));
    const tot = sums.reduce((a, s) => ({ sal: a.sal + s.salary, ded: a.ded + s.totalDed, net: a.net + s.net }), { sal: 0, ded: 0, net: 0 });
    $('repBody').innerHTML = `
      <div class="stats"><div class="stat"><b class="money">${money(tot.sal)}</b><span>مجموع الرواتب</span></div><div class="stat"><b class="money neg">${money(tot.ded)}</b><span>مجموع الخصومات</span></div><div class="stat"><b class="money pos">${money(tot.net)}</b><span>الصافي المستحق</span></div></div>
      <div class="card" style="padding:0;overflow:auto">${sums.length ? `<table><thead><tr><th>الموظف</th><th>أيام الدوام</th><th>حضور</th><th>تأخير</th><th>غياب</th><th>نصف غياب</th><th>انصراف مبكر</th><th>نسيان انصراف</th><th>ساعات العمل</th><th>الراتب</th><th>الخصومات</th><th>الصافي</th><th></th></tr></thead><tbody>
      ${sums.map(s => `<tr><td><b>${esc(s.emp.name)}</b></td><td>${s.workDays}</td><td>${s.present}</td><td>${s.lateCount}</td><td>${s.absentCount}</td><td>${s.halfCount}</td><td>${s.earlyCount}</td><td>${s.forgotCount}</td><td>${(s.workedMin / 60).toFixed(1)}</td>
        <td class="money">${money(s.salary)}</td><td class="money neg">${s.totalDed ? money(s.totalDed) : '—'}</td><td class="money pos"><b>${money(s.net)}</b></td><td><button class="btn ghost sm" data-det="${s.emp.id}">التفاصيل</button></td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">لا يوجد موظفين</div>'}</div>
      ${sums.length === 1 ? `<div class="card" style="padding:0;overflow:auto"><h3 style="padding:14px 16px 0">التفاصيل اليومية</h3>${detailTable(sums[0])}</div>` : ''}`;
    $('repBody').querySelectorAll('[data-det]').forEach(b => b.onclick = () => {
      const s = L.monthSummary(App.db.employees[b.dataset.det], repState.ym, now(), ctx());
      const m = modal(`<h2>${esc(s.emp.name)} — ${repState.ym}</h2><div style="overflow:auto;max-height:65vh">${detailTable(s)}</div><div class="actions"><button class="btn" id="dClose">إغلاق</button></div>`, 'wide');
      m.box.querySelector('#dClose').onclick = m.close; bindPhotos(m.box); bindAdj(m.box, () => { m.close(); renderSalary(); });
    });
    bindAdj($('repBody'), renderSalary); bindPhotos($('repBody'));
  }
  function detailTable(s) {
    const dedTxt = (r) => { const p = []; if (r.ded.late) p.push('تأخير'); if (r.ded.absence) p.push(r.status === 'half' ? 'نصف غياب' : 'غياب'); if (r.ded.early) p.push('مبكر'); if (r.ded.forgot) p.push('نسيان'); return p.join('، '); };
    return `<table><thead><tr><th>التاريخ</th><th>اليوم</th><th>الحضور</th><th>الانصراف</th><th>الحالة</th><th>التأخير</th><th>ساعات العمل</th><th>الخصم</th><th>ملاحظات</th><th></th></tr></thead><tbody>
      ${s.days.filter(r => r.status !== 'na').reverse().map(r => `<tr><td>${r.date}</td><td>${L.DAY_NAMES[L.weekday(r.date)]}</td><td><div class="tcell">${ph(r.inP)}${r.inP ? L.timeText(r.inP.ts) : '—'}</div></td>
        <td><div class="tcell">${ph(r.outP)}${r.outP ? L.timeText(r.outP.ts) : r.adj.manualOut ? L.hmText(r.adj.manualOut) + ' ✎' : '—'}</div></td><td>${statusTag(r)}</td>
        <td>${r.lateMin && !r.off ? L.durText(r.lateMin) : '—'}</td><td>${r.workedMin ? (r.workedMin / 60).toFixed(1) : '—'}</td>
        <td class="money ${r.total ? 'neg' : ''}">${r.total ? money(r.total) + `<br><small>${dedTxt(r)}</small>` : '—'}</td>
        <td style="font-size:12.5px;color:var(--muted)">${esc([r.adj.note, r.outP && r.outP.reason, ...r.notes].filter(Boolean).join(' • '))}</td>
        <td>${['future', 'na'].includes(r.status) ? '' : `<button class="btn ghost sm" data-adj="${s.emp.id}|${r.date}">تعديل</button>`}</td></tr>`).join('')}
    </tbody></table>`;
  }
  function logPunches() {
    const ids = new Set(selectedEmps().map(e => e.id));
    return Object.values(App.db.punches).filter(p => !p._del && (repState.emp === 'all' || ids.has(p.empId)) && p.date >= repState.from && p.date <= repState.to).sort((a, b) => b.ts - a.ts);
  }
  function empName(p) { const e = App.db.employees[p.empId]; return e ? e.name : (p.empName || '—'); }
  function punchNotes(p) {
    const n = []; if (p.flags?.suspect) n.push('⚠️ وقت غير مؤكد'); if (p.flags?.offDay) n.push('يوم عطلة');
    if (p.type === 'in' && p.lateMin > S().graceIn) n.push('متأخر ' + L.durText(p.lateMin)); if (p.flags?.early) n.push('مبكر ' + L.durText(p.flags.early));
    if (p.match) n.push('تطابق ' + p.match + '%');
    if (p.reason) n.push('السبب: ' + p.reason); if (p.manual) n.push('✎ يدوي'); if (p.flags?.auto) n.push('⏱️ انصراف تلقائي (نسي البصمة)'); if (p.edited) n.push('✎ معدّل'); return n.join(' • ');
  }
  function renderLog() {
    const list = logPunches().slice(0, 1500);
    $('repBody').innerHTML = `<div class="card" style="padding:0;overflow:auto">${list.length ? `<table><thead><tr><th>الصورة</th><th>الموظف</th><th>النوع</th><th>التاريخ</th><th>الوقت</th><th>الفرع / الحاسبة</th><th>ملاحظات</th><th></th></tr></thead><tbody>
      ${list.map(p => `<tr><td>${ph(p).replace('thumb sm', 'thumb') || '—'}</td><td>${esc(empName(p))}</td>
        <td>${p.type === 'in' ? '<span class="tag ok">حضور</span>' : '<span class="tag warn">انصراف</span>'}</td><td>${p.date}</td><td>${L.timeText(p.ts)}</td><td>${esc([p.branch, p.device].filter(Boolean).join(' — '))}</td>
        <td style="font-size:12.5px">${esc(punchNotes(p))}</td>
        <td class="row" style="justify-content:center"><button class="btn ghost sm" data-ep="${p.id}">تعديل</button><button class="btn danger sm" data-dp="${p.id}">حذف</button></td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">لا توجد بصمات في هذه الفترة</div>'}</div>`;
    bindPhotos($('repBody'));
    $('repBody').querySelectorAll('[data-ep]').forEach(b => b.onclick = () => editPunch(App.db.punches[b.dataset.ep]));
    $('repBody').querySelectorAll('[data-dp]').forEach(b => b.onclick = async () => {
      const p = App.db.punches[b.dataset.dp];
      const ok = await popup({ icon: '🗑️', title: 'حذف بصمة', text: `حذف بصمة ${p.type === 'in' ? 'الحضور' : 'الانصراف'} لـ <b>${esc(empName(p))}</b><br>${p.date} — ${L.timeText(p.ts)}؟`, kind: 'bad', buttons: [{ label: 'حذف', value: true, cls: 'danger' }, { label: 'إلغاء', value: false, cls: 'ghost' }] });
      if (!ok) return; put('punches', Object.assign({}, p, { _del: true })); audit('حذف بصمة', `${empName(p)} — ${p.type === 'in' ? 'حضور' : 'انصراف'} ${p.date} ${L.timeText(p.ts)}`); renderLog();
    });
  }
  function editPunch(p) {
    const isNew = !p, emps = employees(true);
    const d = p ? new Date(p.ts) : new Date(now());
    const m = modal(`<h2>${isNew ? 'إضافة بصمة يدوية' : 'تعديل بصمة'}</h2>
      <div class="grid g2">
        <div class="field"><label>الموظف</label><select id="pEmp" ${isNew ? '' : 'disabled'}>${emps.map(e => `<option value="${e.id}" ${p && p.empId === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select></div>
        <div class="field"><label>النوع</label><select id="pType"><option value="in" ${p && p.type === 'in' ? 'selected' : ''}>حضور</option><option value="out" ${p && p.type === 'out' ? 'selected' : ''}>انصراف</option></select></div>
        <div class="field"><label>تاريخ يوم الدوام</label><input type="date" id="pDate" value="${p ? p.date : L.dateStr(now())}"></div>
        <div class="field"><label>الوقت</label><input type="time" id="pTime" value="${L.pad(d.getHours())}:${L.pad(d.getMinutes())}"></div>
        <div class="field"><label>تاريخ الوقت الفعلي</label><input type="date" id="pRealDate" value="${L.dateStr(d.getTime())}"><span class="hint">يختلف عن يوم الدوام فقط للدوام الليلي</span></div>
        <div class="field"><label>ملاحظة</label><input id="pNote" value="${esc(p && p.reason || '')}"></div>
      </div>
      <div class="actions"><button class="btn" id="pSave">حفظ</button><button class="btn ghost" id="pCancel">إلغاء</button></div>`);
    const q = (id) => m.box.querySelector('#' + id);
    q('pDate').onchange = () => { q('pRealDate').value = q('pDate').value; };
    q('pCancel').onclick = m.close;
    q('pSave').onclick = () => {
      const empId = q('pEmp').value, emp = App.db.employees[empId]; if (!emp) return;
      const [y, mo, dd] = q('pRealDate').value.split('-').map(Number), [h, mi] = q('pTime').value.split(':').map(Number);
      const ts = new Date(y, mo - 1, dd, h, mi).getTime(), b = L.shiftBounds(emp, q('pDate').value);
      const rec = p ? Object.assign({}, p) : { id: uid(), empId, empName: emp.name, device: device(), branch: branch(), hasPhoto: false, manual: true, flags: {} };
      const before = p ? `${p.type === 'in' ? 'حضور' : 'انصراف'} ${p.date} ${L.timeText(p.ts)}` : '';
      Object.assign(rec, { type: q('pType').value, date: q('pDate').value, ts, reason: q('pNote').value.trim() });
      if (!isNew) rec.edited = true;
      rec.lateMin = rec.type === 'in' ? Math.max(0, Math.round((ts - b.start) / MIN)) : undefined;
      if (rec.type === 'out') { const early = Math.round((b.end - ts) / MIN); rec.flags = Object.assign({}, rec.flags); if (early > S().graceOut) rec.flags.early = early; else delete rec.flags.early; }
      put('punches', rec);
      audit(isNew ? 'بصمة يدوية' : 'تعديل بصمة', `${emp.name}: ${before ? before + ' ← ' : ''}${rec.type === 'in' ? 'حضور' : 'انصراف'} ${rec.date} ${L.timeText(ts)}`);
      m.close(); toast('تم الحفظ'); renderLog();
    };
  }
  function renderAudit() {
    const list = Object.values(App.db.audit || {}).filter(a => !a._del && L.dateStr(a.at) >= repState.from && L.dateStr(a.at) <= repState.to).sort((a, b) => b.at - a.at).slice(0, 1000);
    $('repBody').innerHTML = `<div class="card" style="padding:0;overflow:auto">${list.length ? `<table><thead><tr><th>الوقت</th><th>الحاسبة</th><th>العملية</th><th>التفاصيل</th><th>صورة</th></tr></thead><tbody>
      ${list.map(a => `<tr><td>${L.dateStr(a.at)} ${L.timeText(a.at)}</td><td>${esc(a.device)}</td><td>${esc(a.action)}</td><td style="text-align:right">${esc(a.detail)}</td><td>${a.photoId ? `<img class="thumb" data-ph="${a.photoId}" src="icon.png">` : ''}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">لا توجد عمليات في هذه الفترة</div>'}</div>`;
    $('repBody').querySelectorAll('[data-ph]').forEach(async img => { const d = await api.getPhoto(img.dataset.ph); if (d) { img.src = d; img.onclick = () => { const m = modal(`<img src="${d}" style="width:100%;border-radius:16px"><div class="actions"><button class="btn">إغلاق</button></div>`); m.box.querySelector('.btn').onclick = m.close; }; } else img.remove(); });
  }
  async function exportExcel() {
    const emps = selectedEmps(), one = emps.length === 1 && repState.emp !== 'all';
    const st = (r) => (L.STATUS[r.status] || ['—'])[0];
    let sheets, filename;
    if (repState.view === 'salary') {
      const t = now(), sums = emps.map(e => L.monthSummary(e, repState.ym, t, ctx()));
      const title = `تقرير الحضور والرواتب — ${repState.ym} — ${one ? emps[0].name : 'كل الموظفين'}`;
      sheets = [{
        name: 'الرواتب والخصومات', title,
        headers: ['الموظف', 'الكود', 'أيام الدوام', 'حضور', 'عدد التأخير', 'دقائق التأخير', 'غياب', 'نصف غياب', 'انصراف مبكر', 'نسيان انصراف', 'ساعات العمل', 'الراتب', 'خصم التأخير', 'خصم الغياب', 'خصم الانصراف المبكر', 'خصم النسيان', 'مجموع الخصومات', 'الصافي'],
        rows: sums.map(s => [s.emp.name, s.emp.code, s.workDays, s.present, s.lateCount, s.lateMin, s.absentCount, s.halfCount, s.earlyCount, s.forgotCount, +(s.workedMin / 60).toFixed(1), s.salary, s.ded.late, s.ded.absence, s.ded.early, s.ded.forgot, s.totalDed, s.net])
          .concat(sums.length > 1 ? [['المجموع', '', '', '', '', '', '', '', '', '', '', sums.reduce((a, s) => a + s.salary, 0), '', '', '', '', sums.reduce((a, s) => a + s.totalDed, 0), sums.reduce((a, s) => a + s.net, 0)]] : []),
        widths: [22]
      }, {
        name: 'التفاصيل اليومية', title,
        headers: ['الموظف', 'التاريخ', 'اليوم', 'الحضور', 'الانصراف', 'الحالة', 'التأخير (دقيقة)', 'ساعات العمل', 'الخصم', 'ملاحظات'],
        rows: sums.flatMap(s => s.days.filter(r => !['future', 'na'].includes(r.status)).map(r => [s.emp.name, r.date, L.DAY_NAMES[L.weekday(r.date)], r.inP ? L.timeText(r.inP.ts) : '', r.outP ? L.timeText(r.outP.ts) : (r.adj.manualOut ? L.hmText(r.adj.manualOut) + ' (يدوي)' : ''), st(r), r.off ? 0 : r.lateMin, r.workedMin ? +(r.workedMin / 60).toFixed(1) : 0, r.total, [r.adj.note, r.outP && r.outP.reason, ...r.notes].filter(Boolean).join(' • ')])),
        widths: [22, 12, 10, 12, 14, 16, 12, 12, 12, 30]
      }];
      filename = `تقرير-الحضور-${repState.ym}${one ? '-' + emps[0].name : ''}.xlsx`;
    } else if (repState.view === 'log') {
      sheets = [{ name: 'سجل البصمات', title: `سجل البصمات ${repState.from} إلى ${repState.to} — ${one ? emps[0].name : 'كل الموظفين'}`, headers: ['الصورة', 'الموظف', 'النوع', 'تاريخ الدوام', 'الوقت', 'الفرع', 'الحاسبة', 'ملاحظات'], rows: logPunches().map(p => [p.thumb ? { image: p.thumb } : '', empName(p), p.type === 'in' ? 'حضور' : 'انصراف', p.date, L.timeText(p.ts), p.branch || '', p.device || '', punchNotes(p)]), widths: [11, 22, 10, 14, 12, 16, 16, 40] }];
      filename = `سجل-البصمات-${repState.from}-${repState.to}${one ? '-' + emps[0].name : ''}.xlsx`;
    } else {
      const list = Object.values(App.db.audit || {}).filter(a => L.dateStr(a.at) >= repState.from && L.dateStr(a.at) <= repState.to).sort((a, b) => b.at - a.at);
      sheets = [{ name: 'سجل التعديلات', title: `سجل التعديلات ${repState.from} إلى ${repState.to}`, headers: ['التاريخ', 'الوقت', 'الحاسبة', 'العملية', 'التفاصيل'], rows: list.map(a => [L.dateStr(a.at), L.timeText(a.at), a.device, a.action, a.detail]), widths: [12, 10, 16, 18, 50] }];
      filename = `سجل-التعديلات-${repState.from}-${repState.to}.xlsx`;
    }
    const r = await api.exportExcel({ filename: filename.replace(/[\\/:*?"<>|]/g, '-'), sheets });
    if (r.ok) toast('تم حفظ ملف Excel');
  }

  // ================= المراجعة =================
  function reviewItems() {
    const t = now(), out = [];
    for (const e of employees(true)) {
      for (let i = 0; i <= 45; i++) {
        const d = L.addDays(L.dateStr(t), -i), r = L.dayInfo(e, d, t, ctx());
        if (r.status === 'forgot' && !r.adj.reviewed) out.push({ e, r, kind: 'forgot' });
        else if (r.inP && r.inP.flags && r.inP.flags.suspect && !r.adj.reviewed) out.push({ e, r, kind: 'suspect' });
      }
    }
    return out;
  }
  function updateBadge() { const n = reviewItems().length, b = $('reviewBadge'); b.textContent = n; b.classList.toggle('hidden', !n); }
  function renderReview() {
    const items = reviewItems();
    $('reviewView').innerHTML = `<div class="page-head"><h1>حالات تحتاج مراجعة (${items.length})</h1></div>
      <p style="color:var(--muted);margin-top:-8px">موظفين نسوا تسجيل الانصراف (تسجّل لهم انصراف تلقائي بوقت نهاية الدوام)، أو بصمات بوقت حاسبة غير مؤكد. لا يُطبّق خصم النسيان إلا إذا اخترته أنت.</p>
      <div class="card" style="padding:0;overflow:auto">${items.length ? `<table><thead><tr><th>الموظف</th><th>التاريخ</th><th>الحضور</th><th>نهاية الدوام</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>
      ${items.map(({ e, r, kind }) => `<tr><td><b>${esc(e.name)}</b></td><td>${esc(dayLabel(r.date))}</td><td>${L.timeText(r.inP.ts)}</td><td>${L.timeText(r.b.end)}</td>
        <td>${kind === 'forgot' ? '<span class="tag warn">نسي الانصراف</span>' : '<span class="tag warn">⚠️ وقت غير مؤكد</span>'}</td>
        <td class="row" style="justify-content:center">
          ${kind === 'forgot' ? `<button class="btn green sm" data-q="${e.id}|${r.date}|end">تأكيد الانصراف (بدون خصم)</button><button class="btn danger sm" data-q="${e.id}|${r.date}|pen">تطبيق خصم النسيان</button>` : `<button class="btn green sm" data-q="${e.id}|${r.date}|ok">الوقت صحيح</button>`}
          <button class="btn ghost sm" data-adj="${e.id}|${r.date}">تعديل مفصّل</button></td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">✅ لا توجد حالات تحتاج مراجعة</div>'}</div>`;
    $('reviewView').querySelectorAll('[data-q]').forEach(b => b.onclick = () => {
      const [id, d, act] = b.dataset.q.split('|'), e = App.db.employees[id], key = id + '_' + d, a = App.db.days[key] || {};
      const rec = Object.assign({}, a, { id: key, empId: id, date: d, reviewed: true });
      if (act === 'end') rec.manualOut = e.end;
      if (act === 'pen') rec.forgotPenalty = true;
      put('days', rec); audit('مراجعة', `${e.name} — ${d}: ${act === 'end' ? 'انصراف بوقت نهاية الدوام' : act === 'pen' ? 'خصم نسيان الانصراف' : 'تأكيد الوقت'}`);
      renderReview(); updateBadge();
    });
    bindAdj($('reviewView'), () => { renderReview(); updateBadge(); });
  }

  // ================= الإعدادات =================
  async function renderSettings() {
    const s = S(), c = App.db.local.cloud || {}, info = await api.info();
    $('setView').innerHTML = `
      <div class="page-head"><h1>الإعدادات</h1><button class="btn" id="sSave">💾 حفظ الإعدادات</button></div>
      <div class="grid g2">
        <div class="card"><h3>الخصومات (${esc(s.currency)})</h3><div class="grid g2">
          <div class="field"><label>خصم التأخير</label><input type="number" step="1000" min="0" id="sLate" value="${s.dedLate}"></div>
          <div class="field"><label>خصم الغياب</label><input type="number" step="1000" min="0" id="sAbs" value="${s.dedAbsence}"></div>
          <div class="field"><label>خصم الانصراف المبكر</label><input type="number" step="1000" min="0" id="sEarly" value="${s.dedEarly}"></div>
          <div class="field"><label>خصم نسيان الانصراف (يطبقه الأدمن)</label><input type="number" step="1000" min="0" id="sForgot" value="${s.dedForgot}"></div>
          <div class="field"><label>العملة</label><input id="sCur" value="${esc(s.currency)}"></div>
        </div>
        <label class="switch" style="margin-top:12px"><input type="checkbox" id="sHalf" ${s.halfAbsenceRule ? 'checked' : ''}> إذا اشتغل أقل من نص ساعات دوامه يُحسب نصف غياب</label></div>

        <div class="card"><h3>أوقات السماح والتنبيهات</h3><div class="grid g2">
          <div class="field"><label>سماح التأخير بالحضور (دقيقة)</label><input type="number" min="0" id="sGIn" value="${s.graceIn}"></div>
          <div class="field"><label>سماح الانصراف المبكر (دقيقة)</label><input type="number" min="0" id="sGOut" value="${s.graceOut}"></div>
          <div class="field"><label>انصراف تلقائي بعد نهاية الدوام بـ (ساعة)</label><input type="number" min="1" max="12" id="sAuto" value="${s.autoCloseHours}"></div>
        </div>
        <label class="switch" style="margin-top:12px"><input type="checkbox" id="sAO" ${s.autoOut !== false ? 'checked' : ''}> انصراف تلقائي إذا نسي البصمة (بعد مدة الإغلاق أعلاه) + إبلاغ الإدارة</label>
        <label class="switch" style="margin-top:12px"><input type="checkbox" id="sInR" ${s.inReminder !== false ? 'checked' : ''}> تذكير الحضور (إشعار ببداية الدوام + تنبيه كبير إذا انتهى وقت السماح وما سجّل)</label>
        <label class="switch" style="margin-top:8px"><input type="checkbox" id="sPre" ${s.preReminder ? 'checked' : ''}> تنبيه صغير قبل نهاية الدوام بـ 10 دقائق</label>
        <label class="switch" style="margin-top:8px"><input type="checkbox" id="sBig" ${s.bigReminder ? 'checked' : ''}> تنبيه كبير عند نهاية الدوام (يتكرر كل 10 دقائق لمدة ساعة)</label></div>

        <div class="card"><h3>بصمة الوجه</h3>
          <label class="switch"><input type="checkbox" id="sLive" ${s.liveness ? 'checked' : ''}> طلب رمشة العين (حماية إضافية من البصمة بصورة موبايل — يخلي البصمة أبطأ)</label>
          <div class="field" style="margin-top:12px"><label>دقة المطابقة</label><select id="sStrict">
            <option value="low" ${s.strictness === 'low' ? 'selected' : ''}>متساهلة (أسهل — أقل أمان)</option>
            <option value="medium" ${s.strictness === 'medium' ? 'selected' : ''}>متوسطة (موصى بها)</option>
            <option value="high" ${s.strictness === 'high' ? 'selected' : ''}>صارمة (أصعب — أكثر أمان)</option></select></div></div>

        <div class="card"><h3>هذه الحاسبة</h3>
          <div class="grid g2"><div class="field"><label>اسم الفرع (يظهر بإشعارات تطبيق المدير)</label><input id="sBranch" value="${esc(App.db.local.branch || '')}" placeholder="الفرع الرئيسي"></div>
          <div class="field"><label>اسم الحاسبة (يظهر بسجل البصمات)</label><input id="sDev" value="${esc(App.db.local.deviceName || '')}"></div></div>
          <label class="switch" style="margin-top:12px"><input type="checkbox" id="sAutoStart" ${info.autostart ? 'checked' : ''}> تشغيل البرنامج تلقائياً مع ويندوز (بجانب الساعة)</label>
          <div class="row" style="margin-top:12px"><button class="btn ghost" id="sPw">تغيير كلمة مرور الإدارة</button><button class="btn ghost" id="sDir">فتح مجلد البيانات</button></div>
          <small style="color:var(--muted)">الإصدار ${esc(info.version)}</small></div>

        <div class="card" style="grid-column:1/-1"><h3>☁️ الربط بالسحابة — ${c.url ? '<span class="tag ok">مربوط ✓</span>' : '<span class="tag muted">غير مربوط (يعمل أوفلاين)</span>'}</h3>
          <div class="guide">
            <div><b>💾 بدون ربط (أوفلاين):</b> البرنامج يشتغل كامل على هذي الحاسبة بس — البصمة والتقارير والرواتب. ما يحتاج إنترنت أبداً.</div>
            <div><b>☁️ بعد الربط (أونلاين):</b> البصمات تترفع لسحابة خاصة بيك، فتقدر تربط حاسبة ثانية أو فرع ثاني، وتشوف كل شي من تطبيق المدير على الايفون.</div>
            <div><b>📴 إذا انقطع الإنترنت بعد الربط:</b> البصمة تبقى تشتغل عادي وتنحفظ بالحاسبة، وأول ما يرجع النت تترفع تلقائياً. ما يضيع أي تسجيل.</div>
          </div>
          <div class="grid g3">
            <div class="field"><label>رابط المشروع (Project URL)</label><input id="cUrl" dir="ltr" value="${esc(c.url || '')}" placeholder="https://xxxx.supabase.co"></div>
            <div class="field"><label>المفتاح العام (Publishable key — يبدأ بـ sb_publishable أو anon)</label><input id="cKey" dir="ltr" type="password" value="${esc(c.key || '')}"></div>
            <div class="field"><label>كود المحل (نفسه بكل الحاسبات)</label><div class="row"><input id="cWs" dir="ltr" style="flex:1" value="${esc(c.ws || '')}"><button class="btn ghost sm" id="cGen">توليد</button></div></div>
          </div>
          <div class="row" style="margin-top:12px"><button class="btn" id="cTest">اختبار الاتصال وحفظ</button><button class="btn ghost" id="cSync">مزامنة الآن</button><button class="btn ghost" id="cSql">📋 نسخ كود الإعداد (SQL)</button><button class="btn ghost" id="cOff">إلغاء الربط</button>
            <span id="cMsg" style="color:var(--muted)"></span></div>
          <details style="margin-top:12px" ${c.url ? '' : 'open'}><summary style="cursor:pointer;color:var(--gold)">📖 شرح الربط خطوة بخطوة (مرة وحدة بس — مجاني)</summary>
            <ol class="steps">
              <li>افتح موقع <b dir="ltr">supabase.com</b> وسوّي حساب مجاني (تكدر تدخل بحساب Google أو GitHub).</li>
              <li>اضغط <b>New project</b>، اكتب أي اسم (مثلاً <span dir="ltr">ibra-attendance</span>) وكلمة مرور، واختار أقرب منطقة (مثلاً Frankfurt)، وانتظر دقيقتين لين يجهز.</li>
              <li>ارجع للبرنامج واضغط زر <b>📋 نسخ كود الإعداد (SQL)</b>.</li>
              <li>بموقع Supabase من القائمة الجانبية افتح <b>SQL Editor</b>، الصق الكود، واضغط <b>Run</b>. لازم تطلع <span dir="ltr">Success</span>.</li>
              <li>افتح <b>Project Settings ← API</b> (أو زر <b>Connect</b>)، انسخ <b dir="ltr">Project URL</b> والصقه بالخانة الأولى، وانسخ المفتاح العام (<b dir="ltr">Publishable key</b> يبدأ بـ <span dir="ltr">sb_publishable_</span>، أو <b dir="ltr">anon</b>) والصقه بالخانة الثانية. ⚠️ لا تلصق المفتاح بموقع Supabase.</li>
              <li>اضغط <b>توليد</b> جنب كود المحل، وبعدين <b>اختبار الاتصال وحفظ</b>. إذا طلع <b>✅ متصل ومتزامن</b> خلص الربط، وكل الموظفين والبصمات القديمة تترفع تلقائياً.</li>
              <li><b>للحاسبة الثانية أو الفرع الثاني:</b> نصّب البرنامج، وحط نفس الرابط والمفتاح ونفس كود المحل، واكتب اسم الفرع بقسم "هذه الحاسبة". الموظفين يظهرون تلقائياً.</li>
            </ol></details></div>

        <div class="card" style="grid-column:1/-1"><h3>📱 ربط تطبيق المدير (الايفون)</h3>
          ${c.url ? `<div class="mgr-link">
            <div class="qrbox"><img id="mgrQR" alt=""><small>امسح هذا الرمز من تطبيق المدير</small></div>
            <div style="flex:1">
              <ol class="steps">
                <li>افتح تطبيق <b>مدير بصمة IBRA</b> على الايفون.</li>
                <li>اضغط <b>📷 مسح رمز الربط</b> ووافق على الكاميرا.</li>
                <li>وجّه الكاميرا على المربع الأسود والأبيض — يرتبط مباشرة.</li>
                <li>وافق على الإشعارات حتى يوصلك إشعار بكل بصمة.</li>
              </ol>
              <p style="color:var(--muted);font-size:13px">ما يشتغل المسح؟ دز الكود لنفسك والصقه بالتطبيق بدل المسح.</p>
              <div class="row"><button class="btn ghost" id="mgrCopy">📋 نسخ كود الربط</button></div>
              <p style="color:var(--warn);font-size:12.5px">⚠️ هذا الرمز يفتح سجل محلك — لا تنشره ولا تصوره لأحد.</p>
            </div></div>`
          : `<div class="guide"><div>🔒 تطبيق المدير يقرأ السجل من السحابة، فلازم <b>تربط البرنامج بالسحابة أولاً</b> (القسم أعلاه). بعد الربط يطلع هنا رمز QR تمسحه بالايفون ويرتبط مباشرة.</div></div>`}
        </div>

        <div class="card" style="grid-column:1/-1"><h3>النسخ الاحتياطي</h3>
          <p style="color:var(--muted);margin-top:0">البرنامج ياخذ نسخة تلقائية كل يوم (آخر 30 يوم) داخل مجلد البيانات.</p>
          <div class="row"><button class="btn ghost" id="bExp">⬇ حفظ نسخة احتياطية</button><button class="btn ghost" id="bImp">⬆ استرجاع نسخة</button></div></div>
      </div>`;
    const q = (id) => $(id);
    q('sSave').onclick = () => {
      const n = (id, d) => { const v = Number(q(id).value); return isFinite(v) && v >= 0 ? v : d; };
      const rec = Object.assign({}, S(), {
        dedLate: n('sLate', s.dedLate), dedAbsence: n('sAbs', s.dedAbsence), dedEarly: n('sEarly', s.dedEarly), dedForgot: n('sForgot', s.dedForgot), currency: q('sCur').value.trim() || 'د.ع',
        halfAbsenceRule: q('sHalf').checked, graceIn: n('sGIn', 30), graceOut: n('sGOut', 15), autoCloseHours: Math.max(1, n('sAuto', 2)),
        autoOut: q('sAO').checked, inReminder: q('sInR').checked, preReminder: q('sPre').checked, bigReminder: q('sBig').checked, liveness: q('sLive').checked, strictness: q('sStrict').value
      });
      put('settings', rec);
      App.db.local.deviceName = q('sDev').value.trim() || 'حاسبة'; App.db.local.branch = q('sBranch').value.trim() || 'الفرع الرئيسي'; App.saveSoon();
      api.setAutostart(q('sAutoStart').checked);
      audit('تعديل الإعدادات', `تأخير ${rec.dedLate} • غياب ${rec.dedAbsence} • مبكر ${rec.dedEarly} • نسيان ${rec.dedForgot} • سماح ${rec.graceIn}/${rec.graceOut}`);
      toast('تم حفظ الإعدادات');
    };
    q('sPw').onclick = () => setPassword(false);
    q('sDir').onclick = () => api.openDataDir();
    q('cGen').onclick = () => { q('cWs').value = 'IBRA-' + Math.random().toString(36).slice(2, 6).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase(); };
    q('cSql').onclick = async () => { await api.copy(Sync.SQL); toast('✅ تم نسخ كود SQL — الصقه بـ SQL Editor بموقع Supabase واضغط Run'); };
    q('cTest').onclick = async () => {
      const cfg = { url: q('cUrl').value.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, ''), key: q('cKey').value.replace(/\s+/g, ''), ws: q('cWs').value.trim() };
      if (/^sb_secret_/.test(cfg.key)) { q('cMsg').textContent = '❌ هذا المفتاح السري — استخدم المفتاح العام (publishable أو anon)'; return; }
      if (!/^https:\/\/.+/.test(cfg.url) || !cfg.key || !cfg.ws) { q('cMsg').textContent = 'املأ الحقول الثلاثة'; return; }
      q('cMsg').textContent = 'جاري الاختبار…';
      try {
        await Sync.test(cfg);
        const changedWs = (App.db.local.cloud || {}).ws !== cfg.ws;
        App.db.local.cloud = cfg;
        if (changedWs) { App.db.meta.lastSrv = 0; markAllDirty(); }
        App.save(); q('cMsg').textContent = '✅ تم الاتصال — جاري المزامنة'; await Sync.run(true); q('cMsg').textContent = '✅ متصل ومتزامن'; setTimeout(renderSettings, 1200);
      } catch (e) { q('cMsg').textContent = '❌ ' + e.message; }
    };
    q('cSync').onclick = () => Sync.run(true);
    if (c.url) {
      const code = 'IBRA1:' + btoa(unescape(encodeURIComponent(JSON.stringify({ url: c.url, key: c.key, ws: c.ws }))));
      api.makeQR(code).then(u => { if ($('mgrQR')) $('mgrQR').src = u; });
      q('mgrCopy').onclick = async () => { await api.copy(code); toast('تم نسخ كود الربط'); };
    }
    q('cOff').onclick = async () => {
      if (!(await popup({ icon: '⚠️', title: 'إلغاء الربط', text: 'البرنامج يرجع يشتغل أوفلاين على هذي الحاسبة بس، وتطبيق المدير يوقف يوصله جديد. البيانات تبقى محفوظة.', kind: 'warn', buttons: [{ label: 'إلغاء الربط', value: true, cls: 'danger' }, { label: 'رجوع', value: false, cls: 'ghost' }] }))) return;
      App.db.local.cloud = {}; App.save(); renderSync(); renderSettings(); Sync.run(); };
    q('bExp').onclick = () => api.exportBackup(App.db);
    q('bImp').onclick = async () => {
      const d = await api.importBackup(); if (!d) return;
      if (d.__error || !d.employees) return popup({ icon: '❌', title: 'ملف غير صالح', text: 'هذا الملف ليس نسخة احتياطية من البرنامج', kind: 'bad' });
      const ok = await popup({ icon: '⚠️', title: 'استرجاع نسخة', text: 'سيتم استبدال كل البيانات الحالية بالنسخة المختارة. متأكد؟', kind: 'warn', buttons: [{ label: 'استرجاع', value: true, cls: 'danger' }, { label: 'إلغاء', value: false, cls: 'ghost' }] });
      if (!ok) return; const local = App.db.local; App.db = normalize(d); App.db.local = local; markAllDirty(); await App.save(); toast('تم الاسترجاع'); renderSettings();
    };
  }
  function markAllDirty() { for (const coll of ['employees', 'punches', 'days', 'settings', 'audit']) for (const id in (App.db[coll] || {})) Sync.markDirty(coll, id); }

  function setPassword(first) {
    return new Promise((resolve) => {
      const m = modal(`<h2>${first ? '👋 أهلاً بك في بصمة IBRA' : 'تغيير كلمة مرور الإدارة'}</h2>
        ${first ? '<p style="color:var(--muted)">أول مرة تشغيل — حدد كلمة مرور الإدارة. تحتاجها لفتح التقارير والإعدادات والتعديل والحذف والخروج من البرنامج.</p>' : ''}
        <div class="grid">
          ${first ? `<div class="field"><label>اسم هذه الحاسبة</label><input id="nDev" value="${esc(App.db.local.deviceName || 'حاسبة الاستقبال')}"></div>` : ''}
          <div class="field"><label>كلمة المرور الجديدة</label><input type="password" id="n1"></div>
          <div class="field"><label>تأكيد كلمة المرور</label><input type="password" id="n2"></div>
        </div><div id="nErr" class="flag"></div>
        <div class="actions"><button class="btn" id="nOk">حفظ</button>${first ? '' : '<button class="btn ghost" id="nCancel">إلغاء</button>'}</div>`);
      const q = (id) => m.box.querySelector('#' + id);
      setTimeout(() => (q('nDev') || q('n1')).focus(), 50);
      if (!first) q('nCancel').onclick = () => { m.close(); resolve(false); };
      q('nOk').onclick = async () => {
        if (q('n1').value.length < 4) return (q('nErr').textContent = 'كلمة المرور 4 أحرف أو أرقام على الأقل');
        if (q('n1').value !== q('n2').value) return (q('nErr').textContent = 'كلمتا المرور غير متطابقتين');
        if (first) App.db.local.deviceName = q('nDev').value.trim() || 'حاسبة';
        put('settings', Object.assign({}, S(), { adminHash: await api.hash(q('n1').value) }));
        if (!first) audit('تغيير كلمة المرور', '');
        await App.save(); m.close(); toast('تم الحفظ'); resolve(true);
      };
    });
  }

  // ================= حول =================
  function renderAbout() {
    $('aboutView').innerHTML = `<div class="about">
      <img src="icon.png"><h1>بصمة IBRA</h1><p style="color:var(--muted)">برنامج حضور وانصراف الموظفين ببصمة الوجه</p>
      <p style="font-size:18px">برمجة وتطوير <b style="color:var(--gold2)">ابراهيم الخزرجي</b></p>
      <div class="card upd" style="text-align:right">
        <h3>🔄 التحديثات</h3>
        <div class="row"><span>الإصدار الحالي: <b id="uCur">—</b></span><span class="spacer"></span><button class="btn" id="uCheck">فحص التحديثات</button></div>
        <div id="uMsg" style="margin-top:10px;color:var(--muted)"></div>
        <div id="uBarWrap" class="hidden" style="margin-top:10px"><div class="cam-progress" style="margin:0"><i id="uBar"></i></div><small id="uPct" style="color:var(--muted)"></small></div>
        <div id="uActions" class="row hidden" style="margin-top:12px"></div>
      </div>
      <div class="links">
        <div>🌐 موقع التطبيقات: <a data-url="https://ibraprogram.netlify.app/">ibraprogram.netlify.app</a></div>
        <div>✈️ تيليكرام: <a data-url="https://t.me/ibraprogram">t.me/ibraprogram</a></div>
        <div>🎵 تيك توك: <a data-url="https://www.tiktok.com/@ibraprogram">ibraprogram</a></div>
      </div></div>`;
    $('aboutView').querySelectorAll('[data-url]').forEach(a => a.onclick = () => api.openExternal(a.dataset.url));
    api.info().then(i => { $('uCur').textContent = i.version; });
    $('uCheck').onclick = () => checkUpdate(true);
    if (upd.state) showUpd();
  }

  // ================= التحديث الداخلي =================
  const upd = { state: null, latest: '', size: 0, notes: '', err: '' };
  const mb = (b) => (b / 1048576).toFixed(1) + ' ميغا';
  function showUpd() {
    if (!$('uMsg')) return;
    const a = $('uActions'); a.classList.add('hidden'); a.innerHTML = '';
    const set = (t) => { $('uMsg').innerHTML = t; };
    if (upd.state === 'checking') set('⏳ جاري الفحص…');
    else if (upd.state === 'none') set('✅ عندك آخر إصدار');
    else if (upd.state === 'error') set('❌ ' + esc(upd.err));
    else if (upd.state === 'available' || upd.state === 'ready') {
      const notes = esc(upd.notes.replace(/\*\*/g, '').replace(/`/g, '')).split('\n').filter(l => /^\s*-/.test(l) && !/IBRA-Attendance|\.exe|\.ipa/i.test(l)).join('<br>');
      set(`🎉 <b style="color:var(--gold2)">إصدار جديد ${esc(upd.latest)}</b> (${mb(upd.size)})${notes ? `<div style="margin-top:6px;font-size:13px">${notes}</div>` : ''}`);
      a.classList.remove('hidden');
      a.innerHTML = upd.state === 'ready' ? '<button class="btn green" id="uInst">تثبيت التحديث الآن</button><span style="color:var(--muted)">تم التحميل ✓</span>' : '<button class="btn" id="uDl">⬇ تحميل التحديث</button>';
      if ($('uDl')) $('uDl').onclick = downloadUpdate;
      if ($('uInst')) $('uInst').onclick = installUpdate;
    }
    $('uBarWrap').classList.toggle('hidden', upd.state !== 'downloading');
    if (upd.state === 'downloading') set('⬇ جاري تحميل الإصدار ' + esc(upd.latest) + '…');
  }
  function aboutBadge(on) { const b = document.querySelector('#nav [data-tab=about]'); if (b) b.innerHTML = on ? 'حول <span class="badge">جديد</span>' : 'حول'; }
  async function checkUpdate(manual) {
    if (upd.state === 'downloading') return;
    upd.state = 'checking'; showUpd();
    const r = await api.updCheck();
    if (!r.ok) { upd.state = manual ? 'error' : null; upd.err = r.error; showUpd(); return; }
    if (!r.available) { upd.state = manual ? 'none' : null; aboutBadge(false); showUpd(); return; }
    Object.assign(upd, { state: upd.state === 'ready' && upd.latest === r.latest ? 'ready' : 'available', latest: r.latest, size: r.size, notes: r.notes });
    aboutBadge(true); showUpd();
    if (!manual && App.db.local.updAsked !== r.latest) {
      App.db.local.updAsked = r.latest; App.saveSoon();
      const ok = await popup({ icon: '🔄', title: 'تحديث جديد متوفر', text: `الإصدار <b>${esc(r.latest)}</b> صار متوفر (عندك ${esc(r.current)}).<br>تريد تحمّله الآن؟`, sub: 'التحميل بالخلفية والبرنامج يبقى شغال', kind: 'ok', buttons: [{ label: 'تحميل', value: true }, { label: 'لاحقاً', value: false, cls: 'ghost' }] });
      if (ok) downloadUpdate();
    }
  }
  async function downloadUpdate() {
    upd.state = 'downloading'; showUpd();
    const r = await api.updDownload();
    if (!r.ok) { upd.state = 'error'; upd.err = r.error; showUpd(); return; }
    upd.state = 'ready'; showUpd();
    const ok = await popup({ icon: '✅', title: 'تم تحميل التحديث', text: `الإصدار <b>${esc(upd.latest)}</b> جاهز.<br>تثبّته الآن؟`, sub: 'البرنامج يتسكر ثواني ويرجع يشتغل تلقائياً — الموظفين والبصمات ما تتأثر', kind: 'ok', buttons: [{ label: 'تثبيت الآن', value: true }, { label: 'لاحقاً', value: false, cls: 'ghost' }] });
    if (ok) installUpdate();
  }
  async function installUpdate() {
    if (!(await ensureAdmin())) return;
    await App.save();
    toast('⏳ جاري التثبيت… البرنامج يرجع يشتغل بعد ثواني');
    setTimeout(() => api.updInstall(), 600);
  }
  api.on('update-progress', ({ got, total }) => {
    const p = total ? Math.round(got / total * 100) : 0;
    if ($('uBar')) { $('uBar').style.width = p + '%'; $('uPct').textContent = `${p}% — ${mb(got)} من ${mb(total)}`; }
  });

  // ================= التنبيهات الدورية =================
  const shown = {};
  function reminders() {
    const t = now(), s = S();
    for (const e of employees()) {
      const sd = L.currentShiftDate(e, t, s), r = L.dayInfo(e, sd, t, ctx());
      const k = e.id + sd, b = r.b;
      // تذكير الحضور: بداية الدوام + بعد انتهاء وقت السماح
      if (!r.inP && !r.off && !r.adj.leave && s.inReminder !== false && !['na'].includes(r.status)) {
        if (t >= b.start && t < b.start + 5 * MIN && !shown[k + 'in0']) { shown[k + 'in0'] = 1; api.notify('بصمة IBRA', `بدأ دوام ${e.name} — يرجى تسجيل الحضور`); }
        const g = b.start + s.graceIn * MIN;
        if (t >= g && t < g + 30 * MIN && !shown[k + 'in1']) {
          shown[k + 'in1'] = 1;
          api.showAlert({ kind: 'in', title: 'لم يتم تسجيل الحضور', name: e.name, empId: e.id, msg: `دوام ${e.name} بدأ الساعة ${L.timeText(b.start)} وانتهى وقت السماح — أي تسجيل الآن يُحسب تأخير`, photo: e.photo || null, repeat: 0 });
        }
      }
      if (!r.inP || r.outP || r.adj.manualOut) continue;
      if (s.preReminder && t >= b.end - 10 * MIN && t < b.end && !shown[k + 'pre']) {
        shown[k + 'pre'] = 1; api.notify('بصمة IBRA', `باقي 10 دقائق على نهاية دوام ${e.name}`);
      }
      if (s.bigReminder && t >= b.end && t < b.end + 60 * MIN) {
        const n = Math.floor((t - b.end) / (10 * MIN));
        if (!shown[k + 'big' + n]) {
          shown[k + 'big' + n] = 1;
          api.showAlert({ title: 'انتهى وقت الدوام', name: e.name, empId: e.id, endText: L.timeText(b.end), photo: e.photo || null, repeat: n });
        }
      }
    }
  }
  // انصراف تلقائي: إذا نسي الموظف البصمة ومرّ وقت الإغلاق (افتراضياً ساعتين) — يشتغل حتى بعد تشغيل الحاسبة لاحقاً
  function autoClose() {
    const t = now(), s = S(); let n = 0;
    if (s.autoOut === false) return;
    for (const e of employees()) {
      for (let i = 0; i <= 7; i++) {
        const d = L.addDays(L.dateStr(t), -i), r = L.dayInfo(e, d, t, ctx());
        if (!r.inP || r.outP || r.adj.manualOut || r.status !== 'forgot') continue;
        const id = 'auto_' + e.id + '_' + d;   // نفس الرقم بكل الحاسبات حتى ما يتكرر
        if (App.db.punches[id] && !App.db.punches[id]._del) continue;
        if (App.db.punches[id] && App.db.punches[id]._del) continue;   // الأدمن حذفه — لا نرجعه
        put('punches', { id, empId: e.id, empName: e.name, date: d, type: 'out', ts: r.b.end, device: device(), branch: (r.inP && r.inP.branch) || branch(), hasPhoto: false, auto: true, flags: { auto: true }, reason: 'انصراف تلقائي — نسي تسجيل الانصراف' });
        audit('انصراف تلقائي', `${e.name} — ${d}: نسي تسجيل الانصراف، تسجّل بوقت نهاية الدوام ${L.timeText(r.b.end)}`);
        n++;
      }
    }
    if (n) { api.notify('بصمة IBRA', `تم تسجيل انصراف تلقائي لـ ${n} ${n === 1 ? 'موظف' : 'حالات'} نسوا البصمة — بانتظار مراجعة الإدارة`); updateBadge(); }
  }
  function tick() {
    autoClose();
    const suspect = Sync.checkClock();
    $('clockWarn').classList.toggle('hidden', !(suspect && !Sync.hasTimeBase()));
    reminders(); updateBadge(); updatePunchButtons();
    if (current === 'today') renderToday();
  }

  // ================= التشغيل =================
  function normalize(d) {
    d = d || {};
    d.version = 1;
    for (const k of ['employees', 'punches', 'days', 'audit']) d[k] = d[k] || {};
    d.settings = d.settings || {};
    d.settings.main = Object.assign({ id: 'main' }, L.DEFAULT_SETTINGS, d.settings.main || {});
    if (!d.settings.main.easyV2) { d.settings.main.liveness = false; d.settings.main.easyV2 = true; }  // البصمة السهلة افتراضياً
    d.meta = Object.assign({ dirty: {}, lastSrv: 0, offset: 0 }, d.meta || {});
    d.local = Object.assign({ deviceName: '', cloud: {} }, d.local || {});
    return d;
  }
  async function boot() {
    App.db = normalize(await api.loadDB());
    if (App.db.meta.lastWallSeen && Date.now() < App.db.meta.lastWallSeen - 5 * MIN) App.db.meta.clockSuspect = true; // الساعة رجعت لورا منذ آخر تشغيل
    buildKeypad();
    document.querySelectorAll('#nav button').forEach(b => b.onclick = () => go(b.dataset.tab));
    $('lockBtn').onclick = lockAdmin;
    api.on('navigate', (tab) => go(tab));
    api.on('request-quit', async () => { if (await askPassword('الخروج من البرنامج يحتاج كلمة مرور الإدارة')) api.quit(); });
    api.on('quick-punch', ({ type, empId }) => { go('punch'); const e = App.db.employees[empId]; if (e) startPunch(type, e); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const ov = $('modalRoot').lastElementChild; if (ov && !ov.querySelector('#nOk')) ov.remove(); } });
    tickClock(); setInterval(tickClock, 1000);
    setInterval(() => { App.db.meta.lastWallSeen = Math.max(App.db.meta.lastWallSeen || 0, Date.now()); }, 60000);
    renderSync();
    if (!S().adminHash) await setPassword(true);
    if (!App.db.local.deviceName) { App.db.local.deviceName = 'حاسبة'; App.saveSoon(); }
    Face.init().catch(() => {});  // تحميل مسبق لنموذج الوجه
    Sync.run(true);
    setInterval(() => Sync.run(), 60000);
    tick(); setInterval(tick, 20000);
    setTimeout(() => checkUpdate(false), 20000); setInterval(() => checkUpdate(false), 6 * 3600e3);
    $('codeInput').focus();
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
