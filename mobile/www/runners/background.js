// يشتغل بالخلفية كل فترة (حسب ما يسمح الايفون) ويطلع إشعار بكل بصمة جديدة
const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
function pad(n) { return String(n).padStart(2, '0'); }
function timeText(t) { const d = new Date(t); let h = d.getHours(); const ap = h < 12 ? 'ص' : 'م'; h = h % 12 || 12; return h + ':' + pad(d.getMinutes()) + ' ' + ap; }
function kvGet(k) { try { const r = CapacitorKV.get(k); return r && r.value ? r.value : ''; } catch (e) { return ''; } }

async function check() {
  const cfgRaw = kvGet('cfg'); if (!cfgRaw) return;
  const cfg = JSON.parse(cfgRaw); if (!cfg.url || !cfg.key || !cfg.ws || cfg.notify === false) return;
  const last = Number(kvGet('lastNotified') || 0);
  const url = cfg.url.replace(/\/+$/, '') + '/rest/v1/att_sync?select=id,data,srv,deleted&workspace=eq.' + encodeURIComponent(cfg.ws) + '&coll=eq.punches&srv=gt.' + last + '&order=srv.asc&limit=50';
  const res = await fetch(url, { headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key } });
  if (!res.ok) return;
  const rows = await res.json();
  let max = last; const notes = [];
  for (const r of rows) {
    max = Math.max(max, Number(r.srv));
    const p = r.data || {};
    if (r.deleted || !p.ts || p.edited || Date.now() - p.ts > 36 * 3600e3) continue;
    const d = new Date(p.ts);
    let body = (p.branch || 'الفرع الرئيسي') + ' • الساعة ' + timeText(p.ts) + ' • ' + DAYS[d.getDay()] + ' ' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    if (p.type === 'in' && p.lateMin > (cfg.graceIn || 30)) body += ' • متأخر ' + p.lateMin + ' دقيقة';
    notes.push({ id: (Number(r.srv) % 2000000000), title: (p.type === 'in' ? '✅ ' : '👋 ') + (p.empName || 'موظف') + (p.type === 'in' ? ' سجّل حضور' : ' سجّل انصراف'), body, threadIdentifier: 'punches' });
  }
  if (notes.length) CapacitorNotifications.schedule(notes.slice(-10));
  CapacitorKV.set('lastNotified', String(max));
}

addEventListener('checkPunches', async (resolve, reject) => {
  try { await check(); resolve(); } catch (e) { reject(e); }
});
addEventListener('setConfig', (resolve, reject, args) => {
  try {
    if (args && args.cfg) CapacitorKV.set('cfg', JSON.stringify(args.cfg));
    if (args && args.lastNotified != null) {
      const cur = Number(kvGet('lastNotified') || 0);
      if (args.force || Number(args.lastNotified) > cur) CapacitorKV.set('lastNotified', String(args.lastNotified));
    }
    resolve();
  } catch (e) { reject(e); }
});
