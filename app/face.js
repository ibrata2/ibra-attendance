// التعرف على الوجه — يعمل بالكامل داخل الحاسبة بدون إنترنت
(function () {
  const $ = (id) => document.getElementById(id);
  let loaded = false, loading = null, stream = null, cancelFlag = false;
  const THRESH = { low: 0.58, medium: 0.5, high: 0.43 };

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

  // التحقق من هوية الموظف
  async function verify(emp, opts) {
    cancelFlag = false;
    ui.open(`التحقق من الوجه — ${emp.name}`);
    try { await init(); } catch (e) { ui.close(); throw new Error('تعذر تحميل نظام التعرف على الوجه'); }
    let v;
    try { v = await startCam(); } catch (e) { ui.close(); throw new Error('لا يمكن تشغيل الكاميرا. تأكد أنها موصولة وغير مستخدمة من برنامج آخر.'); }
    const thr = THRESH[opts.strictness] || THRESH.medium;
    const known = (emp.descriptors || []).map(d => Float32Array.from(d));
    const t0 = performance.now();
    let baseline = 0, closed = false, blinked = !opts.liveness, openDescs = [], goodFrames = 0, evalFrames = 0, best = 9, photo = null;
    try {
      while (!cancelFlag) {
        if (performance.now() - t0 > 40000) return { ok: false, reason: 'timeout', best };
        const d = await detect(v);
        const p = placement(d);
        if (p) { ui.msg(p); ui.ring('warn'); await sleep(60); continue; }
        // قياس فتح العين للرمشة
        if (d.ear > baseline * 0.9 || baseline === 0) baseline = baseline === 0 ? d.ear : baseline * 0.85 + d.ear * 0.15;
        const isOpen = d.ear > baseline * 0.85;
        if (isOpen && d.score > 0.6) { openDescs.push(d.desc); if (openDescs.length > 5) openDescs.shift(); if (!photo || d.score > 0.8) photo = snapshot(v); }
        if (!blinked) {
          if (d.ear < baseline * 0.72) closed = true;
          else if (closed && d.ear > baseline * 0.86) { blinked = true; }
          ui.msg(closed ? 'افتح عينك…' : (performance.now() - t0 > 12000 ? '👁️ ارمش ببطء (غمّض عينك ثانية وافتحها)' : '👁️ ارمش بعينك مرة واحدة')); ui.ring(''); ui.bar(30);
          await sleep(30); continue;
        }
        if (openDescs.length < 3) { ui.msg('ثبّت وجهك…'); ui.bar(50); await sleep(30); continue; }
        ui.msg('جاري التحقق…'); ui.bar(70 + goodFrames * 15);
        const probe = meanDesc(openDescs.slice(-3));
        const dmin = Math.min(...known.map(k => euclid(k, probe)));
        best = Math.min(best, dmin); evalFrames++;
        if (dmin < thr) { goodFrames++; ui.ring('ok'); if (goodFrames >= 2) { ui.bar(100); ui.msg('✅ تم التحقق'); photo = snapshot(v); await sleep(350); return { ok: true, photo, distance: dmin }; } }
        else { goodFrames = 0; ui.ring('bad'); }
        if (evalFrames >= 25) return { ok: false, reason: 'nomatch', best, photo };
        await sleep(40);
      }
      return { ok: false, reason: 'cancel' };
    } finally { stopCam(); ui.close(); }
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
        await sleep(900);
        let stable = 0;
        while (!cancelFlag) {
          const d = await detect(v);
          const p = placement(d);
          if (p || d.score < 0.7) { ui.msg(p || steps[i]); ui.ring('warn'); stable = 0; await sleep(60); continue; }
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
