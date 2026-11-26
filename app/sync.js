// المزامنة مع السحابة (Supabase) + ضبط الوقت من السيرفر
(function () {
  const COLLS = ['employees', 'punches', 'days', 'settings', 'audit'];
  let timeBase = null;   // { server, perf } — وقت السيرفر مع عداد لا يتأثر بتغيير ساعة الحاسبة
  let busy = false, lastWall = Date.now(), lastPerf = performance.now();
  const S = { status: 'local', lastOk: 0, error: '', pending: 0 };

  const SQL = `-- انسخ هذا الكود والصقه في Supabase > SQL Editor ثم اضغط Run (مرة واحدة فقط)
create sequence if not exists att_seq;
create table if not exists att_sync (
  workspace text not null,
  coll text not null,
  id text not null,
  data jsonb,
  updated_at bigint not null default 0,
  deleted boolean not null default false,
  srv bigint not null default nextval('att_seq'),
  primary key (workspace, coll, id)
);
create index if not exists att_sync_srv on att_sync (workspace, srv);
create or replace function att_bump() returns trigger language plpgsql security definer as $$
begin new.srv := nextval('att_seq'); return new; end $$;
drop trigger if exists att_bump_t on att_sync;
create trigger att_bump_t before insert or update on att_sync for each row execute function att_bump();
create or replace function att_now() returns bigint language sql stable as $$
  select (extract(epoch from now()) * 1000)::bigint $$;
grant usage, select on sequence att_seq to anon, authenticated;
grant select, insert, update, delete on att_sync to anon, authenticated;
grant execute on function att_now() to anon, authenticated;
alter table att_sync enable row level security;
drop policy if exists att_all on att_sync;
create policy att_all on att_sync for all to anon, authenticated using (true) with check (true);`;

  function cfg() { const c = (App.db.local && App.db.local.cloud) || {}; return c.url && c.key && c.ws ? c : null; }
  // المفاتيح الجديدة (sb_publishable_) تنرسل بـ apikey فقط، والقديمة (JWT) بالاثنين
  function authH(key) { const h = { apikey: key }; if (/^eyJ/.test(key)) h.Authorization = 'Bearer ' + key; return h; }
  function headers(c, extra) { return Object.assign(authH(c.key), { 'Content-Type': 'application/json' }, extra || {}); }
  const base = (c) => c.url.replace(/\/+$/, '');

  function now() {
    if (timeBase) return Math.round(timeBase.server + (performance.now() - timeBase.perf));
    return Date.now() + ((App.db.meta && App.db.meta.offset) || 0);
  }

  // كشف تغيير ساعة الحاسبة
  function checkClock() {
    const w = Date.now(), p = performance.now();
    const drift = Math.abs((w - lastWall) - (p - lastPerf));
    lastWall = w; lastPerf = p;
    if (drift > 120000) {
      App.db.meta.clockSuspect = true;
      timeBase = null;   // نعيد الضبط من السيرفر عند أول اتصال
      App.saveSoon();
    }
    return App.db.meta.clockSuspect;
  }

  async function syncTime(c) {
    const t1 = performance.now();
    const res = await fetch(base(c) + '/rest/v1/rpc/att_now', { method: 'POST', headers: headers(c), body: '{}' });
    if (!res.ok) throw new Error('time ' + res.status);
    const server = Number(await res.json());
    const t2 = performance.now();
    const mid = server + (t2 - t1) / 2;
    timeBase = { server: mid, perf: t2 };
    App.db.meta.offset = Math.round(mid - Date.now());
    App.db.meta.clockSuspect = false;
    App.db.meta.lastWallSeen = Date.now();
  }

  function markDirty(coll, id) {
    App.db.meta.dirty = App.db.meta.dirty || {};
    App.db.meta.dirty[coll + ':' + id] = true;
    S.pending = Object.keys(App.db.meta.dirty).length;
  }

  async function pull(c) {
    let changed = false;
    for (;;) {
      const url = `${base(c)}/rest/v1/att_sync?workspace=eq.${encodeURIComponent(c.ws)}&srv=gt.${App.db.meta.lastSrv || 0}&order=srv.asc&limit=500`;
      const res = await fetch(url, { headers: headers(c) });
      if (!res.ok) throw new Error('pull ' + res.status + ' ' + (await res.text()).slice(0, 120));
      const rows = await res.json();
      for (const r of rows) {
        App.db.meta.lastSrv = Math.max(App.db.meta.lastSrv || 0, Number(r.srv));
        if (!COLLS.includes(r.coll)) continue;
        const coll = App.db[r.coll] || (App.db[r.coll] = {});
        const local = coll[r.id];
        if (!local || (Number(r.updated_at) >= (local._u || 0))) {
          coll[r.id] = Object.assign({}, r.data || {}, { _u: Number(r.updated_at), _del: !!r.deleted });
          if (App.db.meta.dirty) delete App.db.meta.dirty[r.coll + ':' + r.id];
          changed = true;
        }
      }
      if (rows.length < 500) break;
    }
    return changed;
  }

  async function push(c) {
    const dirty = Object.keys(App.db.meta.dirty || {});
    for (let i = 0; i < dirty.length; i += 200) {
      const chunk = dirty.slice(i, i + 200), snap = {};
      const rows = chunk.map(k => {
        const [coll, ...rest] = k.split(':'); const id = rest.join(':');
        const rec = (App.db[coll] || {})[id]; if (!rec) return null;
        snap[k] = rec._u;
        const data = Object.assign({}, rec); delete data._u; delete data._del;
        return { workspace: c.ws, coll, id, data, updated_at: rec._u || 0, deleted: !!rec._del };
      }).filter(Boolean);
      if (!rows.length) continue;
      const res = await fetch(`${base(c)}/rest/v1/att_sync?on_conflict=workspace,coll,id`, {
        method: 'POST', headers: headers(c, { Prefer: 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify(rows)
      });
      if (!res.ok) throw new Error('push ' + res.status + ' ' + (await res.text()).slice(0, 120));
      for (const k of chunk) {
        const [coll, ...rest] = k.split(':'); const rec = (App.db[coll] || {})[rest.join(':')];
        if (!rec || rec._u === snap[k]) delete App.db.meta.dirty[k];
      }
    }
  }

  async function run(force) {
    const c = cfg();
    if (!c) { S.status = 'local'; S.pending = Object.keys(App.db.meta.dirty || {}).length; App.renderSync(); return; }
    if (busy) return; busy = true;
    S.status = 'syncing'; App.renderSync();
    try {
      if (!timeBase || force) await syncTime(c);
      const changed = await pull(c);
      await push(c);
      S.status = 'ok'; S.lastOk = Date.now(); S.error = '';
      App.save();
      if (changed) App.onRemoteChange();
    } catch (e) {
      S.status = navigator.onLine ? 'error' : 'offline';
      S.error = String(e.message || e);
    } finally {
      busy = false; S.pending = Object.keys(App.db.meta.dirty || {}).length; App.renderSync();
    }
  }

  async function test(c) {
    const res = await fetch(base(c) + '/rest/v1/rpc/att_now', { method: 'POST', headers: headers(c), body: '{}' });
    if (res.status === 404) throw new Error('الجدول غير موجود — شغّل كود SQL في Supabase أولاً');
    if (!res.ok) throw new Error('فشل الاتصال (' + res.status + ')');
    const r2 = await fetch(`${base(c)}/rest/v1/att_sync?select=id&limit=1`, { headers: headers(c) });
    if (!r2.ok) throw new Error('الجدول غير جاهز — شغّل كود SQL في Supabase');
    return true;
  }

  window.Sync = { SQL, now, run, test, markDirty, checkClock, state: S, hasTimeBase: () => !!timeBase };
  window.addEventListener('online', () => run());
})();
