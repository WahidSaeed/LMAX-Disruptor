/**
 * ui.js
 *
 * Handles:
 *   - DOM stat updates  (updateStats)
 *   - Terminal log      (addLog)
 *   - Sim lifecycle     (startSim, stopSim, resetSim, burst)
 */

// ── Simulation lifecycle ──────────────────────────────

let simInterval = null; // handle returned by setInterval

function startSim() {
  if (state.running) return;
  state.running = true;

  document.getElementById('hdrStatus').textContent  = 'RUNNING';
  document.getElementById('hdrStatus').style.color  = 'var(--green)';
  document.getElementById('btnStart').classList.add('btn--active');

  simInterval = setInterval(simTick, 50); // tick every 50ms → 20 ticks/sec

  addLog('system',
    `Disruptor <span class="green">STARTED</span>` +
    ` — buf=<span class="hi">${state.bufSize}</span>` +
    `, producers=<span class="amber">${state.numProducers}</span>` +
    `, consumers=<span class="amber">${state.numConsumers}</span>` +
    `, topology=<span class="cyan">${state.topology}</span>` +
    `, strategy=<span class="cyan">${state.waitStrategy}</span>`
  );
}

function stopSim() {
  if (!state.running) return;
  state.running = false;
  clearInterval(simInterval);

  document.getElementById('hdrStatus').textContent  = 'STOPPED';
  document.getElementById('hdrStatus').style.color  = 'var(--red)';
  document.getElementById('btnStart').classList.remove('btn--active');

  addLog('warn',
    `Disruptor <span class="red">STOPPED</span>` +
    ` — published=<span class="amber">${state.totalPublished}</span>` +
    `, consumed=<span class="green">${state.totalConsumed}</span>`
  );
}

function resetSim() {
  stopSim();
  initSlots();

  // Reset display-side accumulators
  state.throughputAccum   = 0;
  state.throughputDisplay = 0;
  state.avgLatency        = 50;
  state.tLastThroughput   = performance.now();

  updateStats();
  drawRing();

  document.getElementById('hdrStatus').textContent = 'IDLE';
  document.getElementById('hdrStatus').style.color = 'var(--amber)';

  addLog('system', `Buffer <span class="amber">RESET</span> — all sequences cleared, slots emptied`);
}

/** Temporarily pin publish rate to maximum for 2 seconds to stress-test backpressure. */
function burst() {
  const savedRate     = state.publishRate;
  state.publishRate   = 100;

  addLog('system', `<span class="amber">⚡ BURST MODE</span> — injecting 2s of maximum throughput`);

  setTimeout(() => {
    state.publishRate = savedRate;
    addLog('system', `Burst complete — resuming normal rate`);
  }, 2000);
}

// ── Stats DOM update ──────────────────────────────────

function updateStats() {
  // Throughput: recalculate every 500ms
  const now     = performance.now();
  const elapsed = (now - state.tLastThroughput) / 1000;
  if (elapsed >= 0.5) {
    state.throughputDisplay = Math.round(state.throughputAccum / elapsed);
    state.throughputAccum   = 0;
    state.tLastThroughput   = now;
  }

  const fillFrac  = _getBufferFillFraction();
  const fillPct   = Math.round(fillFrac * 100);
  const maxTp     = state.numProducers * state.publishRate * 20;

  // Throughput
  _setText ('statThroughput', state.throughputDisplay.toLocaleString());
  _setWidth('barThroughput',  Math.min(100, state.throughputDisplay / maxTp * 100));

  // Latency
  _setText ('statLatency',    Math.round(state.avgLatency));
  _setWidth('barLatency',     Math.min(100, state.avgLatency / 300 * 100));

  // Event counts
  _setText('statPublished', state.totalPublished.toLocaleString());
  _setText('statConsumed',  state.totalConsumed.toLocaleString());

  // Buffer fill — colour shifts amber then red as it fills
  const fillEl       = document.getElementById('statFill');
  fillEl.textContent = fillPct + '%';
  fillEl.className   = 'stat-value' + (fillPct > 80 ? ' red' : fillPct > 50 ? ' amber' : '');
  _setWidth('barFill', fillPct);
  document.getElementById('barFill').style.background =
    fillPct > 80 ? 'var(--red)' : fillPct > 50 ? 'var(--amber)' : 'var(--green3)';

  // Wrap-arounds
  _setText('statWraps', state.wraps.toLocaleString());

  // Header buffer size
  _setText('hdrBufSize', state.bufSize);

  // Header status text — overrides to 'STALLED' in red when backpressure is active
  if (state.isStalled && state.running) {
    document.getElementById('hdrStatus').textContent = 'STALLED';
    document.getElementById('hdrStatus').style.color = 'var(--red)';
  } else if (state.running) {
    document.getElementById('hdrStatus').textContent = 'RUNNING';
    document.getElementById('hdrStatus').style.color = 'var(--green)';
  }
}

function _getBufferFillFraction() {
  const occupied = state.slots.filter(
    s => s.status === 'published' || s.status === 'consuming'
  ).length;
  return occupied / state.bufSize;
}

function _setText(id, value) {
  document.getElementById(id).textContent = value;
}

function _setWidth(id, pct) {
  document.getElementById(id).style.width = pct + '%';
}

// ── Terminal log ──────────────────────────────────────

let   logCount = 0;
const MAX_LOG  = 200; // max lines before oldest are removed

/**
 * Append a line to the terminal log.
 *
 * @param {'producer'|'consumer'|'system'|'warn'} type  Controls badge colour.
 * @param {string} msg  HTML string — use span helpers for inline colour.
 */
function addLog(type, msg) {
  const out    = document.getElementById('logOutput');
  const ts     = new Date().toISOString().substr(11, 12); // HH:MM:SS.mmm
  const tagMap = { producer: 'PROD', consumer: 'CONS', system: 'SYS', warn: 'WARN' };

  const line       = document.createElement('div');
  line.className   = 'log-line';
  line.innerHTML   =
    `<span class="log-ts">${ts}</span>` +
    `<span class="log-tag ${type}">${tagMap[type] || type}</span>` +
    `<span class="log-msg">${msg}</span>`;

  out.appendChild(line);
  logCount++;

  // Trim oldest lines once the cap is reached
  if (logCount > MAX_LOG) {
    out.removeChild(out.firstChild);
    logCount--;
  }

  out.scrollTop = out.scrollHeight;
}
