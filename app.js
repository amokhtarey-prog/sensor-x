'use strict';
/* =========================================================================
   SENSOR X — app.js
   Architecture: SensorManager / MotionManager / CompassManager /
   MagnetometerManager / PressureManager / LocationManager / BatteryManager /
   NetworkManager / DeviceManager / PermissionManager / GeigerSimulator /
   ExternalDetectorManager / DataRecorder / AlertManager / ChartManager /
   UIManager
   Every measurement: { sensor, timestamp, value, unit, source, status }
   source ∈ "hardware" | "browser_api" | "external_detector" | "simulation"
   ========================================================================= */

const SX = { sensors: {}, raw: {}, recording: { active: false, paused: false, samples: [], startedAt: 0 } };

/* ---------------------------- helpers ---------------------------- */
const $ = (id) => document.getElementById(id);
const nowTs = () => Date.now();
const fmt = (n, d = 2) => (n === null || n === undefined || Number.isNaN(n)) ? '--' : Number(n).toFixed(d);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mag3 = (x, y, z) => Math.sqrt((x || 0) ** 2 + (y || 0) ** 2 + (z || 0) ** 2);

const STATUS_LABEL = {
  available: 'AVAILABLE', unavailable: 'UNAVAILABLE', unsupported: 'UNSUPPORTED',
  permission: 'PERMISSION REQUIRED', simulated: 'SIMULATED', checking: 'CHECKING…'
};
const STATUS_CLASS = {
  available: 'status-available', unavailable: 'status-unavailable', unsupported: 'status-unsupported',
  permission: 'status-permission', simulated: 'status-simulated', checking: 'status-unavailable'
};

/* ---------------------------- sensor registry ---------------------------- */
const CARD_DEFS = [
  { id: 'accel',            name: 'Accelerometer',      unit: 'm/s²',   fields: ['X', 'Y', 'Z'], chart: true },
  { id: 'gyro',              name: 'Gyroscope',          unit: '°/s',    fields: ['X', 'Y', 'Z'], chart: true },
  { id: 'magneto',           name: 'Magnetometer',       unit: 'µT',     fields: ['X', 'Y', 'Z'], chart: true },
  { id: 'compass',           name: 'Compass / Heading',  unit: '°',      fields: ['Heading'], chart: true },
  { id: 'light',              name: 'Ambient Light',      unit: 'lux',    fields: ['Lux'], chart: true },
  { id: 'proximity',         name: 'Proximity',          unit: '',       fields: ['State'], chart: false },
  { id: 'pressure',          name: 'Barometer / Pressure', unit: 'hPa',  fields: ['Pressure'], chart: true },
  { id: 'devicemotion',      name: 'Device Motion',      unit: 'm/s²',   fields: ['X', 'Y', 'Z'], chart: true },
  { id: 'deviceorientation', name: 'Device Orientation', unit: '°',      fields: ['α', 'β', 'γ'], chart: false },
  { id: 'gps',                name: 'GPS / Location',     unit: '',       fields: ['Lat', 'Lon'], chart: false },
  { id: 'altitude',          name: 'Altitude',           unit: 'm',      fields: ['Altitude'], chart: true },
  { id: 'speed',              name: 'Speed',               unit: 'm/s',    fields: ['Speed'], chart: true },
  { id: 'temperature',       name: 'Temperature',        unit: '°C',     fields: ['Temp'], chart: false },
  { id: 'humidity',           name: 'Humidity',            unit: '%',      fields: ['Humidity'], chart: false },
  { id: 'steps',               name: 'Step Counter',        unit: 'steps',  fields: ['Steps'], chart: false },
  { id: 'battery',            name: 'Battery Level',       unit: '%',      fields: ['Level'], chart: true },
  { id: 'charging',           name: 'Charging Status',     unit: '',       fields: ['Status'], chart: false },
  { id: 'networktype',       name: 'Network Type',        unit: '',       fields: ['Type'], chart: false },
  { id: 'networkconn',       name: 'Network Connection',  unit: 'Mbps',   fields: ['Downlink', 'RTT'], chart: false },
  { id: 'screenorientation', name: 'Screen Orientation',  unit: '',       fields: ['Type'], chart: false },
  { id: 'deviceinfo',         name: 'Device Information',  unit: '',       fields: ['Summary'], chart: false },
  { id: 'camera',              name: 'Camera',               unit: '',       fields: ['Available'], chart: false },
  { id: 'microphone',         name: 'Microphone',          unit: '',       fields: ['Available'], chart: false },
];

CARD_DEFS.forEach(def => {
  SX.sensors[def.id] = {
    ...def, status: 'checking', source: '-', fields: {}, primary: null,
    history: [], min: null, max: null, sum: 0, count: 0, lastUpdate: 0,
  };
});

/* ---------------------------- card rendering ---------------------------- */
function buildCardDOM(def) {
  const el = document.createElement('div');
  el.className = 'card';
  el.id = `card-${def.id}`;
  el.innerHTML = `
    <div class="card-top">
      <span class="card-name">${def.name}</span>
      <span class="status-tag ${STATUS_CLASS.checking}" data-role="status">${STATUS_LABEL.checking}</span>
    </div>
    <div><span class="card-value" data-role="value">--</span><span class="card-unit">${def.unit}</span></div>
    <div class="card-sub" data-role="sub"></div>
    <div class="card-stats" data-role="stats"></div>
    ${def.chart ? '<canvas data-role="chart" height="34"></canvas>' : ''}
  `;
  return el;
}

function renderCardGrid() {
  const grid = $('cardGrid');
  grid.innerHTML = '';
  CARD_DEFS.forEach(def => grid.appendChild(buildCardDOM(def)));
}

function renderCard(id) {
  const s = SX.sensors[id];
  const el = $(`card-${id}`);
  if (!el || !s) return;
  const statusEl = el.querySelector('[data-role="status"]');
  statusEl.textContent = STATUS_LABEL[s.status];
  statusEl.className = `status-tag ${STATUS_CLASS[s.status]}`;

  const valueEl = el.querySelector('[data-role="value"]');
  const subEl = el.querySelector('[data-role="sub"]');
  const statsEl = el.querySelector('[data-role="stats"]');

  if (s.status !== 'available' && s.status !== 'simulated') {
    valueEl.textContent = '--';
    subEl.textContent = s.message || (s.status === 'permission' ? 'Tap Enable above to grant access.' : 'Not available on this device/browser.');
    statsEl.textContent = '';
    return;
  }
  valueEl.textContent = (s.primary !== null && s.primary !== undefined) ? fmt(s.primary, Math.abs(s.primary) < 10 ? 3 : 2) : (Object.values(s.fields)[0] ?? '--');
  subEl.textContent = Object.entries(s.fields).map(([k, v]) => `${k}: ${v}`).join('   ');
  if (s.count > 0) {
    statsEl.textContent = `min ${fmt(s.min,1)}  max ${fmt(s.max,1)}  avg ${fmt(s.sum / s.count,1)}`;
  }
  if (s.chart) {
    const canvas = el.querySelector('[data-role="chart"]');
    ChartManager.drawSparkline(canvas, s.history.map(p => p.v));
  }
}

/* ---------------------------- ChartManager ---------------------------- */
const ChartManager = {
  drawSparkline(canvas, values, color) {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 140, h = canvas.clientHeight || 34;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!values || values.length < 2) return;
    const min = Math.min(...values), max = Math.max(...values);
    const range = (max - min) || 1;
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color || '#35e2c4';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  },
  drawBigChart(canvas, values, color, opts = {}) {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 300, h = opts.height || 120;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.height = h + 'px'; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) { const y = (h / 4) * i; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    if (!values || values.length < 2) return;
    const min = opts.min ?? Math.min(...values), max = opts.max ?? Math.max(...values);
    const range = (max - min) || 1;
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 10) - 5;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color || '#35e2c4';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    ctx.fillStyle = (color || '#35e2c4') + '18';
    ctx.fill();
  }
};

/* ---------------------------- commit / measurement pipeline ---------------------------- */
function commit(id) {
  const raw = SX.raw[id];
  if (!raw) return;
  const s = SX.sensors[id];
  s.status = raw.status; s.source = raw.source; s.fields = raw.fields || {}; s.message = raw.message;
  s.lastUpdate = nowTs();
  if ((raw.status === 'available' || raw.status === 'simulated') && raw.primary !== null && raw.primary !== undefined && !Number.isNaN(raw.primary)) {
    s.primary = raw.primary;
    s.history.push({ t: nowTs(), v: raw.primary });
    if (s.history.length > 300) s.history.shift();
    s.min = s.min === null ? raw.primary : Math.min(s.min, raw.primary);
    s.max = s.max === null ? raw.primary : Math.max(s.max, raw.primary);
    s.sum += raw.primary; s.count++;
    AlertManager.check(id, raw.primary);
    if (SX.recording.active && !SX.recording.paused) {
      DataRecorder.push({ sensor: id, timestamp: nowTs(), value: raw.primary, unit: s.unit, source: raw.source, status: raw.status });
    }
  }
}

function mainTick() {
  Object.keys(SX.sensors).forEach(commit);
  Object.keys(SX.sensors).forEach(id => { if (document.getElementById('page-dashboard').classList.contains('active')) renderCard(id); });
  updateDetailPages();
}
setInterval(mainTick, 150);

/* ---------------------------- PermissionManager ---------------------------- */
const PermissionManager = {
  needsMotionGesture: typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function',
  async requestMotion() {
    try {
      const r1 = await DeviceMotionEvent.requestPermission();
      let r2 = 'granted';
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        r2 = await DeviceOrientationEvent.requestPermission();
      }
      if (r1 === 'granted') { MotionManager.start(); renderPermBar(); return true; }
    } catch (e) { console.warn('motion permission error', e); }
    return false;
  },
  requestLocation() { LocationManager.start(); },
  async requestCamera() {
    try { const st = await navigator.mediaDevices.getUserMedia({ video: true }); st.getTracks().forEach(t => t.stop()); DeviceManager.refreshMedia(); }
    catch (e) { console.warn('camera denied', e); }
  },
  async requestMic() {
    try { const st = await navigator.mediaDevices.getUserMedia({ audio: true }); st.getTracks().forEach(t => t.stop()); DeviceManager.refreshMedia(); }
    catch (e) { console.warn('mic denied', e); }
  }
};

function renderPermBar() {
  const bar = $('permBar'); bar.innerHTML = '';
  const add = (label, fn) => { const b = document.createElement('button'); b.className = 'perm-btn'; b.textContent = label; b.onclick = fn; bar.appendChild(b); };
  if (PermissionManager.needsMotionGesture && !MotionManager.started) add('Enable Motion Sensors', PermissionManager.requestMotion);
  if (!LocationManager.started) add('Enable Location', PermissionManager.requestLocation);
  add('Check Camera Access', PermissionManager.requestCamera);
  add('Check Microphone Access', PermissionManager.requestMic);
}

/* ---------------------------- MotionManager (accel/gyro/orientation) ---------------------------- */
const MotionManager = {
  started: false,
  init() {
    if (typeof window.DeviceMotionEvent === 'undefined') {
      SX.raw.accel = { status: 'unsupported', source: 'browser_api', fields: {} };
      SX.raw.gyro = { status: 'unsupported', source: 'browser_api', fields: {} };
      SX.raw.devicemotion = { status: 'unsupported', source: 'browser_api', fields: {} };
    } else if (this.needsGesture()) {
      SX.raw.accel = { status: 'permission', source: 'browser_api', fields: {} };
      SX.raw.gyro = { status: 'permission', source: 'browser_api', fields: {} };
      SX.raw.devicemotion = { status: 'permission', source: 'browser_api', fields: {} };
    } else {
      this.start();
    }
    if (typeof window.DeviceOrientationEvent === 'undefined') {
      SX.raw.deviceorientation = { status: 'unsupported', source: 'browser_api', fields: {} };
    } else if (this.needsGesture()) {
      SX.raw.deviceorientation = { status: 'permission', source: 'browser_api', fields: {} };
    }
  },
  needsGesture() { return typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function'; },
  start() {
    if (this.started) return;
    this.started = true;
    window.addEventListener('devicemotion', (e) => {
      const ag = e.accelerationIncludingGravity || {};
      if (ag.x !== null && ag.x !== undefined) {
        SX.raw.accel = { status: 'available', source: 'hardware', fields: { X: fmt(ag.x), Y: fmt(ag.y), Z: fmt(ag.z) }, primary: mag3(ag.x, ag.y, ag.z) };
      } else {
        SX.raw.accel = { status: 'unavailable', source: 'browser_api', fields: {}, message: 'Device does not report acceleration values.' };
      }
      const lin = e.acceleration || {};
      if (lin.x !== null && lin.x !== undefined) {
        SX.raw.devicemotion = { status: 'available', source: 'hardware', fields: { X: fmt(lin.x), Y: fmt(lin.y), Z: fmt(lin.z) }, primary: mag3(lin.x, lin.y, lin.z) };
      } else {
        SX.raw.devicemotion = { status: 'unavailable', source: 'browser_api', fields: {}, message: 'Linear acceleration (gravity removed) not exposed by this device.' };
      }
      const rr = e.rotationRate || {};
      if (rr.alpha !== null && rr.alpha !== undefined) {
        SX.raw.gyro = { status: 'available', source: 'hardware', fields: { X: fmt(rr.beta), Y: fmt(rr.gamma), Z: fmt(rr.alpha) }, primary: mag3(rr.beta, rr.gamma, rr.alpha) };
      } else {
        SX.raw.gyro = { status: 'unavailable', source: 'browser_api', fields: {}, message: 'Rotation rate not exposed by this device.' };
      }
    }, { passive: true });

    window.addEventListener('deviceorientation', (e) => {
      if (e.alpha === null && e.beta === null && e.gamma === null) {
        SX.raw.deviceorientation = { status: 'unavailable', source: 'browser_api', fields: {}, message: 'Orientation angles not exposed by this device.' };
        return;
      }
      SX.raw.deviceorientation = { status: 'available', source: 'hardware', fields: { 'α': fmt(e.alpha, 1), 'β': fmt(e.beta, 1), 'γ': fmt(e.gamma, 1) } };
      Motion3D.update(e.beta || 0, e.gamma || 0, e.alpha || 0);
      // compass fallback (relative, not true north) if no absolute/webkit heading arrives
      if (!CompassManager.hasTrueSource) {
        CompassManager.updateFromAlpha(e.alpha, e.webkitCompassHeading, e.absolute);
      }
    }, { passive: true });

    window.addEventListener('deviceorientationabsolute', (e) => {
      CompassManager.hasTrueSource = true;
      if (e.alpha !== null) CompassManager.updateFromAlpha(e.alpha, null, true);
    }, { passive: true });
  }
};

/* ---------------------------- Motion3D (3D phone model) ---------------------------- */
const Motion3D = {
  last: { pitch: 0, roll: 0, yaw: 0 },
  update(beta, gamma, alpha) {
    this.last = { pitch: beta, roll: gamma, yaw: alpha };
  },
  render() {
    const el = $('phone3d'); if (!el) return;
    const { pitch, roll, yaw } = this.last;
    el.style.transform = `rotateX(${-pitch}deg) rotateY(${roll}deg) rotateZ(${-yaw * 0}deg)`;
    $('motPitch').textContent = fmt(pitch, 1) + '°';
    $('motRoll').textContent = fmt(roll, 1) + '°';
    $('motYaw').textContent = fmt(yaw, 1) + '°';
  }
};

/* ---------------------------- CompassManager ---------------------------- */
const CompassManager = {
  hasTrueSource: false,
  heading: null, magHeading: null,
  updateFromAlpha(alpha, webkitHeading, absolute) {
    let heading;
    if (webkitHeading !== null && webkitHeading !== undefined) { heading = webkitHeading; this.hasTrueSource = true; }
    else if (absolute) { heading = (360 - alpha) % 360; }
    else { heading = (360 - alpha) % 360; }
    this.heading = heading; this.magHeading = heading;
    SX.raw.compass = {
      status: 'available', source: 'hardware',
      fields: { Heading: fmt(heading, 0) + '°' }, primary: heading
    };
  },
  render() {
    const el = $('compassDial'); if (!el) return;
    const s = SX.sensors.compass;
    if (s.status !== 'available') {
      $('compassDeg').textContent = '--°'; $('compassDir').textContent = '--';
      $('compassStatus').textContent = MotionManager.needsGesture() ? 'PERMISSION REQUIRED' : 'UNAVAILABLE';
      return;
    }
    const h = this.heading;
    $('compassNeedle').style.transform = `translate(-50%,-100%) rotate(${-h}deg)`;
    $('compassDeg').textContent = fmt(h, 0) + '°';
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    $('compassDir').textContent = dirs[Math.round(h / 45) % 8];
    $('compassMag').textContent = fmt(this.magHeading, 0) + '°';
    $('compassTrue').textContent = this.hasTrueSource ? fmt(h, 0) + '°' : 'Unavailable (needs absolute orientation)';
    $('compassCal').textContent = this.hasTrueSource ? 'Calibrated' : 'Uncalibrated (relative)';
    $('compassStatus').textContent = 'ACTIVE'; $('compassStatus').className = 'status-tag status-available';
  }
};

/* ---------------------------- MagnetometerManager ---------------------------- */
const MagnetometerManager = {
  supported: false, lastTotal: null,
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
        sensor.addEventListener('error', () => { SX.raw.magneto = { status: 'unavailable', source: 'browser_api', fields: {}, message: 'Magnetometer sensor error (permissions policy or hardware).' }; });
        sensor.start();
        this.supported = true;
      } catch (e) {
        SX.raw.magneto = { status: 'unsupported', source: 'browser_api', fields: {}, message: 'Generic Sensor Magnetometer API not available in this browser.' };
      }
    } else {
      SX.raw.magneto = { status: 'unsupported', source: 'browser_api', fields: {}, message: 'No standard web API exposes raw magnetometer data in this browser.' };
    }
  },
  flagJump() { $('magWarning')?.classList.remove('hidden'); clearTimeout(this._t); this._t = setTimeout(() => $('magWarning')?.classList.add('hidden'), 4000); }
};

/* ---------------------------- Ambient Light / Proximity ---------------------------- */
function initLightProximity() {
  if ('AmbientLightSensor' in window) {
    try {
      const s = new window.AmbientLightSensor();
      s.addEventListener('reading', () => { SX.raw.light = { status: 'available', source: 'hardware', fields: { Lux: fmt(s.illuminance, 0) }, primary: s.illuminance }; });
      s.addEventListener('error', () => { SX.raw.light = { status: 'unavailable', source: 'browser_api', fields: {}, message: 'Ambient light sensor blocked (permissions policy) or unavailable.' }; });
      s.start();
    } catch (e) { SX.raw.light = { status: 'unsupported', source: 'browser_api', fields: {}, message: 'AmbientLightSensor API not available in this browser.' }; }
  } else if ('ondevicelight' in window) {
    window.addEventListener('devicelight', (e) => { SX.raw.light = { status: 'available', source: 'hardware', fields: { Lux: fmt(e.value, 0) }, primary: e.value }; });
  } else {
    SX.raw.light = { status: 'unsupported', source: 'browser_api', fields: {}, message: 'No ambient light API available in this browser.' };
  }

  if ('ProximitySensor' in window) {
    try {
      const s = new window.ProximitySensor();
      s.addEventListener('reading', () => { SX.raw.proximity = { status: 'available', source: 'hardware', fields: { State: s.near ? 'NEAR' : 'FAR' } }; });
      s.addEventListener('error', () => { SX.raw.proximity = { status: 'unavailable', source: 'browser_api', fields: {} }; });
      s.start();
    } catch (e) { SX.raw.proximity = { status: 'unsupported', source: 'browser_api', fields: {}, message: 'ProximitySensor API not available in this browser.' }; }
  } else if ('ondeviceproximity' in window || 'onuserproximity' in window) {
    window.addEventListener('userproximity', (e) => { SX.raw.proximity = { status: 'available', source: 'hardware', fields: { State: e.near ? 'NEAR' : 'FAR' } }; });
  } else {
    SX.raw.proximity = { status: 'unsupported', source: 'browser_api', fields: {}, message: 'No proximity API available in this browser. Distance values cannot be invented.' };
  }
}

/* ---------------------------- PressureManager (barometer) ---------------------------- */
function initPressure() {
  if ('Barometer' in window) {
    try {
      const s = new window.Barometer({ frequency: 1 });
      s.addEventListener('reading', () => {
        const hpa = s.pressure;
        const alt = 44330 * (1 - Math.pow(hpa / 1013.25, 1 / 5.255));
        SX.raw.pressure = { status: 'available', source: 'hardware', fields: { Pressure: fmt(hpa, 1) }, primary: hpa };
        SX.raw.altitude = { status: 'available', source: 'browser_api', fields: { Altitude: fmt(alt, 0) }, primary: alt };
        updatePressurePanel(hpa, alt);
      });
      s.start();
    } catch (e) {
      SX.raw.pressure = { status: 'unsupported', source: 'browser_api', fields: {}, message: 'Barometer API not available in this browser.' };
    }
  } else {
    SX.raw.pressure = { status: 'unsupported', source: 'browser_api', fields: {}, message: 'No standard web API exposes atmospheric pressure. Most phones do not report this to the browser.' };
  }
}
function updatePressurePanel(hpa, alt) {
  if (!$('page-pressure').classList.contains('active')) return;
  $('presHpa').textContent = fmt(hpa, 1);
  $('presKpa').textContent = fmt(hpa / 10, 2);
  $('presMmhg').textContent = fmt(hpa * 0.750062, 1);
  $('presAlt').textContent = fmt(alt, 0);
  $('presStatusTag').textContent = 'ACTIVE'; $('presStatusTag').className = 'status-tag status-available';
  ChartManager.drawBigChart($('presChart'), SX.sensors.altitude.history.map(p => p.v), '#35e2c4');
}

/* ---------------------------- LocationManager ---------------------------- */
const LocationManager = {
  started: false, watchId: null, mapDrawn: false,
  init() {
    if (!('geolocation' in navigator)) {
      SX.raw.gps = { status: 'unsupported', source: 'browser_api', fields: {} };
      SX.raw.altitude = SX.raw.altitude || { status: 'unsupported', source: 'browser_api', fields: {} };
      SX.raw.speed = { status: 'unsupported', source: 'browser_api', fields: {} };
      return;
    }
    SX.raw.gps = { status: 'permission', source: 'browser_api', fields: {} };
  },
  start() {
    if (this.started || !('geolocation' in navigator)) return;
    this.started = true;
    this.watchId = navigator.geolocation.watchPosition((pos) => {
      const c = pos.coords;
      SX.raw.gps = { status: 'available', source: 'hardware', fields: { Lat: fmt(c.latitude, 5), Lon: fmt(c.longitude, 5) } };
      if (c.altitude !== null) SX.raw.altitude = { status: 'available', source: 'hardware', fields: { Altitude: fmt(c.altitude, 0) }, primary: c.altitude, message: 'GPS-derived altitude (estimate).' };
      if (c.speed !== null) SX.raw.speed = { status: 'available', source: 'hardware', fields: { Speed: fmt(c.speed, 1) }, primary: c.speed };
      this.last = pos;
      this.updatePanel(pos);
      renderPermBar();
    }, (err) => {
      SX.raw.gps = { status: err.code === 1 ? 'permission' : 'unavailable', source: 'browser_api', fields: {}, message: err.message };
    }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 });
  },
  updatePanel(pos) {
    if (!$('page-location').classList.contains('active')) return;
    const c = pos.coords;
    $('locLat').textContent = fmt(c.latitude, 5); $('locLon').textContent = fmt(c.longitude, 5);
    $('locAcc').textContent = fmt(c.accuracy, 1);
    $('locAlt').textContent = c.altitude !== null ? fmt(c.altitude, 0) : 'Unavailable';
    $('locSpeed').textContent = c.speed !== null ? fmt(c.speed, 1) : 'Unavailable';
    $('locHead').textContent = c.heading !== null && !Number.isNaN(c.heading) ? fmt(c.heading, 0) + '°' : 'Unavailable';
    $('locStatus').textContent = c.accuracy < 20 ? 'GOOD FIX' : c.accuracy < 100 ? 'COARSE FIX' : 'POOR FIX';
    $('locStatus').className = 'status-tag ' + (c.accuracy < 20 ? 'status-available' : 'status-permission');
    $('locTs').textContent = new Date(pos.timestamp).toLocaleTimeString();
    const mapWrap = $('mapWrap');
    const d = 0.01;
    mapWrap.innerHTML = `<iframe loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=${c.longitude - d}%2C${c.latitude - d}%2C${c.longitude + d}%2C${c.latitude + d}&layer=mapnik&marker=${c.latitude}%2C${c.longitude}"></iframe>`;
  }
};

/* ---------------------------- BatteryManager ---------------------------- */
const BatteryManager = {
  init() {
    if (!navigator.getBattery) {
      SX.raw.battery = { status: 'unsupported', source: 'browser_api', fields: {}, message: 'Battery Status API not available in this browser.' };
      SX.raw.charging = { status: 'unsupported', source: 'browser_api', fields: {} };
      return;
    }
    navigator.getBattery().then(bat => {
      this.bat = bat;
      const update = () => {
        const pct = Math.round(bat.level * 100);
        SX.raw.battery = { status: 'available', source: 'browser_api', fields: { Level: pct + '%' }, primary: pct };
        SX.raw.charging = { status: 'available', source: 'browser_api', fields: { Status: bat.charging ? 'CHARGING' : 'NOT CHARGING' } };
        this.renderPanel(bat, pct);
      };
      update();
      bat.addEventListener('levelchange', update);
      bat.addEventListener('chargingchange', update);
      bat.addEventListener('chargingtimechange', update);
      bat.addEventListener('dischargingtimechange', update);
    }).catch(() => {
      SX.raw.battery = { status: 'unavailable', source: 'browser_api', fields: {} };
    });
  },
  renderPanel(bat, pct) {
    if (!$('page-battery').classList.contains('active')) return;
    $('batteryFill').style.height = pct + '%';
    $('batteryPct').textContent = pct + '%';
    $('batteryChg').textContent = bat.charging ? 'CHARGING' : 'NOT CHARGING';
    $('batteryChg').className = 'status-tag ' + (bat.charging ? 'status-available' : 'status-unavailable');
    $('batteryChgTime').textContent = (bat.chargingTime && isFinite(bat.chargingTime)) ? Math.round(bat.chargingTime / 60) + ' min' : '--';
    $('batteryDisTime').textContent = (bat.dischargingTime && isFinite(bat.dischargingTime)) ? Math.round(bat.dischargingTime / 60) + ' min' : '--';
    $('batteryStatusTag').textContent = 'LIVE'; $('batteryStatusTag').className = 'status-tag status-available';
    ChartManager.drawBigChart($('batteryChart'), SX.sensors.battery.history.map(p => p.v), '#35e2c4', { min: 0, max: 100 });
  }
};

/* ---------------------------- NetworkManager ---------------------------- */
const NetworkManager = {
  init() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn) {
      const update = () => {
        SX.raw.networktype = { status: 'available', source: 'browser_api', fields: { Type: conn.type || 'unknown' } };
        SX.raw.networkconn = { status: 'available', source: 'browser_api', fields: { Downlink: fmt(conn.downlink, 1) + ' Mbps (est.)', RTT: fmt(conn.rtt, 0) + ' ms (est.)' }, primary: conn.downlink };
        this.log(`type=${conn.effectiveType || '?'} downlink≈${conn.downlink}Mbps rtt≈${conn.rtt}ms`);
        this.renderPanel(conn);
      };
      update();
      conn.addEventListener('change', () => { update(); AlertManager.checkNetworkChange(); });
    } else {
      SX.raw.networktype = { status: 'unsupported', source: 'browser_api', fields: {}, message: 'Network Information API not available in this browser.' };
      SX.raw.networkconn = { status: 'unsupported', source: 'browser_api', fields: {} };
    }
    window.addEventListener('online', () => { this.log('Network: ONLINE'); updateOnlineDot(); AlertManager.checkNetworkChange(); });
    window.addEventListener('offline', () => { this.log('Network: OFFLINE'); updateOnlineDot(); AlertManager.checkNetworkChange(); });
  },
  renderPanel(conn) {
    if (!$('page-network').classList.contains('active')) return;
    $('netOnline').textContent = navigator.onLine ? 'ONLINE' : 'OFFLINE';
    $('netOnline').className = 'status-tag ' + (navigator.onLine ? 'status-available' : 'status-unavailable');
    $('netType').textContent = conn.type || 'Unavailable';
    $('netEff').textContent = conn.effectiveType || 'Unavailable';
    $('netDown').textContent = fmt(conn.downlink, 1) + ' (estimate)';
    $('netRtt').textContent = fmt(conn.rtt, 0) + ' (estimate)';
    $('netSave').textContent = conn.saveData ? 'ON' : 'OFF';
  },
  log(msg) {
    const box = $('netLog'); if (!box) return;
    const row = document.createElement('div'); row.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    box.prepend(row); while (box.children.length > 40) box.removeChild(box.lastChild);
  }
};
function updateOnlineDot() {
  const dot = $('onlineDot');
  dot.className = 'dot ' + (navigator.onLine ? 'dot-ok' : 'dot-bad');
  if (!$('page-network').classList.contains('active')) return;
  $('netOnline').textContent = navigator.onLine ? 'ONLINE' : 'OFFLINE';
}

/* ---------------------------- DeviceManager ---------------------------- */
const DeviceManager = {
  init() {
    const ua = navigator.userAgent;
    const browser = (() => {
      if (/Edg\//.test(ua)) return 'Edge';
      if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) return 'Chrome';
      if (/Firefox\//.test(ua)) return 'Firefox';
      if (/Safari\//.test(ua) && !/Chrome/.test(ua)) return 'Safari';
      return 'Unknown';
    })();
    const os = (() => {
      if (/Android/.test(ua)) return 'Android';
      if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
      if (/Windows/.test(ua)) return 'Windows';
      if (/Mac OS X/.test(ua)) return 'macOS';
      if (/Linux/.test(ua)) return 'Linux';
      return 'Unknown';
    })();
    SX.raw.deviceinfo = { status: 'available', source: 'browser_api', fields: { Summary: `${browser} on ${os}` } };
    const diag = [
      ['Browser', browser], ['Operating System', os],
      ['Screen Resolution', `${screen.width}×${screen.height}`],
      ['Device Pixel Ratio', window.devicePixelRatio || 1],
      ['CPU Cores', navigator.hardwareConcurrency || 'Unsupported'],
      ['Memory (approx.)', navigator.deviceMemory ? navigator.deviceMemory + ' GB' : 'Unsupported'],
      ['Touch Support', ('ontouchstart' in window) ? 'Yes' : 'No'],
      ['Max Touch Points', navigator.maxTouchPoints ?? 'Unsupported'],
      ['Vibration Support', navigator.vibrate ? 'Yes' : 'No'],
      ['Audio Output Support', (typeof Audio !== 'undefined') ? 'Yes' : 'No'],
      ['Orientation Support', window.DeviceOrientationEvent ? 'Yes' : 'No'],
      ['Web Serial Support', navigator.serial ? 'Yes' : 'No'],
      ['Web Bluetooth Support', navigator.bluetooth ? 'Yes' : 'No'],
    ];
    const grid = $('diagGrid');
    grid.innerHTML = diag.map(([k, v]) => `<div class="stat-box"><span>${k}</span><b>${v}</b></div>`).join('');

    const so = screen.orientation;
    if (so) {
      const upd = () => { SX.raw.screenorientation = { status: 'available', source: 'browser_api', fields: { Type: so.type } }; };
      upd(); so.addEventListener('change', upd);
    } else {
      SX.raw.screenorientation = { status: 'unsupported', source: 'browser_api', fields: {} };
    }
    this.refreshMedia();
    SX.raw.temperature = { status: 'unsupported', source: 'browser_api', fields: {}, message: 'No standard web API exposes device temperature.' };
    SX.raw.humidity = { status: 'unsupported', source: 'browser_api', fields: {}, message: 'No standard web API exposes ambient humidity.' };
    SX.raw.steps = { status: 'unsupported', source: 'browser_api', fields: {}, message: 'No standard web pedometer API exists.' };
  },
  refreshMedia() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      SX.raw.camera = { status: 'unsupported', source: 'browser_api', fields: {} };
      SX.raw.microphone = { status: 'unsupported', source: 'browser_api', fields: {} };
      return;
    }
    navigator.mediaDevices.enumerateDevices().then(list => {
      const cam = list.some(d => d.kind === 'videoinput');
      const mic = list.some(d => d.kind === 'audioinput');
      SX.raw.camera = { status: cam ? 'available' : 'unavailable', source: 'browser_api', fields: { Available: cam ? 'YES' : 'NO' } };
      SX.raw.microphone = { status: mic ? 'available' : 'unavailable', source: 'browser_api', fields: { Available: mic ? 'YES' : 'NO' } };
    }).catch(() => {
      SX.raw.camera = { status: 'unavailable', source: 'browser_api', fields: {} };
      SX.raw.microphone = { status: 'unavailable', source: 'browser_api', fields: {} };
    });
  }
};

/* ---------------------------- GeigerSimulator ---------------------------- */
const GeigerSimulator = {
  running: false, pulses: [], total: 0, startedAt: 0, level: 'normal', cpmHistory: [],
  levels: { low: 6, normal: 22, elevated: 65, high: 160, extreme: 420 },
  audioCtx: null,
  tickHandle: null, secHandle: null,
  init() {
    $('geigerToggle').addEventListener('click', () => this.toggle());
    document.querySelectorAll('.lvl-btn').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.lvl-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active'); this.level = b.dataset.lvl;
    }));
    document.querySelectorAll('.geiger-tab').forEach(t => t.addEventListener('click', () => {
      document.querySelectorAll('.geiger-tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      $('geigerSimPanel').classList.toggle('hidden', t.dataset.gmode !== 'sim');
      $('geigerExtPanel').classList.toggle('hidden', t.dataset.gmode !== 'ext');
    }));
    this.drawGauge(0);
  },
  toggle() {
    this.running ? this.stop() : this.start();
  },
  start() {
    this.running = true; this.startedAt = nowTs(); this.pulses = []; this.total = 0; this.cpmHistory = [];
    $('geigerToggle').textContent = 'STOP SIMULATOR';
    const avgCpm = () => this.levels[this.level];
    this.tickHandle = setInterval(() => {
      const prob = avgCpm() / 600; // per 100ms tick
      if (Math.random() < prob) this.pulse();
      this.render();
    }, 100);
    this.secHandle = setInterval(() => {
      const cpm = this.currentCpm();
      this.cpmHistory.push(cpm); if (this.cpmHistory.length > 60) this.cpmHistory.shift();
    }, 1000);
  },
  stop() {
    this.running = false;
    clearInterval(this.tickHandle); clearInterval(this.secHandle);
    $('geigerToggle').textContent = 'START SIMULATOR';
    SX.raw['geiger'] = null;
  },
  pulse() {
    this.pulses.push(nowTs()); this.total++;
    if ($('geigerSound').checked) this.click();
  },
  click() {
    try {
      this.audioCtx = this.audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const ctx = this.audioCtx;
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = 'square'; osc.frequency.value = 1800;
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.03);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.03);
    } catch (e) { /* audio unavailable */ }
  },
  currentCpm() {
    const cutoff = nowTs() - 60000;
    this.pulses = this.pulses.filter(t => t > cutoff);
    return this.pulses.length;
  },
  currentCps() {
    const cutoff = nowTs() - 1000;
    return this.pulses.filter(t => t > cutoff).length;
  },
  render() {
    if (!$('page-geiger').classList.contains('active')) return;
    const cpm = this.currentCpm(), cps = this.currentCps();
    $('geigerCpm').textContent = cpm;
    $('geigerCps').textContent = cps;
    $('geigerPulses').textContent = this.total;
    $('geigerLevel').textContent = this.level[0].toUpperCase() + this.level.slice(1);
    const el = Math.floor((nowTs() - this.startedAt) / 1000);
    $('geigerTime').textContent = `${String(Math.floor(el / 3600)).padStart(2, '0')}:${String(Math.floor(el / 60) % 60).padStart(2, '0')}:${String(el % 60).padStart(2, '0')}`;
    this.drawGauge(cpm);
    ChartManager.drawBigChart($('geigerChart'), this.cpmHistory.length ? this.cpmHistory : [0, 0], '#ffb454', { min: 0 });
    if (SX.recording.active && !SX.recording.paused) {
      DataRecorder.push({ sensor: 'geiger_simulated', timestamp: nowTs(), value: cpm, unit: 'CPM', source: 'simulation', status: 'simulated' });
    }
  },
  drawGauge(cpm) {
    const canvas = $('geigerGauge'); if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height, cx = w / 2, cy = h / 2, r = w / 2 - 14;
    ctx.clearRect(0, 0, w, h);
    const logCpm = Math.log10(Math.max(cpm, 1));
    const frac = clamp(logCpm / Math.log10(600), 0, 1);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0.75 * Math.PI, 2.25 * Math.PI); ctx.strokeStyle = '#1c2a2d'; ctx.lineWidth = 14; ctx.stroke();
    const color = frac < 0.4 ? '#62e08a' : frac < 0.7 ? '#ffb454' : '#ff5c5c';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0.75 * Math.PI, (0.75 + frac * 1.5) * Math.PI); ctx.strokeStyle = color; ctx.lineWidth = 14; ctx.lineCap = 'round'; ctx.stroke();
  }
};

/* ---------------------------- ExternalDetectorManager ---------------------------- */
const ExternalDetectorManager = {
  port: null, connected: false, total: 0, pulses: [],
  init() {
    $('extSerialBtn').addEventListener('click', () => this.connectSerial());
    $('extBleBtn').addEventListener('click', () => this.connectBle());
  },
  log(msg) {
    const box = $('extLog'); const row = document.createElement('div');
    row.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`; box.prepend(row);
    while (box.children.length > 60) box.removeChild(box.lastChild);
  },
  async connectSerial() {
    if (!navigator.serial) { this.log('Web Serial API is not supported in this browser.'); return; }
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 9600 });
      this.port = port; this.connected = true;
      $('extStatus').textContent = 'Connected (USB Serial)'; $('extStatus').className = 'status-tag status-available';
      this.log('Serial port connected. Waiting for data…');
      const decoder = new TextDecoderStream();
      port.readable.pipeTo(decoder.writable);
      const reader = decoder.readable.getReader();
      let buffer = '';
      while (this.connected) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let lines = buffer.split('\n');
        buffer = lines.pop();
        lines.forEach(line => this.handleLine(line.trim()));
      }
    } catch (e) {
      this.log('Serial connection failed: ' + e.message);
    }
  },
  handleLine(line) {
    if (!line) return;
    this.log('RX: ' + line);
    const n = parseFloat(line.replace(/[^0-9.\-]/g, ''));
    if (!Number.isNaN(n)) {
      this.total++; this.pulses.push(nowTs());
      const cutoff = nowTs() - 60000; this.pulses = this.pulses.filter(t => t > cutoff);
      $('extCpm').textContent = n;
      $('extCps').textContent = fmt(this.pulses.length / 60, 2);
      $('extTotal').textContent = this.total;
      AlertManager.checkExternalRadiation(n);
      if (SX.recording.active && !SX.recording.paused) {
        DataRecorder.push({ sensor: 'geiger_external', timestamp: nowTs(), value: n, unit: 'CPM', source: 'external_detector', status: 'available' });
      }
    }
  },
  async connectBle() {
    if (!navigator.bluetooth) { this.log('Web Bluetooth API is not supported in this browser.'); return; }
    try {
      const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true });
      this.log(`Bluetooth device selected: ${device.name || device.id}.`);
      this.log('Connected — but reading live counts needs the exact GATT service/characteristic UUID for your specific detector model, which varies by manufacturer. This cannot be guessed automatically.');
      $('extStatus').textContent = 'Connected (BLE, no data protocol)'; $('extStatus').className = 'status-tag status-permission';
    } catch (e) {
      this.log('Bluetooth connection cancelled or failed: ' + e.message);
    }
  }
};

/* ---------------------------- DataRecorder ---------------------------- */
const DataRecorder = {
  init() {
    $('recStart').addEventListener('click', () => this.start());
    $('recPause').addEventListener('click', () => this.pauseToggle());
    $('recStop').addEventListener('click', () => this.stop());
    $('recExportCsv').addEventListener('click', () => this.export('csv'));
    $('recExportJson').addEventListener('click', () => this.export('json'));
    this.durationHandle = setInterval(() => {
      if (SX.recording.active && !SX.recording.paused) {
        const el = Math.floor((nowTs() - SX.recording.startedAt) / 1000);
        $('recDuration').textContent = `${String(Math.floor(el / 60)).padStart(2, '0')}:${String(el % 60).padStart(2, '0')}`;
      }
    }, 1000);
  },
  start() {
    SX.recording = { active: true, paused: false, samples: [], startedAt: nowTs() };
    $('recStatus').textContent = 'RECORDING'; $('recStatus').className = 'status-tag status-available';
    $('recStart').disabled = true; $('recPause').disabled = false; $('recStop').disabled = false;
    $('recExportCsv').disabled = true; $('recExportJson').disabled = true;
    $('recCount').textContent = '0';
  },
  pauseToggle() {
    SX.recording.paused = !SX.recording.paused;
    $('recPause').textContent = SX.recording.paused ? 'RESUME' : 'PAUSE';
    $('recStatus').textContent = SX.recording.paused ? 'PAUSED' : 'RECORDING';
  },
  stop() {
    SX.recording.active = false;
    $('recStatus').textContent = 'STOPPED'; $('recStatus').className = 'status-tag status-unavailable';
    $('recStart').disabled = false; $('recPause').disabled = true; $('recStop').disabled = true;
    $('recExportCsv').disabled = SX.recording.samples.length === 0; $('recExportJson').disabled = SX.recording.samples.length === 0;
  },
  push(sample) {
    SX.recording.samples.push(sample);
    if (SX.recording.samples.length % 5 === 0) $('recCount').textContent = SX.recording.samples.length;
  },
  export(type) {
    const samples = SX.recording.samples;
    let blob, filename;
    if (type === 'csv') {
      const rows = ['sensor,timestamp,value,unit,source,status', ...samples.map(s => `${s.sensor},${new Date(s.timestamp).toISOString()},${s.value},${s.unit},${s.source},${s.status}`)];
      blob = new Blob([rows.join('\n')], { type: 'text/csv' }); filename = 'sensorx_recording.csv';
    } else {
      blob = new Blob([JSON.stringify(samples, null, 2)], { type: 'application/json' }); filename = 'sensorx_recording.json';
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  }
};

/* ---------------------------- AlertManager ---------------------------- */
const AlertManager = {
  thresholds: { accel: 25, magnetic: 150, batteryLow: 15, gpsAccuracy: 100, radiation: 1000 },
  cooldowns: {},
  fire(msg) {
    const banner = $('alertBanner');
    banner.textContent = '⚠ ' + msg;
    banner.classList.remove('hidden');
    clearTimeout(this._hideT);
    this._hideT = setTimeout(() => banner.classList.add('hidden'), 6000);
  },
  cool(key, ms = 15000) {
    const t = nowTs();
    if (this.cooldowns[key] && t - this.cooldowns[key] < ms) return false;
    this.cooldowns[key] = t; return true;
  },
  check(id, value) {
    if (id === 'accel' && value > this.thresholds.accel && this.cool('accel')) this.fire(`High acceleration detected: ${fmt(value,1)} m/s²`);
    if (id === 'magneto' && value > this.thresholds.magnetic && this.cool('magneto')) this.fire(`Magnetic field above threshold: ${fmt(value,1)} µT`);
    if (id === 'battery' && value < this.thresholds.batteryLow && this.cool('battery', 60000)) this.fire(`Battery low: ${fmt(value,0)}%`);
  },
  checkGps(accuracy) {
    if (accuracy > this.thresholds.gpsAccuracy && this.cool('gps')) this.fire(`GPS accuracy is poor: ±${fmt(accuracy,0)} m`);
  },
  checkNetworkChange() {
    if (!navigator.onLine && this.cool('net', 5000)) this.fire('Network disconnected.');
  },
  checkExternalRadiation(cpm) {
    if (cpm > this.thresholds.radiation && this.cool('rad')) this.fire(`External detector exceeded threshold: ${fmt(cpm,0)} CPM`);
  }
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
  list.innerHTML = defs.map(([k, label, sub]) => `
    <div class="setting-row">
      <div><span>${label}</span><small>${sub}</small></div>
      <input type="number" data-th="${k}" value="${AlertManager.thresholds[k]}" />
    </div>`).join('');
  list.querySelectorAll('input').forEach(inp => inp.addEventListener('change', () => {
    AlertManager.thresholds[inp.dataset.th] = parseFloat(inp.value) || 0;
  }));
}

/* ---------------------------- Sensor Scanner ---------------------------- */
function runScan() {
  const results = [
    ['Accelerometer', SX.sensors.accel.status],
    ['Gyroscope', SX.sensors.gyro.status],
    ['Magnetometer', SX.sensors.magneto.status],
    ['Compass / Heading', SX.sensors.compass.status],
    ['Ambient Light', SX.sensors.light.status],
    ['Proximity', SX.sensors.proximity.status],
    ['Barometer / Pressure', SX.sensors.pressure.status],
    ['Device Motion (linear)', SX.sensors.devicemotion.status],
    ['Device Orientation', SX.sensors.deviceorientation.status],
    ['GPS / Location', SX.sensors.gps.status],
    ['Altitude', SX.sensors.altitude.status],
    ['Speed', SX.sensors.speed.status],
    ['Temperature', SX.sensors.temperature.status],
    ['Humidity', SX.sensors.humidity.status],
    ['Step Counter', SX.sensors.steps.status],
    ['Battery API', SX.sensors.battery.status],
    ['Network Information', SX.sensors.networktype.status],
    ['Screen Orientation', SX.sensors.screenorientation.status],
    ['Camera', SX.sensors.camera.status],
    ['Microphone', SX.sensors.microphone.status],
    ['Web Serial (external Geiger)', navigator.serial ? 'available' : 'unsupported'],
    ['Web Bluetooth (external Geiger)', navigator.bluetooth ? 'available' : 'unsupported'],
    ['Geiger Simulator', 'simulated'],
  ];
  const tagClass = { available: 'scan-ok', permission: 'scan-perm', unsupported: 'scan-unsup', unavailable: 'scan-off', simulated: 'scan-sim', checking: 'scan-off' };
  const tagSym = { available: '✓ Available', permission: '⚠ Permission Required', unsupported: '○ Unsupported', unavailable: '× Unavailable', simulated: '◎ Simulated', checking: '… Checking' };
  $('scanResults').innerHTML = results.map(([name, status]) =>
    `<div class="scan-row"><span class="scan-row-name">${name}</span><span class="scan-row-tag ${tagClass[status]}">${tagSym[status]}</span></div>`
  ).join('');
}

/* ---------------------------- detail page live updates ---------------------------- */
function updateDetailPages() {
  if ($('page-motion').classList.contains('active')) {
    Motion3D.render();
    ['accel', 'gyro'].forEach(id => renderMiniCard(id, 'motionCards'));
  }
  if ($('page-compass').classList.contains('active')) CompassManager.render();
  if ($('page-magnetic').classList.contains('active')) renderMagneticPanel();
}

function renderMiniCard(id, gridId) {
  let grid = $(gridId);
  if (!grid.querySelector(`#mini-${id}`)) {
    const el = buildCardDOM(SX.sensors[id]); el.id = `mini-${id}`;
    el.querySelectorAll('[data-role]').forEach(n => n.dataset.mini = id);
    grid.appendChild(el);
  }
  const s = SX.sensors[id]; const el = $(`mini-${id}`);
  el.querySelector('[data-role="status"]').textContent = STATUS_LABEL[s.status];
  el.querySelector('[data-role="status"]').className = `status-tag ${STATUS_CLASS[s.status]}`;
  el.querySelector('[data-role="value"]').textContent = s.primary !== null ? fmt(s.primary, 2) : '--';
  el.querySelector('[data-role="sub"]').textContent = Object.entries(s.fields).map(([k, v]) => `${k}: ${v}`).join('   ');
  if (s.chart) ChartManager.drawSparkline(el.querySelector('[data-role="chart"]'), s.history.map(p => p.v));
}

function renderMagneticPanel() {
  const s = SX.sensors.magneto;
  if (s.status !== 'available') {
    $('magStatusTag').textContent = STATUS_LABEL[s.status]; $('magStatusTag').className = `status-tag ${STATUS_CLASS[s.status]}`;
    $('magX').textContent = $('magY').textContent = $('magZ').textContent = $('magTotal').textContent = '--';
    return;
  }
  $('magX').textContent = s.fields.X; $('magY').textContent = s.fields.Y; $('magZ').textContent = s.fields.Z;
  $('magTotal').textContent = fmt(s.primary, 1);
  $('magPeak').textContent = fmt(s.max, 1);
  $('magAvg').textContent = fmt(s.sum / s.count, 1);
  $('magStatusTag').textContent = 'LIVE'; $('magStatusTag').className = 'status-tag status-available';
  ChartManager.drawBigChart($('magChart'), s.history.map(p => p.v), '#35e2c4');
}

/* ---------------------------- UIManager ---------------------------- */
const UIManager = {
  init() {
    document.querySelectorAll('.nav-btn').forEach(btn => btn.addEventListener('click', () => this.goTo(btn.dataset.page)));
    $('scanBtn').addEventListener('click', runScan);
    setInterval(() => { $('clock').textContent = new Date().toLocaleTimeString(); }, 1000);
    window.addEventListener('online', updateOnlineDot); window.addEventListener('offline', updateOnlineDot);
    updateOnlineDot();
  },
  goTo(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    $(`page-${page}`).classList.add('active');
    document.querySelector(`.nav-btn[data-page="${page}"]`).classList.add('active');
    if (page === 'sensors') runScan();
  }
};

/* ---------------------------- init ---------------------------- */
function init() {
  renderCardGrid();
  MotionManager.init();
  CompassManager.hasTrueSource = false;
  MagnetometerManager.init();
  initLightProximity();
  initPressure();
  LocationManager.init();
  BatteryManager.init();
  NetworkManager.init();
  DeviceManager.init();
  GeigerSimulator.init();
  ExternalDetectorManager.init();
  DataRecorder.init();
  renderSettings();
  UIManager.init();
  renderPermBar();
  runScan();
  setTimeout(runScan, 1500);
}

document.addEventListener('DOMContentLoaded', init);
