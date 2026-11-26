// التعرف على الوجه — يعمل بالكامل داخل الحاسبة بدون إنترنت
(function () {
  const $ = (id) => document.getElementById(id);
  let loaded = false, loading = null, stream = null, cancelFlag = false;
  const THRESH = { low: 0.5, medium: 0.45, high: 0.4 };

  async function init() {
    if (loaded) return;
    if (!loading) loading = (async () => {
      let okB = false; try { okB = await faceapi.tf.setBackend('webgl'); } catch (e) {}
      if (!okB) await faceapi.tf.setBackend('cpu');
      await faceapi.tf.ready();
      await faceapi.nets.tinyFaceDetector.loadFromUri('models');
      await faceapi.nets.faceLandmark68Net.loadFromUri('models');
      await faceapi.nets.faceRecognitionNet.loadFromUri('models');
      loaded = true;
    })();
    return loading;
  }

  const ui = {
    open(title) { $('camTitle').textContent = title; $('camModal').classList.remove('hidden'); this.msg('جاري تشغيل الكاميرا…'); this.ring(''); this.bar(0); },
    close() { $('camModal').classList.add('hidden'); },
    msg(t) { $('camMsg').textContent = t; },
    ring(c) { $('camRing').className = 'cam-ring ' + (c || ''); },
    bar(p) { $('camBar').style.width = Math.max(0, Math.min(100, p)) + '%'; }
  };

  async function startCam() {
    const v = $('camVideo');
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false });
    v.srcObject = stream;
    await new Promise((res) => { if (v.readyState >= 2) res(); else v.onloadeddata = () => res(); });
    await v.play().catch(() => {});
    return v;
  }
  function stopCam() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null; $('camVideo').srcObject = null;
  }
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function ear(eye) { return (dist(eye[1], eye[5]) + dist(eye[2], eye[4])) / (2 * dist(eye[0], eye[3]) || 1); }
  function euclid(a, b) { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; } return Math.sqrt(s); }
  function meanDesc(list) { const n = list.length, out = new Float32Array(128); for (const d of list) for (let i = 0; i < 128; i++) out[i] += d[i] / n; return out; }

  async function detect(v) {
    const r = await faceapi.detectSingleFace(v, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })).withFaceLandmarks().withFaceDescriptor();
    if (!r) return null;
    const box = r.detection.box, W = v.videoWidth, Hh = v.videoHeight, m = Math.min(W, Hh);
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const off = Math.hypot(cx - W / 2, cy - Hh / 2) / (m / 2);
    const size = box.width / m;
    const lm = r.landmarks;
    const e = (ear(lm.getLeftEye()) + ear(lm.getRightEye())) / 2;
    return { r, score: r.detection.score, off, size, ear: e, desc: r.descriptor };
  }
  function placement(d) {
    if (!d) return 'ضع وجهك داخل الدائرة';
    if (d.size < 0.26) return 'اقترب من الكاميرا قليلاً';
    if (d.size > 0.85) return 'ابتعد عن الكاميرا قليلاً';
    if (d.off > 0.38) return 'حرّك وجهك إلى منتصف الدائرة';
    return null;
  }
  function snapshot(v) {
    const c = document.createElement('canvas'), S = 300; c.width = S; c.height = S;
    const g = c.getContext('2d'), m = Math.min(v.videoWidth, v.videoHeight);
    g.translate(S, 0); g.scale(-1, 1);
    g.drawImage(v, (v.videoWidth - m) / 2, (v.videoHeight - m) / 2, m, m, 0, 0, S, S);
    return c.toDataURL('image/jpeg', 0.78);
  }

  // التحقق من هوية الموظف — دقيق وسريع:
  // 1) لازم 3 لقطات متتالية واضحة كلها مطابقة  2) متوسطها تحت الحد  3) الوجه أقرب لهذا الموظف من أي موظف ثاني
  async function verify(emp, opts) {
    cancelFlag = false;
    ui.open(`التحقق من الوجه — ${emp.name}`);
    try { await init(); } catch (e) { ui.close(); throw new Error('تعذر تحميل نظام التعرف على الوجه'); }
    let v;
    try { v = await startCam(); } catch (e) { ui.close(); throw new Error('لا يمكن تشغيل الكاميرا. تأكد أنها موصولة وغير مستخدمة من برنامج آخر.'); }
    const thr = THRESH[opts.strictness] || THRESH.medium;
    const known = (emp.descriptors || []).map(d => Float32Array.from(d));
    const others = (opts.others || []).filter(o => o.id !== emp.id && o.descriptors && o.descriptors.length).map(o => ({ name: o.name, ds: o.descriptors.map(d => Float32Array.from(d)) }));
    const t0 = performance.now();
    let best = 9, photo = null, run = [], maxEar = 0, closed = false, blinked = !opts.liveness, lastWho = null;
    ui.msg('ضع وجهك داخل الدائرة وانظر للكاميرا'); ui.bar(15);
    try {
      while (!cancelFlag) {
        const el = performance.now() - t0;
        if (el > 15000) return { ok: false, reason: run.length && !blinked ? 'noblink' : (best < 9 ? 'nomatch' : 'timeout'), best, photo, who: lastWho };
        const d = await detectLoose(v);
        if (!d) { ui.msg('ضع وجهك داخل الدائرة'); ui.ring('warn'); run = []; await sleep(40); continue; }
        if (d.size < 0.18) { ui.msg('اقترب من الكاميرا قليلاً'); ui.ring('warn'); run = []; await sleep(40); continue; }
        if (d.score < 0.6) { ui.msg('انظر مباشرة للكاميرا'); ui.ring('warn'); run = []; await sleep(40); continue; }
        if (!photo || d.score > 0.8) photo = snapshot(v);
        const dist = Math.min(...known.map(k => euclid(k, d.desc)));
        best = Math.min(best, dist);
        // هل الوجه أقرب لموظف ثاني؟
        let other = null;
        for (const o of others) { const od = Math.min(...o.ds.map(k => euclid(k, d.desc))); if (od < dist + 0.03 && od < thr + 0.05) { other = o; break; } }
        if (dist < thr && !other) { run.push(dist); ui.ring('ok'); } else { run = []; ui.ring(dist < thr ? 'bad' : ''); if (other) lastWho = other.name; }
        if (opts.liveness && !blinked) {
          maxEar = Math.max(maxEar * 0.995, d.ear);
          if (d.ear < maxEar * 0.78) closed = true; else if (closed && d.ear > maxEar * 0.88) blinked = true;
        }
        const n = run.length, mean = n ? run.reduce((x, y) => x + y, 0) / n : 9;
        if (n >= 3 && mean < thr - 0.02 && blinked) { ui.bar(100); ui.msg('✅ تم التحقق'); ui.ring('ok'); photo = snapshot(v); await sleep(250); return { ok: true, photo, distance: mean }; }
        ui.msg(n && !blinked && n >= 3 ? '👁️ ارمش مرة وحدة' : 'جاري التعرف… ثبّت وجهك'); ui.bar(30 + n * 20);
        await sleep(25);
      }
      return { ok: false, reason: 'cancel' };
    } finally { stopCam(); ui.close(); }
  }
  function avg2(a, b) { const o = new Float32Array(128); for (let i = 0; i < 128; i++) o[i] = (a[i] + b[i]) / 2; return o; }
  async function detectLoose(v) {
    const r = await faceapi.detectSingleFace(v, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.35 })).withFaceLandmarks().withFaceDescriptor();
    if (!r) return null;
    const box = r.detection.box, m = Math.min(v.videoWidth, v.videoHeight), lm = r.landmarks;
    return { score: r.detection.score, size: box.width / m, ear: (ear(lm.getLeftEye()) + ear(lm.getRightEye())) / 2, desc: r.descriptor };
  }

  // تسجيل وجه موظف جديد (5 صور من زوايا مختلفة)
  async function enroll(name) {
    cancelFlag = false;
    ui.open(`تسجيل وجه — ${name}`);
    try { await init(); } catch (e) { ui.close(); throw new Error('تعذر تحميل نظام التعرف على الوجه'); }
    let v;
    try { v = await startCam(); } catch (e) { ui.close(); throw new Error('لا يمكن تشغيل الكاميرا. تأكد أنها موصولة وغير مستخدمة من برنامج آخر.'); }
    const steps = ['انظر مباشرة إلى الكاميرا', 'أدر رأسك قليلاً إلى اليمين', 'أدر رأسك قليلاً إلى اليسار', 'ارفع رأسك قليلاً', 'انظر مباشرة مرة أخرى'];
    const descs = []; let photo = null;
    try {
      for (let i = 0; i < steps.length && !cancelFlag; i++) {
        ui.msg(steps[i]); ui.bar((i / steps.length) * 100);
        await sleep(600);
        let stable = 0;
        while (!cancelFlag) {
          const d = await detectLoose(v);
          const p = !d ? 'ضع وجهك داخل الدائرة' : d.size < 0.16 ? 'اقترب من الكاميرا قليلاً' : null;
          if (p || d.score < 0.7) { ui.msg(p || steps[i]); ui.ring('warn'); stable = 0; await sleep(50); continue; }
          ui.msg(steps[i]); ui.ring('ok'); stable++;
          if (stable >= 3) { descs.push(Array.from(d.desc, x => Math.round(x * 1e5) / 1e5)); if (i === 0) photo = snapshot(v); break; }
          await sleep(60);
        }
      }
      if (cancelFlag || descs.length < 5) return null;
      ui.bar(100); ui.msg('✅ تم تسجيل الوجه'); await sleep(500);
      return { descriptors: descs, photo };
    } finally { stopCam(); ui.close(); }
  }

  // مقارنة وجه بباقي الموظفين (لمنع تكرار التسجيل)
  function findSimilar(descriptors, employees, exceptId, strictness) {
    const thr = THRESH[strictness] || THRESH.medium;
    const probe = meanDesc(descriptors.map(d => Float32Array.from(d)));
    for (const e of employees) {
      if (e.id === exceptId || !e.descriptors || e._del) continue;
      const dmin = Math.min(...e.descriptors.map(k => euclid(Float32Array.from(k), probe)));
      if (dmin < thr) return e;
    }
    return null;
  }

  document.addEventListener('DOMContentLoaded', () => { $('camCancel').onclick = () => { cancelFlag = true; }; });
  window.Face = { init, verify, enroll, findSimilar };
})();
