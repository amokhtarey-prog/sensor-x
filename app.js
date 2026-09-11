'use strict';
/* SENSOR X — analog instrument console
   Every measurement: { sensor, timestamp, value, unit, source, status }
   source: "hardware" | "browser_api" | "external_detector" | "simulation" */

const SX = { sensors: {}, raw: {}, rawNum: {}, recording: { active: false, paused: false, samples: [], startedAt: 0 } };
const $ = (id) => document.getElementById(id);
const nowTs = () => Date.now();
const fmt = (n, d = 2) => (n === null || n === undefined || Number.isNaN(n)) ? '--' : Number(n).toFixed(d);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mag3 = (x, y, z) => Math.sqrt((x || 0) ** 2 + (y || 0) ** 2 + (z || 0) ** 2);

const STATUS_LABEL = { available: 'AVAILABLE', unavailable: 'UNAVAILABLE', unsupported: 'UNSUPPORTED', permission: 'PERMISSION REQUIRED', simulated: 'SIMULATED', checking: 'CHECKING…' };
const STATUS_CLASS = { available: 'status-available', unavailable: 'status-unavailable', unsupported: 'status-unsupported', permission: 'status-permission', simulated: 'status-simulated', checking: 'status-unavailable' };
const SRC_CLASS = { hardware: 'src-hw', browser_api: 'src-hw', external_detector: 'src-hw', simulation: 'src-sim', '-': 'src-na' };
const SRC_LABEL = { hardware: 'SOURCE: HARDWARE', browser_api: 'SOURCE: BROWSER API', external_detector: 'SOURCE: EXTERNAL DETECTOR', simulation: 'SOURCE: SIMULATION', '-': 'SOURCE: N/A' };

/* ============================================================ Gauge Engine ============================================================ */
const GaugeEngine = {
  START: 135, SWEEP: 270,
  draw(canvas, opts) {
    if (!canvas) return;
    const { value, min, max, log = false, tickLabels = null, decimals = 1, ok = true } = opts;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
    if (!cssW || !cssH) return;
    if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) { canvas.width = cssW * dpr; canvas.height = cssH * dpr; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const cx = cssW / 2, cy = cssH / 2, r = Math.min(cssW, cssH) / 2 * 0.94;

    const toRad = (deg) => (deg - 90) * Math.PI / 180;
    const fracOf = (v) => log ? clamp(Math.log10(Math.max(v, 1)) / Math.log10(max), 0, 1) : clamp((v - min) / (max - min), 0, 1);
    const angleOf = (frac) => this.START + frac * this.SWEEP;

    // major/minor ticks
    ctx.strokeStyle = '#2a2620'; ctx.fillStyle = '#2a2620';
    const majors = log ? [1, 10, 100, 1000, 10000, 100000].filter(v => v <= max) : 9;
    if (log) {
      majors.forEach((v, i) => {
        const frac = Math.log10(v) / Math.log10(max);
        const ang = toRad(angleOf(frac));
        ctx.lineWidth = r * 0.025;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(ang) * r * 0.78, cy + Math.sin(ang) * r * 0.78); ctx.lineTo(cx + Math.cos(ang) * r * 0.92, cy + Math.sin(ang) * r * 0.92); ctx.stroke();
        ctx.font = `${Math.round(r * 0.12)}px monospace`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const lx = cx + Math.cos(ang) * r * 0.62, ly = cy + Math.sin(ang) * r * 0.62;
        ctx.fillText(tickLabels ? tickLabels[i] : v, lx, ly);
      });
    } else {
      for (let i = 0; i <= majors; i++) {
        const frac = i / majors;
        const ang = toRad(angleOf(frac));
        ctx.lineWidth = r * 0.025;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(ang) * r * 0.80, cy + Math.sin(ang) * r * 0.80); ctx.lineTo(cx + Math.cos(ang) * r * 0.92, cy + Math.sin(ang) * r * 0.92); ctx.stroke();
        // minor ticks between
        if (i < majors) {
          for (let m = 1; m < 4; m++) {
            const mf = i / majors + (m / 4) * (1 / majors);
            const mang = toRad(angleOf(mf));
            ctx.lineWidth = r * 0.012;
            ctx.beginPath(); ctx.moveTo(cx + Math.cos(mang) * r * 0.86, cy + Math.sin(mang) * r * 0.86); ctx.lineTo(cx + Math.cos(mang) * r * 0.92, cy + Math.sin(mang) * r * 0.92); ctx.stroke();
          }
        }
        if (i % 2 === 0 || majors <= 5) {
          ctx.font = `${Math.round(r * 0.115)}px monospace`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          const val = min + frac * (max - min);
          const lx = cx + Math.cos(ang) * r * 0.63, ly = cy + Math.sin(ang) * r * 0.63;
          ctx.fillText(Math.abs(val) >= 1000 ? (val / 1000).toFixed(0) + 'k' : val.toFixed(max - min <= 3 ? 1 : 0), lx, ly);
        }
      }
      // redline / warn zone (top 12% of range)
      const zoneStartAng = toRad(angleOf(0.85)), zoneEndAng = toRad(angleOf(1));
      ctx.strokeStyle = 'rgba(195,31,31,.55)'; ctx.lineWidth = r * 0.045;
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.97, zoneStartAng, zoneEndAng); ctx.stroke();
    }

    // needle
    if (value !== null && value !== undefined && !Number.isNaN(value) && ok) {
      const frac = fracOf(value);
      const ang = toRad(angleOf(frac));
      const tailAng = ang + Math.PI;
      ctx.save();
      ctx.strokeStyle = '#c31f1f'; ctx.fillStyle = '#c31f1f';
      ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1;
      ctx.lineWidth = r * 0.045; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(ang) * r * 0.74, cy + Math.sin(ang) * r * 0.74); ctx.stroke();
      ctx.lineWidth = r * 0.045;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(tailAng) * r * 0.16, cy + Math.sin(tailAng) * r * 0.16); ctx.stroke();
      ctx.restore();
      // hub
      const hubGrad = ctx.createRadialGradient(cx - r * 0.03, cy - r * 0.03, 0, cx, cy, r * 0.09);
      hubGrad.addColorStop(0, '#8a8f92'); hubGrad.addColorStop(1, '#2c2f31');
      ctx.fillStyle = hubGrad; ctx.beginPath(); ctx.arc(cx, cy, r * 0.09, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#1a1c1d'; ctx.lineWidth = 1; ctx.stroke();
    }
  },
  drawCompass(canvas, heading) {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
    if (!cssW || !cssH) return;
    if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) { canvas.width = cssW * dpr; canvas.height = cssH * dpr; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const cx = cssW / 2, cy = cssH / 2, r = Math.min(cssW, cssH) / 2 * 0.94;
    const toRad = (deg) => (deg - 90) * Math.PI / 180;
    // ticks every 15deg, labels every 45
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    for (let d = 0; d < 360; d += 15) {
      const ang = toRad(d);
      const major = d % 45 === 0;
      ctx.strokeStyle = major ? '#1c1a15' : '#4a4638';
      ctx.lineWidth = major ? r * 0.03 : r * 0.014;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(ang) * r * (major ? 0.76 : 0.85), cy + Math.sin(ang) * r * (major ? 0.76 : 0.85));
      ctx.lineTo(cx + Math.cos(ang) * r * 0.92, cy + Math.sin(ang) * r * 0.92); ctx.stroke();
      if (major) {
        ctx.fillStyle = d === 0 ? '#c31f1f' : '#1c1a15';
        ctx.font = `bold ${Math.round(r * 0.15)}px monospace`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(dirs[d / 45], cx + Math.cos(ang) * r * 0.6, cy + Math.sin(ang) * r * 0.6);
      }
    }
    if (heading !== null && heading !== undefined) {
      const ang = toRad(heading);
      const tailAng = ang + Math.PI;
      ctx.fillStyle = '#c31f1f';
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r * 0.72, cy + Math.sin(ang) * r * 0.72);
      ctx.lineTo(cx + Math.cos(ang + 2.6) * r * 0.06, cy + Math.sin(ang + 2.6) * r * 0.06);
      ctx.lineTo(cx + Math.cos(ang - 2.6) * r * 0.06, cy + Math.sin(ang - 2.6) * r * 0.06);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e8e4d8';
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(tailAng) * r * 0.32, cy + Math.sin(tailAng) * r * 0.32);
      ctx.lineTo(cx + Math.cos(tailAng + 2.6) * r * 0.06, cy + Math.sin(tailAng + 2.6) * r * 0.06);
      ctx.lineTo(cx + Math.cos(tailAng - 2.6) * r * 0.06, cy + Math.sin(tailAng - 2.6) * r * 0.06);
      ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#1c1a15'; ctx.lineWidth = 1; ctx.stroke();
    }
    const hubGrad = ctx.createRadialGradient(cx - r * 0.03, cy - r * 0.03, 0, cx, cy, r * 0.08);
    hubGrad.addColorStop(0, '#8a8f92'); hubGrad.addColorStop(1, '#2c2f31');
    ctx.fillStyle = hubGrad; ctx.beginPath(); ctx.arc(cx, cy, r * 0.08, 0, Math.PI * 2); ctx.fill();
  },
  drawLine(canvas, values, color) {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 300, h = 120;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.height = h + 'px'; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(53,226,196,0.08)'; ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) { const y = (h / 4) * i; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    if (!values || values.length < 2) return;
    const min = Math.min(...values), max = Math.max(...values), range = (max - min) || 1;
    ctx.beginPath();
    values.forEach((v, i) => { const x = (i / (values.length - 1)) * w; const y = h - ((v - min) / range) * (h - 10) - 5; i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
    ctx.strokeStyle = color || '#35e2c4'; ctx.lineWidth = 2; ctx.stroke();
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fillStyle = (color || '#35e2c4') + '18'; ctx.fill();
  },
  drawTank(canvas, pct, t) {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (pct === null || pct === undefined) {
      ctx.fillStyle = '#2a2e30'; ctx.font = '11px monospace'; ctx.textAlign = 'center';
      ctx.fillText('N/A', w / 2, h / 2);
      return;
    }
    const level = h * (1 - pct / 100);
    const color1 = pct > 40 ? '#1c8ee0' : pct > 15 ? '#e0a01c' : '#c31f1f';
    const color2 = pct > 40 ? '#5fc4ff' : pct > 15 ? '#ffcf6b' : '#ff6b6b';
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
    const grad = ctx.createLinearGradient(0, level, 0, h);
    grad.addColorStop(0, color2); grad.addColorStop(1, color1);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, level);
    for (let x = 0; x <= w; x += 4) {
      const y = level + Math.sin(x * 0.09 + t * 0.003) * 3 + Math.sin(x * 0.05 - t * 0.002) * 2;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
    // bubbles
    for (let i = 0; i < 5; i++) {
      const bx = (w * ((i * 37 + 13) % 100) / 100);
      const by = h - ((t * 0.02 + i * 40) % (h - level + 10)) ;
      if (by > level) { ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.arc(bx, by, 1.6, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, level); ctx.lineTo(w, level); ctx.stroke();
  }
};

/* ============================================================ Instrument DOM builders ============================================================ */
function makeInstrumentDOM(id, label, mini) {
  const wrap = document.createElement('div');
  wrap.className = 'instrument' + (mini ? ' mini' : '');
  wrap.id = `inst-${id}`;
  wrap.innerHTML = `
    <span class="instrument-label">${label}</span>
    <div class="gauge-bezel">
      <div class="gauge-face-wrap"><canvas data-role="canvas"></canvas></div>
      <div class="gauge-glass"></div>
      <div class="gauge-digital" data-role="digital">--</div>
    </div>
    <span class="instrument-source src-na" data-role="source">SOURCE: N/A</span>
  `;
  return wrap;
}
function updateInstrumentDOM(id, { value, status, source, decimals = 1, unit = '', gaugeOpts }) {
  const wrap = $(`inst-${id}`); if (!wrap) return;
  const canvas = wrap.querySelector('[data-role="canvas"]');
  const digital = wrap.querySelector('[data-role="digital"]');
  const srcEl = wrap.querySelector('[data-role="source"]');
  const ok = status === 'available' || status === 'simulated';
  digital.textContent = ok && value !== null && value !== undefined ? `${fmt(value, decimals)} ${unit}` : (status === 'unsupported' ? 'UNSUPP.' : status === 'permission' ? 'PERM.' : 'N/A');
  srcEl.textContent = ok ? SRC_LABEL[source] || 'SOURCE: —' : 'SOURCE: N/A';
  srcEl.className = 'instrument-source ' + (ok ? (SRC_CLASS[source] || 'src-na') : 'src-na');
  if (gaugeOpts) GaugeEngine.draw(canvas, { ...gaugeOpts, value: ok ? value : null, ok });
}

/* ============================================================ commit pipeline ============================================================ */
const HISTORY_CAP = 300;
function ensureSensor(id, meta) {
  if (!SX.sensors[id]) SX.sensors[id] = { id, ...meta, status: 'checking', source: '-', fields: {}, primary: null, history: [], min: null, max: null, sum: 0, count: 0 };
}
['accel', 'gyro', 'magneto', 'compass', 'light', 'proximity', 'pressure', 'devicemotion', 'deviceorientation', 'gps', 'altitude', 'speed',
 'temperature', 'humidity', 'steps', 'battery', 'charging', 'networktype', 'networkconn', 'screenorientation', 'deviceinfo', 'camera', 'microphone']
 .forEach(id => ensureSensor(id, { unit: '' }));

function commit(id) {
  const raw = SX.raw[id]; if (!raw) return;
  const s = SX.sensors[id];
  s.status = raw.status; s.source = raw.source; s.fields = raw.fields || {}; s.message = raw.message;
  if ((raw.status === 'available' || raw.status === 'simulated') && raw.primary !== null && raw.primary !== undefined && !Number.isNaN(raw.primary)) {
    s.primary = raw.primary;
    s.history.push({ t: nowTs(), v: raw.primary });
    if (s.history.length > HISTORY_CAP) s.history.shift();
    s.min = s.min === null ? raw.primary : Math.min(s.min, raw.primary);
    s.max = s.max === null ? raw.primary : Math.max(s.max, raw.primary);
    s.sum += raw.primary; s.count++;
    AlertManager.check(id, raw.primary);
    if (SX.recording.active && !SX.recording.paused) DataRecorder.push({ sensor: id, timestamp: nowTs(), value: raw.primary, unit: s.unit, source: raw.source, status: raw.status });
  }
}
function mainTick() {
  Object.keys(SX.raw).forEach(commit);
  UIManager.renderActivePage();
}
setInterval(mainTick, 150);

/* ============================================================ PermissionManager ============================================================ */
const PermissionManager = {
  needsMotionGesture: typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function',
  async requestMotion() {
    try {
      const r1 = await DeviceMotionEvent.requestPermission();
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') await DeviceOrientationEvent.requestPermission();
      if (r1 === 'granted') { MotionManager.start(); renderPermBar(); }
    } catch (e) {}
  },
  requestLocation() { LocationManager.start(); },
  async requestCamera() { try { const st = await navigator.mediaDevices.getUserMedia({ video: true }); st.getTracks().forEach(t => t.stop()); DeviceManager.refreshMedia(); } catch (e) {} },
  async requestMic() { try { const st = await navigator.mediaDevices.getUserMedia({ audio: true }); st.getTracks().forEach(t => t.stop()); DeviceManager.refreshMedia(); } catch (e) {} }
};
function renderPermBar() {
  const bar = $('permBar'); bar.innerHTML = '';
  const add = (label, fn, on) => {
    const b = document.createElement('button'); b.className = 'toggle-sw' + (on ? ' active' : '');
    b.innerHTML = `<div class="toggle-sw-track"><div class="toggle-sw-knob"></div></div><span>${label}</span>`;
    b.onclick = fn; bar.appendChild(b);
  };
  if (PermissionManager.needsMotionGesture) add('MOTION', PermissionManager.requestMotion, MotionManager.started);
  add('LOCATION', PermissionManager.requestLocation, LocationManager.started);
  add('CAMERA', PermissionManager.requestCamera, SX.sensors.camera.status === 'available');
  add('MIC', PermissionManager.requestMic, SX.sensors.microphone.status === 'available');
}

/* ============================================================ MotionManager ============================================================ */
const MotionManager = {
  started: false,
  needsGesture() { return typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function'; },
  init() {
    if (typeof window.DeviceMotionEvent === 'undefined') {
      SX.raw.accel = { status: 'unsupported', source: 'browser_api', fields: {} };
      SX.raw.gyro = { status: 'unsupported', source: 'browser_api', fields: {} };
      SX.raw.devicemotion = { status: 'unsupported', source: 'browser_api', fields: {} };
    } else if (this.needsGesture()) {
      SX.raw.accel = { status: 'permission', source: 'browser_api', fields: {} };
      SX.raw.gyro = { status: 'permission', source: 'browser_api', fields: {} };
    } else this.start();
    if (typeof window.DeviceOrientationEvent === 'undefined') SX.raw.deviceorientation = { status: 'unsupported', source: 'browser_api', fields: {} };
    else if (this.needsGesture()) SX.raw.deviceorientation = { status: 'permission', source: 'browser_api', fields: {} };
  },
  start() {
    if (this.started) return; this.started = true;
    window.addEventListener('devicemotion', (e) => {
      const ag = e.accelerationIncludingGravity || {};
      if (ag.x !== null && ag.x !== undefined) {
        SX.rawNum.accel = { x: ag.x, y: ag.y, z: ag.z };
        SX.raw.accel = { status: 'available', source: 'hardware', fields: { X: fmt(ag.x), Y: fmt(ag.y), Z: fmt(ag.z) }, primary: mag3(ag.x, ag.y, ag.z) };
      } else SX.raw.accel = { status: 'unavailable', source: 'browser_api', fields: {}, message: 'Device does not report acceleration values.' };
      const lin = e.acceleration || {};
      if (lin.x !== null && lin.x !== undefined) SX.raw.devicemotion = { status: 'available', source: 'hardware', fields: { X: fmt(lin.x), Y: fmt(lin.y), Z: fmt(lin.z) }, primary: mag3(lin.x, lin.y, lin.z) };
      else SX.raw.devicemotion = { status: 'unavailable', source: 'browser_api', fields: {}, message: 'Linear acceleration not exposed.' };
      const rr = e.rotationRate || {};
      if (rr.alpha !== null && rr.alpha !== undefined) {
        SX.rawNum.gyro = { roll: rr.beta, pitch: rr.gamma, yaw: rr.alpha };
        SX.raw.gyro = { status: 'available', source: 'hardware', fields: { X: fmt(rr.beta), Y: fmt(rr.gamma), Z: fmt(rr.alpha) }, primary: mag3(rr.beta, rr.gamma, rr.alpha) };
      } else SX.raw.gyro = { status: 'unavailable', source: 'browser_api', fields: {}, message: 'Rotation rate not exposed.' };
    }, { passive: true });
    window.addEventListener('deviceorientation', (e) => {
      if (e.alpha === null && e.beta === null && e.gamma === null) { SX.raw.deviceorientation = { status: 'unavailable', source: 'browser_api', fields: {}, message: 'Orientation not exposed.' }; return; }
      SX.raw.deviceorientation = { status: 'available', source: 'hardware', fields: { 'α': fmt(e.alpha, 1), 'β': fmt(e.beta, 1), 'γ': fmt(e.gamma, 1) } };
      SX.rawNum.orientation = { pitch: e.beta || 0, roll: e.gamma || 0, yaw: e.alpha || 0 };
      if (!CompassManager.hasTrueSource) CompassManager.updateFromAlpha(e.alpha, e.webkitCompassHeading, e.absolute);
    }, { passive: true });
    window.addEventListener('deviceorientationabsolute', (e) => { CompassManager.hasTrueSource = true; if (e.alpha !== null) CompassManager.updateFromAlpha(e.alpha, null, true); }, { passive: true });
  }
};

/* ============================================================ CompassManager ============================================================ */
const CompassManager = {
  hasTrueSource: false, heading: null,
  updateFromAlpha(alpha, webkitHeading, absolute) {
    let heading;
    if (webkitHeading !== null && webkitHeading !== undefined) { heading = webkitHeading; this.hasTrueSource = true; }
    else heading = (360 - alpha) % 360;
    this.heading = heading;
    SX.raw.compass = { status: 'available', source: 'hardware', fields: { Heading: fmt(heading, 0) + '°' }, primary: heading };
  }
};

/* ============================================================ MagnetometerManager ============================================================ */
const MagnetometerManager = {
  lastTotal: null,
  init() {
    if ('Magnetometer' in window) {
      try {
        const sensor = new window.Magnetometer({ frequency: 20 });
        sensor.addEventListener('reading', () => {
          const total = mag3(sensor.x, sensor.y, sensor.z);
          if (this.lastTotal !== null && Math.abs(total - this.lastTotal) > 15) this.flagJump();
          this.lastTotal = total;
          SX.raw.magneto = { status: 'available', source: 'hardware', fields: { X: fmt(sensor.x), Y: fmt(sensor.y), Z: fmt(sensor.z) }, primary: total };
        });
        sensor.addEventListener('error', () => { SX.raw.magneto = { status: 'unavailable', source: 'browser_api', fields: {}, message: 'Magnetometer sensor error.' }; });
        sensor.start();
      } catch (e) { SX.raw.magneto = { status: 'unsupported', source: 'browser_api', fields: {}, message: 'Generic Sensor Magnetometer API not available in this browser.' }; }
    } else SX.raw.magneto = { status: 'unsupported', source: 'browser_api', fields: {}, message: 'No standard web API exposes raw magnetometer data in this browser.' };
  },
  flagJump() { $('magWarning')?.classList.remove('hidden'); clearTimeout(this._t); this._t = setTimeout(() => $('magWarning')?.classList.add('hidden'), 4000); }
};

/* ============================================================ Light / Proximity ============================================================ */
function initLightProximity() {
  if ('AmbientLightSensor' in window) {
    try {
      const s = new window.AmbientLightSensor();
      s.addEventListener('reading', () => { SX.raw.light = { status: 'available', source: 'hardware', fields: { Lux: fmt(s.illuminance, 0) }, primary: s.illuminance }; });
      s.addEventListener('error', () => { SX.raw.light = { status: 'unavailable', source: 'browser_api', fields: {} }; });
      s.start();
    } catch (e) { SX.raw.light = { status: 'unsupported', source: 'browser_api', fields: {}, message: 'AmbientLightSensor API not available in this browser.' }; }
  } else SX.raw.light = { status: 'unsupported', source: 'browser_api', fields: {}, message: 'No ambient light API available in this browser.' };

  if ('ProximitySensor' in window) {
    try {
      const s = new window.ProximitySensor();
      s.addEventListener('reading', () => { SX.raw.proximity = { status: 'available', source: 'hardware', fields: { State: s.near ? 'NEAR' : 'FAR' } }; });
      s.addEventListener('error', () => { SX.raw.proximity = { status: 'unavailable', source: 'browser_api', fields: {} }; });
      s.start();
    } catch (e) { SX.raw.proximity = { status: 'unsupported', source: 'browser_api', fields: {}, message: 'ProximitySensor API not available in this browser.' }; }
  } else SX.raw.proximity = { status: 'unsupported', source: 'browser_api', fields: {}, message: 'No proximity API available. Distance values cannot be invented.' };
}

/* ============================================================ PressureManager ============================================================ */
function initPressure() {
  if ('Barometer' in window) {
    try {
      const s = new window.Barometer({ frequency: 1 });
      s.addEventListener('reading', () => {
        const hpa = s.pressure, alt = 44330 * (1 - Math.pow(hpa / 1013.25, 1 / 5.255));
        SX.raw.pressure = { status: 'available', source: 'hardware', fields: { Pressure: fmt(hpa, 1) }, primary: hpa };
        SX.raw.altitude = { status: 'available', source: 'browser_api', fields: { Altitude: fmt(alt, 0) }, primary: alt };
      });
      s.start();
    } catch (e) { SX.raw.pressure = { status: 'unsupported', source: 'browser_api', fields: {}, message: 'Barometer API not available in this browser.' }; }
  } else SX.raw.pressure = { status: 'unsupported', source: 'browser_api', fields: {}, message: 'No standard web API exposes atmospheric pressure. Most phones do not report this to the browser.' };
}

/* ============================================================ LocationManager ============================================================ */
const LocationManager = {
  started: false,
  init() {
    if (!('geolocation' in navigator)) { SX.raw.gps = { status: 'unsupported', source: 'browser_api', fields: {} }; SX.raw.speed = { status: 'unsupported', source: 'browser_api', fields: {} }; return; }
    SX.raw.gps = { status: 'permission', source: 'browser_api', fields: {} };
  },
  start() {
    if (this.started || !('geolocation' in navigator)) return;
    this.started = true;
    navigator.geolocation.watchPosition((pos) => {
      const c = pos.coords;
      SX.raw.gps = { status: 'available', source: 'hardware', fields: { Lat: fmt(c.latitude, 5), Lon: fmt(c.longitude, 5) } };
      if (c.altitude !== null) SX.raw.altitude = { status: 'available', source: 'hardware', fields: { Altitude: fmt(c.altitude, 0) }, primary: c.altitude, message: 'GPS-derived altitude (estimate).' };
      if (c.speed !== null) SX.raw.speed = { status: 'available', source: 'hardware', fields: { Speed: fmt(c.speed, 1) }, primary: c.speed };
      this.last = pos; renderPermBar();
    }, (err) => { SX.raw.gps = { status: err.code === 1 ? 'permission' : 'unavailable', source: 'browser_api', fields: {}, message: err.message }; },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 });
  }
};

/* ============================================================ BatteryManager ============================================================ */
const BatteryManager = {
  init() {
    if (!navigator.getBattery) { SX.raw.battery = { status: 'unsupported', source: 'browser_api', fields: {}, message: 'Battery Status API not available in this browser.' }; SX.raw.charging = { status: 'unsupported', source: 'browser_api', fields: {} }; return; }
    navigator.getBattery().then(bat => {
      this.bat = bat;
      const update = () => {
        const pct = Math.round(bat.level * 100);
        SX.raw.battery = { status: 'available', source: 'browser_api', fields: { Level: pct + '%' }, primary: pct };
        SX.raw.charging = { status: 'available', source: 'browser_api', fields: { Status: bat.charging ? 'CHARGING' : 'NOT CHARGING' } };
      };
      update();
      bat.addEventListener('levelchange', update); bat.addEventListener('chargingchange', update);
      bat.addEventListener('chargingtimechange', update); bat.addEventListener('dischargingtimechange', update);
    }).catch(() => { SX.raw.battery = { status: 'unavailable', source: 'browser_api', fields: {} }; });
  }
};

/* ============================================================ NetworkManager ============================================================ */
const NetworkManager = {
  init() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn) {
      const update = () => {
        SX.raw.networktype = { status: 'available', source: 'browser_api', fields: { Type: conn.type || conn.effectiveType || 'unknown' } };
        SX.raw.networkconn = { status: 'available', source: 'browser_api', fields: { Downlink: fmt(conn.downlink, 1), RTT: fmt(conn.rtt, 0) }, primary: conn.downlink };
        this.log(`type=${conn.effectiveType || '?'} downlink≈${conn.downlink}Mbps rtt≈${conn.rtt}ms`);
      };
      update(); conn.addEventListener('change', () => { update(); AlertManager.checkNetworkChange(); });
    } else { SX.raw.networktype = { status: 'unsupported', source: 'browser_api', fields: {}, message: 'Network Information API not available.' }; SX.raw.networkconn = { status: 'unsupported', source: 'browser_api', fields: {} }; }
    window.addEventListener('online', () => { this.log('Network: ONLINE'); updateOnlineDot(); AlertManager.checkNetworkChange(); });
    window.addEventListener('offline', () => { this.log('Network: OFFLINE'); updateOnlineDot(); AlertManager.checkNetworkChange(); });
  },
  log(msg) { const box = $('netLog'); if (!box) return; const row = document.createElement('div'); row.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`; box.prepend(row); while (box.children.length > 40) box.removeChild(box.lastChild); }
};
function updateOnlineDot() { const dot = $('onlineDot'); if (dot) dot.className = 'dot ' + (navigator.onLine ? 'dot-ok' : 'dot-bad'); }

/* ============================================================ DeviceManager ============================================================ */
const DeviceManager = {
  init() {
    const ua = navigator.userAgent;
    const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) && !/Chromium/.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) && !/Chrome/.test(ua) ? 'Safari' : 'Unknown';
    const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown';
    SX.raw.deviceinfo = { status: 'available', source: 'browser_api', fields: { Summary: `${browser} on ${os}` } };
    const diag = [
      ['Browser', browser], ['Operating System', os], ['Screen Resolution', `${screen.width}×${screen.height}`],
      ['Device Pixel Ratio', window.devicePixelRatio || 1], ['CPU Cores', navigator.hardwareConcurrency || 'Unsupported'],
      ['Memory (approx.)', navigator.deviceMemory ? navigator.deviceMemory + ' GB' : 'Unsupported'],
      ['Touch Support', ('ontouchstart' in window) ? 'Yes' : 'No'], ['Max Touch Points', navigator.maxTouchPoints ?? 'Unsupported'],
      ['Vibration Support', navigator.vibrate ? 'Yes' : 'No'], ['Web Serial Support', navigator.serial ? 'Yes' : 'No'], ['Web Bluetooth Support', navigator.bluetooth ? 'Yes' : 'No'],
    ];
    $('diagGrid').innerHTML = diag.map(([k, v]) => `<div class="counter"><span>${k}</span><b>${v}</b></div>`).join('');
    const so = screen.orientation;
    if (so) { const upd = () => { SX.raw.screenorientation = { status: 'available', source: 'browser_api', fields: { Type: so.type } }; }; upd(); so.addEventListener('change', upd); }
    else SX.raw.screenorientation = { status: 'unsupported', source: 'browser_api', fields: {} };
    this.refreshMedia();
    SX.raw.temperature = { status: 'unsupported', source: 'browser_api', fields: {} };
    SX.raw.humidity = { status: 'unsupported', source: 'browser_api', fields: {} };
    SX.raw.steps = { status: 'unsupported', source: 'browser_api', fields: {} };
  },
  refreshMedia() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) { SX.raw.camera = { status: 'unsupported', source: 'browser_api', fields: {} }; SX.raw.microphone = { status: 'unsupported', source: 'browser_api', fields: {} }; return; }
    navigator.mediaDevices.enumerateDevices().then(list => {
      const cam = list.some(d => d.kind === 'videoinput'), mic = list.some(d => d.kind === 'audioinput');
      SX.raw.camera = { status: cam ? 'available' : 'unavailable', source: 'browser_api', fields: { Available: cam ? 'YES' : 'NO' } };
      SX.raw.microphone = { status: mic ? 'available' : 'unavailable', source: 'browser_api', fields: { Available: mic ? 'YES' : 'NO' } };
    }).catch(() => {});
  }
};

/* ============================================================ GeigerSimulator ============================================================ */
const GeigerSimulator = {
  running: false, pulses: [], total: 0, startedAt: 0, level: 'normal', cpmHistory: [],
  levels: { low: 6, normal: 22, elevated: 65, high: 160, extreme: 4200 },
  audioCtx: null, tickHandle: null, secHandle: null,
  toggle() { this.running ? this.stop() : this.start(); },
  start() {
    this.running = true; this.startedAt = nowTs(); this.pulses = []; this.total = 0; this.cpmHistory = [];
    $('geigerToggle').textContent = 'STOP SIMULATOR';
    this.tickHandle = setInterval(() => { const prob = this.levels[this.level] / 600; if (Math.random() < prob) this.pulse(); }, 100);
    this.secHandle = setInterval(() => { const cpm = this.currentCpm(); this.cpmHistory.push(cpm); if (this.cpmHistory.length > 60) this.cpmHistory.shift(); }, 1000);
  },
  stop() { this.running = false; clearInterval(this.tickHandle); clearInterval(this.secHandle); $('geigerToggle').textContent = 'START SIMULATOR'; },
  pulse() { this.pulses.push(nowTs()); this.total++; if ($('geigerSound').checked) this.click(); },
  click() {
    try {
      this.audioCtx = this.audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const ctx = this.audioCtx, osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'square'; osc.frequency.value = 1800;
      gain.gain.setValueAtTime(0.15, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.03);
      osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.03);
    } catch (e) {}
  },
  currentCpm() { const cutoff = nowTs() - 60000; this.pulses = this.pulses.filter(t => t > cutoff); return this.pulses.length; },
  currentCps() { const cutoff = nowTs() - 1000; return this.pulses.filter(t => t > cutoff).length; },
  render() {
    if (!$('page-geiger').classList.contains('active')) return;
    const cpm = this.running ? this.currentCpm() : 0, cps = this.running ? this.currentCps() : 0;
    updateInstrumentDOM('geiger', { value: cpm, status: this.running ? 'simulated' : 'unavailable', source: 'simulation', decimals: 0, unit: 'CPM',
      gaugeOpts: { min: 0, max: 100000, log: true, tickLabels: ['0', '10', '100', '1K', '10K', '100K'] } });
    $('geigerCps').textContent = cps; $('geigerPulses').textContent = this.total;
    $('geigerLevel').textContent = this.level[0].toUpperCase() + this.level.slice(1);
    const el = Math.floor((nowTs() - this.startedAt) / 1000);
    $('geigerTime').textContent = this.running ? `${String(Math.floor(el / 3600)).padStart(2, '0')}:${String(Math.floor(el / 60) % 60).padStart(2, '0')}:${String(el % 60).padStart(2, '0')}` : '00:00:00';
    GaugeEngine.drawLine($('geigerChart'), this.cpmHistory.length ? this.cpmHistory : [0, 0], '#ffb454');
    if (this.running && SX.recording.active && !SX.recording.paused) DataRecorder.push({ sensor: 'geiger_simulated', timestamp: nowTs(), value: cpm, unit: 'CPM', source: 'simulation', status: 'simulated' });
  }
};

/* ============================================================ ExternalDetectorManager ============================================================ */
const ExternalDetectorManager = {
  port: null, connected: false, total: 0, pulses: [],
  init() { $('extSerialBtn').addEventListener('click', () => this.connectSerial()); $('extBleBtn').addEventListener('click', () => this.connectBle()); },
  log(msg) { const box = $('extLog'); const row = document.createElement('div'); row.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`; box.prepend(row); while (box.children.length > 60) box.removeChild(box.lastChild); },
  async connectSerial() {
    if (!navigator.serial) { this.log('Web Serial API is not supported in this browser.'); return; }
    try {
      const port = await navigator.serial.requestPort(); await port.open({ baudRate: 9600 });
      this.port = port; this.connected = true; $('extStatus').textContent = 'Connected (USB Serial)';
      this.log('Serial port connected. Waiting for data…');
      const decoder = new TextDecoderStream(); port.readable.pipeTo(decoder.writable);
      const reader = decoder.readable.getReader(); let buffer = '';
      while (this.connected) { const { value, done } = await reader.read(); if (done) break; buffer += value; let lines = buffer.split('\n'); buffer = lines.pop(); lines.forEach(l => this.handleLine(l.trim())); }
    } catch (e) { this.log('Serial connection failed: ' + e.message); }
  },
  handleLine(line) {
    if (!line) return; this.log('RX: ' + line);
    const n = parseFloat(line.replace(/[^0-9.\-]/g, ''));
    if (!Number.isNaN(n)) {
      this.total++; this.pulses.push(nowTs()); const cutoff = nowTs() - 60000; this.pulses = this.pulses.filter(t => t > cutoff);
      $('extCpm').textContent = n; $('extCps').textContent = fmt(this.pulses.length / 60, 2); $('extTotal').textContent = this.total;
      AlertManager.checkExternalRadiation(n);
      if (SX.recording.active && !SX.recording.paused) DataRecorder.push({ sensor: 'geiger_external', timestamp: nowTs(), value: n, unit: 'CPM', source: 'external_detector', status: 'available' });
    }
  },
  async connectBle() {
    if (!navigator.bluetooth) { this.log('Web Bluetooth API is not supported in this browser.'); return; }
    try {
      const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true });
      this.log(`Bluetooth device selected: ${device.name || device.id}.`);
      this.log('Connected — live counts need the exact GATT service/characteristic UUID for your specific detector model, which varies by manufacturer and cannot be guessed automatically.');
      $('extStatus').textContent = 'Connected (BLE, no data protocol)';
    } catch (e) { this.log('Bluetooth connection cancelled or failed: ' + e.message); }
  }
};

/* ============================================================ ExternalPowerManager ============================================================ */
const ExternalPowerManager = {
  port: null, connected: false, voltage: null, current: null, lastUpdate: 0,
  init() { $('pwrSerialBtn').addEventListener('click', () => this.connectSerial()); },
  log(msg) { const box = $('pwrLog'); if (!box) return; const row = document.createElement('div'); row.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`; box.prepend(row); while (box.children.length > 60) box.removeChild(box.lastChild); },
  async connectSerial() {
    if (!navigator.serial) { this.log('Web Serial API is not supported in this browser.'); return; }
    try {
      const port = await navigator.serial.requestPort(); await port.open({ baudRate: 9600 });
      this.port = port; this.connected = true; $('pwrStatus').textContent = 'Connected (USB Serial)';
      this.log('Serial port connected. Waiting for voltage/current data…');
      const decoder = new TextDecoderStream(); port.readable.pipeTo(decoder.writable);
      const reader = decoder.readable.getReader(); let buffer = '';
      while (this.connected) { const { value, done } = await reader.read(); if (done) break; buffer += value; let lines = buffer.split('\n'); buffer = lines.pop(); lines.forEach(l => this.handleLine(l.trim())); }
    } catch (e) { this.log('Serial connection failed: ' + e.message); }
  },
  handleLine(line) {
    if (!line) return; this.log('RX: ' + line);
    let v = null, i = null;
    const kv = line.match(/V\s*:?\s*(-?[\d.]+).*?I\s*:?\s*(-?[\d.]+)/i);
    if (kv) { v = parseFloat(kv[1]); i = parseFloat(kv[2]); }
    else { const parts = line.split(/[,;\s]+/).map(parseFloat).filter(n => !Number.isNaN(n)); if (parts.length >= 2) { v = parts[0]; i = parts[1]; } else if (parts.length === 1) { v = parts[0]; } }
    if (v !== null && !Number.isNaN(v)) { this.voltage = v; this.current = (i !== null && !Number.isNaN(i)) ? i : null; this.lastUpdate = nowTs();
      if (SX.recording.active && !SX.recording.paused) {
        DataRecorder.push({ sensor: 'power_voltage_external', timestamp: nowTs(), value: v, unit: 'V', source: 'external_detector', status: 'available' });
        if (this.current !== null) DataRecorder.push({ sensor: 'power_current_external', timestamp: nowTs(), value: this.current, unit: 'A', source: 'external_detector', status: 'available' });
      }
    }
  }
};


const DataRecorder = {
  init() {
    $('recBtn').addEventListener('click', () => this.toggle());
    $('recPause').addEventListener('click', () => this.pauseToggle());
    $('recExportCsv').addEventListener('click', () => this.export('csv'));
    $('recExportJson').addEventListener('click', () => this.export('json'));
    setInterval(() => { if (SX.recording.active && !SX.recording.paused) { const el = Math.floor((nowTs() - SX.recording.startedAt) / 1000); $('recDuration').textContent = `${String(Math.floor(el / 60)).padStart(2, '0')}:${String(el % 60).padStart(2, '0')}`; } }, 1000);
  },
  toggle() { SX.recording.active ? this.stop() : this.start(); },
  start() {
    SX.recording = { active: true, paused: false, samples: [], startedAt: nowTs() };
    $('recBtn').classList.add('active'); $('recStatusBig').textContent = 'RECORDING';
    $('recPause').disabled = false; $('recExportCsv').disabled = true; $('recExportJson').disabled = true; $('recCount').textContent = '0';
  },
  pauseToggle() { SX.recording.paused = !SX.recording.paused; $('recPause').textContent = SX.recording.paused ? 'RESUME' : 'PAUSE'; $('recStatusBig').textContent = SX.recording.paused ? 'PAUSED' : 'RECORDING'; },
  stop() {
    SX.recording.active = false; $('recBtn').classList.remove('active'); $('recStatusBig').textContent = 'STOPPED';
    $('recPause').disabled = true; $('recPause').textContent = 'PAUSE';
    $('recExportCsv').disabled = SX.recording.samples.length === 0; $('recExportJson').disabled = SX.recording.samples.length === 0;
  },
  push(sample) { SX.recording.samples.push(sample); if (SX.recording.samples.length % 5 === 0) $('recCount').textContent = SX.recording.samples.length; },
  export(type) {
    const samples = SX.recording.samples; let blob, filename;
    if (type === 'csv') { const rows = ['sensor,timestamp,value,unit,source,status', ...samples.map(s => `${s.sensor},${new Date(s.timestamp).toISOString()},${s.value},${s.unit},${s.source},${s.status}`)]; blob = new Blob([rows.join('\n')], { type: 'text/csv' }); filename = 'sensorx_recording.csv'; }
    else { blob = new Blob([JSON.stringify(samples, null, 2)], { type: 'application/json' }); filename = 'sensorx_recording.json'; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  }
};

/* ============================================================ AlertManager ============================================================ */
const AlertManager = {
  thresholds: { accel: 25, magnetic: 150, batteryLow: 15, gpsAccuracy: 100, radiation: 1000 },
  cooldowns: {}, warningCount: 0,
  fire(msg) {
    const banner = $('alertBanner'); banner.textContent = '⚠ ' + msg; banner.classList.remove('hidden');
    clearTimeout(this._hideT); this._hideT = setTimeout(() => banner.classList.add('hidden'), 6000);
    this.warningCount++; $('lampAlert')?.classList.add('on-red');
    clearTimeout(this._lampT); this._lampT = setTimeout(() => $('lampAlert')?.classList.remove('on-red'), 6000);
  },
  cool(key, ms = 15000) { const t = nowTs(); if (this.cooldowns[key] && t - this.cooldowns[key] < ms) return false; this.cooldowns[key] = t; return true; },
  check(id, value) {
    if (id === 'accel' && value > this.thresholds.accel && this.cool('accel')) this.fire(`High acceleration detected: ${fmt(value,1)} m/s²`);
    if (id === 'magneto' && value > this.thresholds.magnetic && this.cool('magneto')) this.fire(`Magnetic field above threshold: ${fmt(value,1)} µT`);
    if (id === 'battery' && value < this.thresholds.batteryLow && this.cool('battery', 60000)) this.fire(`Battery low: ${fmt(value,0)}%`);
  },
  checkNetworkChange() { if (!navigator.onLine && this.cool('net', 5000)) this.fire('Network disconnected.'); },
  checkExternalRadiation(cpm) { if (cpm > this.thresholds.radiation && this.cool('rad')) this.fire(`External detector exceeded threshold: ${fmt(cpm,0)} CPM`); }
};
function renderSettings() {
  const list = $('settingsList');
  const defs = [
    ['accel', 'Acceleration alert (m/s²)', 'Fires when accelerometer magnitude exceeds this.'],
    ['magnetic', 'Magnetic field alert (µT)', 'Fires when magnetometer total field exceeds this.'],
    ['batteryLow', 'Low battery alert (%)', 'Fires when battery falls below this level.'],
    ['gpsAccuracy', 'Poor GPS accuracy (m)', 'Fires when GPS accuracy radius exceeds this.'],
    ['radiation', 'Radiation alert (CPM)', 'Only evaluated against a connected external detector, never the simulator.'],
  ];
  list.innerHTML = defs.map(([k, label, sub]) => `<div class="setting-row"><div><span>${label}</span><small>${sub}</small></div><input type="number" data-th="${k}" value="${AlertManager.thresholds[k]}" /></div>`).join('');
  list.querySelectorAll('input').forEach(inp => inp.addEventListener('change', () => { AlertManager.thresholds[inp.dataset.th] = parseFloat(inp.value) || 0; }));
  $('calibAccel').addEventListener('click', () => { SX.sensors.accel.min = SX.sensors.accel.max = SX.sensors.accel.primary; SX.sensors.accel.sum = SX.sensors.accel.primary || 0; SX.sensors.accel.count = 1; $('calibStatus').textContent = `Accelerometer zero-reference reset at ${new Date().toLocaleTimeString()}.`; });
  $('calibCompass').addEventListener('click', () => { CompassManager.hasTrueSource = false; $('calibStatus').textContent = `Compass calibration reference cleared at ${new Date().toLocaleTimeString()}. Move the phone in a figure-8 to recalibrate the heading source.`; });
}

/* ============================================================ Sensor Scanner ============================================================ */
function runScan() {
  const results = [
    ['Accelerometer', SX.sensors.accel.status], ['Gyroscope', SX.sensors.gyro.status], ['Magnetometer', SX.sensors.magneto.status],
    ['Compass / Heading', SX.sensors.compass.status], ['Ambient Light', SX.sensors.light.status], ['Proximity', SX.sensors.proximity.status],
    ['Barometer / Pressure', SX.sensors.pressure.status], ['Device Motion (linear)', SX.sensors.devicemotion.status], ['Device Orientation', SX.sensors.deviceorientation.status],
    ['GPS / Location', SX.sensors.gps.status], ['Altitude', SX.sensors.altitude.status], ['Speed', SX.sensors.speed.status],
    ['Temperature', SX.sensors.temperature.status], ['Humidity', SX.sensors.humidity.status], ['Step Counter', SX.sensors.steps.status],
    ['Battery API', SX.sensors.battery.status], ['Network Information', SX.sensors.networktype.status], ['Screen Orientation', SX.sensors.screenorientation.status],
    ['Camera', SX.sensors.camera.status], ['Microphone', SX.sensors.microphone.status],
    ['Web Serial (external Geiger)', navigator.serial ? 'available' : 'unsupported'], ['Web Bluetooth (external Geiger)', navigator.bluetooth ? 'available' : 'unsupported'],
    ['Geiger Simulator', 'simulated'],
  ];
  const tagClass = { available: 'scan-ok', permission: 'scan-perm', unsupported: 'scan-unsup', unavailable: 'scan-off', simulated: 'scan-sim', checking: 'scan-off' };
  const tagSym = { available: 'ONLINE', permission: 'PERMISSION REQUIRED', unsupported: 'UNSUPPORTED', unavailable: 'UNAVAILABLE', simulated: 'SIMULATED', checking: 'CHECKING' };
  $('scanResults').innerHTML = results.map(([name, status]) => `<div class="scan-row"><span class="scan-row-name">${name}</span><span class="scan-row-tag ${tagClass[status]}">● ${tagSym[status]}</span></div>`).join('');
}

/* ============================================================ UIManager / render loop ============================================================ */
const MINI_LIST = [
  ['accel', 'Accel', 0, 20, 2, 'm/s²'], ['gyro', 'Gyro', 0, 400, 1, '°/s'], ['magneto', 'Magnetic', 0, 150, 1, 'µT'],
  ['pressure', 'Pressure', 950, 1050, 0, 'hPa'], ['light', 'Light', 0, 1000, 0, 'lux'], ['speed', 'Speed', 0, 30, 1, 'm/s'],
];
const UIManager = {
  currentPage: 'dashboard',
  init() {
    document.querySelectorAll('.nav-btn').forEach(btn => btn.addEventListener('click', () => this.goTo(btn.dataset.page)));
    $('scanBtn').addEventListener('click', () => { $('scanBtn').classList.add('scanning'); runScan(); this.updateSystemStatus(); setTimeout(() => $('scanBtn').classList.remove('scanning'), 400); });
    setInterval(() => { $('clock').textContent = new Date().toLocaleTimeString(); }, 1000);
    window.addEventListener('online', updateOnlineDot); window.addEventListener('offline', updateOnlineDot);
    updateOnlineDot();
    this.buildStaticInstruments();
  },
  goTo(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    $(`page-${page}`).classList.add('active');
    document.querySelector(`.nav-btn[data-page="${page}"]`).classList.add('active');
    this.currentPage = page;
    if (page === 'sensors') runScan();
  },
  buildStaticInstruments() {
    // mini overview grid
    const miniGrid = $('miniGrid'); miniGrid.innerHTML = '';
    MINI_LIST.forEach(([id, label]) => miniGrid.appendChild(makeInstrumentDOM('mini-' + id, label, true)));
    const battMini = makeInstrumentDOM('mini-battery', 'Battery', true); miniGrid.appendChild(battMini);
    const compMini = makeInstrumentDOM('mini-compass', 'Heading', true); miniGrid.appendChild(compMini);

    // motion page
    const accelGrid = $('accelGrid'); ['AX', 'AY', 'AZ'].forEach((l, i) => accelGrid.appendChild(makeInstrumentDOM('ax' + i, l)));
    const gyroGrid = $('gyroGrid'); ['ROLL', 'PITCH', 'YAW'].forEach((l, i) => gyroGrid.appendChild(makeInstrumentDOM('gy' + i, l)));

    // compass page
    $('compassInstrument').appendChild(makeInstrumentDOM('compassBig', 'HEADING'));
    // magnetic page
    $('magInstrument').appendChild(makeInstrumentDOM('magBig', 'TOTAL FIELD'));
    // pressure page
    const pGrid = $('pressureGrid'); pGrid.appendChild(makeInstrumentDOM('pressBig', 'PRESSURE')); pGrid.appendChild(makeInstrumentDOM('altBig', 'ALTITUDE'));
    // geiger
    $('geigerInstrument').appendChild(makeInstrumentDOM('geiger', 'CPM'));
    // geiger level switches
    const levels = ['low', 'normal', 'elevated', 'high', 'extreme'];
    const sw = $('levelSwitches');
    levels.forEach(lv => {
      const b = document.createElement('button'); b.className = 'toggle-sw' + (lv === 'normal' ? ' active' : '');
      b.innerHTML = `<div class="toggle-sw-track"><div class="toggle-sw-knob"></div></div><span>${lv.toUpperCase()}</span>`;
      b.onclick = () => { document.querySelectorAll('#levelSwitches .toggle-sw').forEach(x => x.classList.remove('active')); b.classList.add('active'); GeigerSimulator.level = lv; };
      sw.appendChild(b);
    });
    // network bars
    const bars = $('signalBars'); for (let i = 0; i < 5; i++) { const d = document.createElement('div'); d.className = 'signal-bar'; d.style.height = (20 + i * 15) + 'px'; d.id = 'sigbar' + i; bars.appendChild(d); }
  },
  updateSystemStatus() {
    const list = Object.values(SX.sensors);
    const available = list.filter(s => s.status === 'available' || s.status === 'simulated').length;
    $('statAvailable').textContent = available;
    $('statActive').textContent = list.filter(s => s.status === 'available').length;
    $('statWarnings').textContent = AlertManager.warningCount;
    $('statRecording').textContent = SX.recording.active ? 'ON' : 'OFF';
    $('lampSensor').className = 'lamp-bulb ' + (available > 0 ? 'on-green' : '');
    $('lampGps').className = 'lamp-bulb ' + (SX.sensors.gps.status === 'available' ? 'on-green' : SX.sensors.gps.status === 'permission' ? 'on-amber' : '');
    $('lampMotion').className = 'lamp-bulb ' + (SX.sensors.accel.status === 'available' ? 'on-green' : '');
    $('lampNetwork').className = 'lamp-bulb ' + (navigator.onLine ? 'on-green' : 'on-red');
  },
  renderActivePage() {
    this.updateSystemStatus();
    // mini overview always kept live
    MINI_LIST.forEach(([id, label, min, max, decimals, unit]) => {
      const s = SX.sensors[id];
      updateInstrumentDOM('mini-' + id, { value: s.primary, status: s.status, source: s.source, decimals, unit, gaugeOpts: { min, max } });
    });
    updateInstrumentDOM('mini-battery', { value: SX.sensors.battery.primary, status: SX.sensors.battery.status, source: SX.sensors.battery.source, decimals: 0, unit: '%', gaugeOpts: { min: 0, max: 100 } });
    updateInstrumentDOM('mini-compass', { value: CompassManager.heading, status: SX.sensors.compass.status, source: SX.sensors.compass.source, decimals: 0, unit: '°', gaugeOpts: { min: 0, max: 360 } });

    const page = this.currentPage;
    if (page === 'motion') {
      Motion3DRender();
      const a = SX.rawNum.accel || {}; const axVals = [a.x, a.y, a.z];
      ['ax0', 'ax1', 'ax2'].forEach((id, i) => updateInstrumentDOM(id, { value: axVals[i], status: SX.sensors.accel.status, source: SX.sensors.accel.source, decimals: 2, unit: 'm/s²', gaugeOpts: { min: -20, max: 20 } }));
      const g = SX.rawNum.gyro || {}; const gyVals = [g.roll, g.pitch, g.yaw];
      ['gy0', 'gy1', 'gy2'].forEach((id, i) => updateInstrumentDOM(id, { value: gyVals[i], status: SX.sensors.gyro.status, source: SX.sensors.gyro.source, decimals: 1, unit: '°/s', gaugeOpts: { min: -300, max: 300 } }));
    }
    if (page === 'compass') {
      const wrap = $('inst-compassBig'); if (wrap) {
        GaugeEngine.drawCompass(wrap.querySelector('[data-role="canvas"]'), SX.sensors.compass.status === 'available' ? CompassManager.heading : null);
        wrap.querySelector('[data-role="digital"]').textContent = SX.sensors.compass.status === 'available' ? fmt(CompassManager.heading, 0) + '°' : (SX.sensors.compass.status === 'permission' ? 'PERM.' : 'N/A');
        const srcEl = wrap.querySelector('[data-role="source"]'); const ok = SX.sensors.compass.status === 'available';
        srcEl.textContent = ok ? SRC_LABEL.hardware : 'SOURCE: N/A'; srcEl.className = 'instrument-source ' + (ok ? 'src-hw' : 'src-na');
      }
      $('compassMag').textContent = SX.sensors.compass.status === 'available' ? fmt(CompassManager.heading, 0) + '°' : '--';
      $('compassTrue').textContent = CompassManager.hasTrueSource ? fmt(CompassManager.heading, 0) + '°' : 'Unavailable';
      $('compassCal').textContent = CompassManager.hasTrueSource ? 'Calibrated' : 'Uncalibrated (relative)';
    }
    if (page === 'magnetic') {
      const s = SX.sensors.magneto;
      updateInstrumentDOM('magBig', { value: s.primary, status: s.status, source: s.source, decimals: 1, unit: 'µT', gaugeOpts: { min: 0, max: 200 } });
      $('magX').textContent = s.fields.X ?? '--'; $('magY').textContent = s.fields.Y ?? '--'; $('magZ').textContent = s.fields.Z ?? '--';
      $('magPeak').textContent = s.max !== null ? fmt(s.max, 1) : '--';
      $('magStatusTag').textContent = STATUS_LABEL[s.status]; $('magStatusTag').className = 'status-tag ' + STATUS_CLASS[s.status];
      GaugeEngine.drawLine($('magChart'), s.history.map(p => p.v), '#35e2c4');
    }
    if (page === 'pressure') {
      const p = SX.sensors.pressure, alt = SX.sensors.altitude;
      updateInstrumentDOM('pressBig', { value: p.primary, status: p.status, source: p.source, decimals: 0, unit: 'hPa', gaugeOpts: { min: 950, max: 1050 } });
      updateInstrumentDOM('altBig', { value: alt.primary, status: alt.status, source: alt.source, decimals: 0, unit: 'm', gaugeOpts: { min: -50, max: 3000 } });
      if (p.status === 'available') { $('presHpa').textContent = fmt(p.primary, 1); $('presKpa').textContent = fmt(p.primary / 10, 2); $('presMmhg').textContent = fmt(p.primary * 0.750062, 1); }
      $('presStatusTag').textContent = STATUS_LABEL[p.status]; $('presStatusTag').className = 'status-tag ' + STATUS_CLASS[p.status];
      GaugeEngine.drawLine($('presChart'), alt.history.map(x => x.v), '#35e2c4');
    }
    if (page === 'location') {
      const g = SX.sensors.gps;
      $('locStatus').textContent = STATUS_LABEL[g.status];
      const ready = g.status === 'available';
      $('radarSweep').classList.toggle('hidden', !ready); $('radarBlip').classList.toggle('hidden', !ready);
      if (LocationManager.last) {
        const c = LocationManager.last.coords;
        $('locLat').textContent = fmt(c.latitude, 5); $('locLon').textContent = fmt(c.longitude, 5); $('locAcc').textContent = fmt(c.accuracy, 1);
        $('locAlt').textContent = c.altitude !== null ? fmt(c.altitude, 0) : 'N/A'; $('locSpeed').textContent = c.speed !== null ? fmt(c.speed, 1) : 'N/A';
        $('locHead').textContent = c.heading !== null && !Number.isNaN(c.heading) ? fmt(c.heading, 0) + '°' : 'N/A';
        $('locTs').textContent = new Date(LocationManager.last.timestamp).toLocaleTimeString();
        if (!LocationManager.mapDrawn || LocationManager._lastLL !== `${c.latitude},${c.longitude}`) {
          LocationManager._lastLL = `${c.latitude},${c.longitude}`; LocationManager.mapDrawn = true;
          const d = 0.01;
          $('mapWrap').innerHTML = `<iframe loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=${c.longitude - d}%2C${c.latitude - d}%2C${c.longitude + d}%2C${c.latitude + d}&layer=mapnik&marker=${c.latitude}%2C${c.longitude}"></iframe>`;
        }
      }
    }
    if (page === 'battery') {
      const b = SX.sensors.battery;
      GaugeEngine.drawTank($('tankCanvas'), b.status === 'available' ? b.primary : null, nowTs());
      $('battPct').textContent = b.status === 'available' ? fmt(b.primary, 0) + '%' : 'N/A';
      const charging = SX.sensors.charging.fields.Status === 'CHARGING';
      $('battState').textContent = b.status === 'available' ? (charging ? 'CHARGING' : 'DISCHARGING') : 'UNKNOWN';
      $('battFlow').innerHTML = b.status === 'available' ? (charging ? '<span class="flow-up">▲ INFLOW</span>' : '<span class="flow-down">▼ CONSUMPTION</span>') : '';
      if (BatteryManager.bat) {
        $('battChgTime').textContent = (BatteryManager.bat.chargingTime && isFinite(BatteryManager.bat.chargingTime)) ? Math.round(BatteryManager.bat.chargingTime / 60) + ' min' : '--';
        $('battDisTime').textContent = (BatteryManager.bat.dischargingTime && isFinite(BatteryManager.bat.dischargingTime)) ? Math.round(BatteryManager.bat.dischargingTime / 60) + ' min' : '--';
      }
      $('batteryStatusTag').textContent = STATUS_LABEL[b.status]; $('batteryStatusTag').className = 'status-tag ' + STATUS_CLASS[b.status];
      GaugeEngine.drawLine($('batteryChart'), b.history.map(p => p.v), '#35e2c4');
    }
    if (page === 'network') {
      const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      $('netOnline').textContent = navigator.onLine ? 'ONLINE' : 'OFFLINE';
      $('netType').textContent = conn ? (conn.type || 'Unavailable') : 'Unsupported';
      $('netDown').textContent = conn ? fmt(conn.downlink, 1) : 'Unsupported';
      $('netRtt').textContent = conn ? fmt(conn.rtt, 0) : 'Unsupported';
      $('netSave').textContent = conn ? (conn.saveData ? 'ON' : 'OFF') : 'Unsupported';
      $('netEffBig').textContent = conn ? (conn.effectiveType || '--').toUpperCase() : (navigator.onLine ? 'ONLINE' : 'OFFLINE');
      const bars = conn ? { 'slow-2g': 1, '2g': 2, '3g': 3, '4g': 5 }[conn.effectiveType] || (navigator.onLine ? 3 : 0) : (navigator.onLine ? 3 : 0);
      for (let i = 0; i < 5; i++) $('sigbar' + i)?.classList.toggle('on', i < bars);
    }
    if (page === 'geiger') GeigerSimulator.render();
  }
};

function Motion3DRender() {
  const el = $('phone3d'); if (!el) return;
  const o = SX.rawNum.orientation || { pitch: 0, roll: 0 };
  el.style.transform = `rotateX(${-o.pitch}deg) rotateY(${o.roll}deg)`;
}

/* ============================================================ init ============================================================ */
function init() {
  MotionManager.init();
  CompassManager.hasTrueSource = false;
  MagnetometerManager.init();
  initLightProximity();
  initPressure();
  LocationManager.init();
  BatteryManager.init();
  NetworkManager.init();
  DeviceManager.init();
  ExternalDetectorManager.init();
  DataRecorder.init();
  renderSettings();
  UIManager.init();
  renderPermBar();
  runScan();
  setTimeout(runScan, 1500);

  document.querySelectorAll('.geiger-tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.geiger-tab').forEach(x => x.classList.remove('active')); t.classList.add('active');
    $('geigerSimPanel').classList.toggle('hidden', t.dataset.gmode !== 'sim');
    $('geigerExtPanel').classList.toggle('hidden', t.dataset.gmode !== 'ext');
  }));
  $('geigerToggle').addEventListener('click', () => GeigerSimulator.toggle());
}
document.addEventListener('DOMContentLoaded', init);
