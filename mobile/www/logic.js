// منطق الدوام والخصومات — دوال صافية قابلة للاختبار
(function (root) {
  const DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5]; // يبدأ من السبت
  const H = 3600e3, M = 60e3;

  const DEFAULT_SETTINGS = {
    graceIn: 30, graceOut: 15, autoCloseHours: 2,
    dedLate: 20000, dedAbsence: 40000, dedEarly: 20000, dedForgot: 10000,
    halfAbsenceRule: true, liveness: true, strictness: 'medium',
    preReminder: true, bigReminder: true, currency: 'د.ع'
  };

  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; };
  const addDays = (s, n) => { const { y, m, d } = parseDate(s); return dateStr(new Date(y, m - 1, d + n, 12).getTime()); };
  const weekday = (s) => { const { y, m, d } = parseDate(s); return new Date(y, m - 1, d, 12).getDay(); };
  const hm = (s) => { const [h, mi] = String(s || '0:0').split(':').map(Number); return (h || 0) * 60 + (mi || 0); };
  const atMin = (s, min) => { const { y, m, d } = parseDate(s); return new Date(y, m - 1, d, 0, min).getTime(); };
  const daysInMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };

  function shiftBounds(emp, date) {
    const s = hm(emp.start), e = hm(emp.end);
    const start = atMin(date, s);
    const end = atMin(date, e <= s ? e + 1440 : e);
    return { start, end, len: end - start, overnight: e <= s };
  }

  function isOff(emp, date) { return (emp.daysOff || []).includes(weekday(date)); }

  // أي يوم دوام يخص هذا الوقت (يدعم الدوام الليلي العابر لمنتصف الليل)
  function currentShiftDate(emp, t, settings) {
    const today = dateStr(t);
    const yest = addDays(today, -1);
    const by = shiftBounds(emp, yest);
    if (by.overnight) {
      const bt = shiftBounds(emp, today);
      if (t < by.end + (settings.autoCloseHours || 2) * H && t < bt.start - 2 * H) return yest;
    }
    return today;
  }

  function punchesOf(punches, empId, date) {
    return Object.values(punches).filter(p => !p._del && p.empId === empId && p.date === date).sort((a, b) => a.ts - b.ts);
  }

  function dayInfo(emp, date, t, ctx) {
    const st = ctx.settings, adj = (ctx.days && ctx.days[emp.id + '_' + date]) || {};
    const ps = punchesOf(ctx.punches, emp.id, date);
    const inP = ps.find(p => p.type === 'in') || null;
    const outP = ps.filter(p => p.type === 'out').pop() || null;
    const b = shiftBounds(emp, date);
    const off = isOff(emp, date);
    const r = { date, off, inP, outP, b, adj, lateMin: 0, earlyMin: 0, workedMin: 0, status: 'future', ded: { late: 0, absence: 0, early: 0, forgot: 0 }, total: 0, notes: [] };

    if (emp.startDate && date < emp.startDate) { r.status = 'na'; return r; }
    if (adj.leave) { r.status = 'leave'; r.notes.push(adj.note || 'إجازة'); return r; }

    if (!inP) {
      if (off) { r.status = 'off'; return r; }
      if (t < b.start) { r.status = 'future'; return r; }
      if (t <= b.end) { r.status = t > b.start + st.graceIn * M ? 'notyet-late' : 'waiting'; return r; }
      r.status = 'absent';
      if (!adj.waiveAbsence) r.ded.absence = st.dedAbsence;
      finish(r); return r;
    }

    r.lateMin = Math.max(0, Math.round((inP.ts - b.start) / M));
    const outTs = outP ? outP.ts : (adj.manualOut ? atMin(date, hm(adj.manualOut) + (hm(adj.manualOut) < hm(emp.start) && b.overnight ? 1440 : 0)) : null);

    if (off) {
      r.status = 'offwork';
      if (outTs) r.workedMin = Math.max(0, Math.round((outTs - inP.ts) / M));
      return r;
    }

    const late = r.lateMin > st.graceIn;
    if (late && !adj.waiveLate) r.ded.late = st.dedLate;

    if (outTs) {
      r.workedMin = Math.max(0, Math.round((outTs - inP.ts) / M));
      r.earlyMin = Math.max(0, Math.round((b.end - outTs) / M));
      const early = r.earlyMin > st.graceOut;
      if (early) {
        if (st.halfAbsenceRule && r.workedMin * M < b.len / 2) {
          r.status = 'half';
          if (!adj.waiveEarly) r.ded.absence = Math.round(st.dedAbsence / 2);
        } else {
          r.status = 'early';
          if (!adj.waiveEarly) r.ded.early = st.dedEarly;
        }
      } else r.status = late ? 'late' : 'present';
      if (late && r.status !== 'late') r.notes.push('متأخر');
      if (!outP && adj.manualOut) r.notes.push('انصراف يدوي');
    } else {
      if (t > b.end + st.autoCloseHours * H) {
        r.status = 'forgot';
        if (adj.forgotPenalty) r.ded.forgot = st.dedForgot;
      } else r.status = late ? 'open-late' : 'open';
    }
    finish(r); return r;
  }
  function finish(r) { r.total = r.ded.late + r.ded.absence + r.ded.early + r.ded.forgot; }

  function monthSummary(emp, ym, t, ctx) {
    const n = daysInMonth(ym), today = dateStr(t);
    const s = { emp, ym, days: [], workDays: 0, present: 0, lateCount: 0, absentCount: 0, halfCount: 0, earlyCount: 0, forgotCount: 0, offWork: 0, leaveCount: 0, workedMin: 0, lateMin: 0, ded: { late: 0, absence: 0, early: 0, forgot: 0 }, totalDed: 0, salary: Number(emp.salary) || 0, net: 0 };
    for (let d = 1; d <= n; d++) {
      const date = `${ym}-${pad(d)}`;
      if (date > today) break;
      const r = dayInfo(emp, date, t, ctx);
      s.days.push(r);
      if (['na', 'future'].includes(r.status)) continue;
      if (!r.off) s.workDays++;
      if (r.inP) s.present++;
      if (r.lateMin > ctx.settings.graceIn && !r.off) { s.lateCount++; s.lateMin += r.lateMin; }
      if (r.status === 'absent') s.absentCount++;
      if (r.status === 'half') s.halfCount++;
      if (r.status === 'early') s.earlyCount++;
      if (r.status === 'forgot') s.forgotCount++;
      if (r.status === 'offwork') s.offWork++;
      if (r.status === 'leave') s.leaveCount++;
      s.workedMin += r.workedMin;
      for (const k in s.ded) s.ded[k] += r.ded[k];
    }
    s.totalDed = s.ded.late + s.ded.absence + s.ded.early + s.ded.forgot;
    s.net = Math.max(0, s.salary - s.totalDed);
    return s;
  }

  const STATUS = {
    present: ['حاضر', 'ok'], late: ['متأخر', 'warn'], absent: ['غائب', 'bad'], half: ['نصف غياب', 'bad'],
    early: ['انصراف مبكر', 'warn'], forgot: ['نسي الانصراف', 'warn'], open: ['في الدوام', 'info'], 'open-late': ['في الدوام (متأخر)', 'warn'],
    off: ['عطلة', 'muted'], offwork: ['دوام بيوم عطلة', 'info'], future: ['—', 'muted'], waiting: ['بانتظار الحضور', 'muted'],
    'notyet-late': ['لم يحضر بعد', 'warn'], na: ['—', 'muted'], leave: ['إجازة / إذن', 'info']
  };

  function durText(min) {
    min = Math.max(0, Math.round(min));
    const h = Math.floor(min / 60), m = min % 60;
    const hs = h === 0 ? '' : h === 1 ? 'ساعة' : h === 2 ? 'ساعتين' : `${h} ساعات`;
    const ms = m === 0 ? '' : m === 1 ? 'دقيقة' : m === 2 ? 'دقيقتين' : `${m} دقيقة`;
    if (hs && ms) return `${hs} و ${ms}`;
    return hs || ms || '0 دقيقة';
  }
  function timeText(t) {
    if (!t) return '—';
    const d = new Date(t); let h = d.getHours(); const m = pad(d.getMinutes());
    const ap = h < 12 ? 'ص' : 'م'; h = h % 12 || 12; return `${h}:${m} ${ap}`;
  }
  function hmText(s) { const x = hm(s); return timeText(new Date(2000, 0, 1, 0, x).getTime()); }

  const api = { DAY_NAMES, WEEK_ORDER, DEFAULT_SETTINGS, STATUS, dateStr, addDays, weekday, hm, atMin, daysInMonth, shiftBounds, isOff, currentShiftDate, punchesOf, dayInfo, monthSummary, durText, timeText, hmText, pad };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.L = api;
})(typeof window !== 'undefined' ? window : globalThis);
