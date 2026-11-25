(function () {
  let d = {};
  try { d = JSON.parse(decodeURIComponent(escape(atob(new URLSearchParams(location.search).get('d') || '')))); } catch (e) {}
  const $ = (id) => document.getElementById(id);
  $('title').textContent = d.title || 'انتهى وقت الدوام';
  $('name').textContent = d.name || '';
  if (d.photo) $('ph').src = d.photo;
  $('msg').textContent = `انتهى دوام ${d.name || ''} الساعة ${d.endText || ''} — يرجى تسجيل الانصراف`;
  if (d.repeat) $('rep').textContent = `تنبيه رقم ${d.repeat + 1} — يتكرر كل 10 دقائق`;
  $('ok').onclick = () => api.closeAlert();
  $('go').onclick = () => api.alertAction('punch-out:' + d.empId);
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') api.closeAlert(); });
  function chime() {
    try {
      const ac = new AudioContext();
      [880, 660, 880, 660, 990].forEach((f, i) => {
        const o = ac.createOscillator(), g = ac.createGain(); o.type = 'triangle'; o.frequency.value = f; o.connect(g); g.connect(ac.destination);
        const t = ac.currentTime + i * 0.22; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2); o.start(t); o.stop(t + 0.21);
      });
    } catch (e) {}
  }
  chime(); let n = 0; const iv = setInterval(() => { if (++n >= 3) clearInterval(iv); chime(); }, 4000);
})();
