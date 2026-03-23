/**
 * controls.js
 *
 * Wires DOM controls to simulation state.
 * This is the last script loaded, so all other modules are available.
 *
 * Controls handled here:
 *   - Start / Stop / Reset / Burst buttons
 *   - Producers / Consumers / Publish Rate sliders
 *   - Buffer Size pill group
 *   - Topology pill group (Broadcast / Work Pool)
 *   - Wait Strategy pill group
 *   - Slow Consumer pill group
 *   - Live clock
 *   - Boot sequence log messages
 */

// ── Utility: generic pill-group toggle ───────────────

/**
 * Attach a click handler to a pill group container.
 * Removes 'sel' from all siblings and adds it to the clicked pill.
 *
 * @param {string}   groupId   ID of the container element.
 * @param {string}   dataAttr  The data-* attribute to read from the clicked pill.
 * @param {Function} onChange  Called with the new value (string) on every change.
 */
function onPillChange(groupId, dataAttr, onChange) {
  document.getElementById(groupId).addEventListener('click', e => {
    const btn = e.target.closest(`[${dataAttr}]`);
    if (!btn) return;

    document.querySelectorAll(`#${groupId} [${dataAttr}]`)
      .forEach(b => b.classList.remove('sel'));
    btn.classList.add('sel');

    onChange(btn.getAttribute(dataAttr));
  });
}

// ── Simulation lifecycle buttons ──────────────────────

document.getElementById('btnStart').addEventListener('click', startSim);
document.getElementById('btnStop') .addEventListener('click', stopSim);
document.getElementById('btnReset').addEventListener('click', resetSim);
document.getElementById('btnBurst').addEventListener('click', burst);

// ── Slider controls ───────────────────────────────────

document.getElementById('sldrProducers').addEventListener('input', e => {
  state.numProducers = +e.target.value;
  document.getElementById('valProducers').textContent = state.numProducers;
  // Grow/shrink consumerSeqs to match; preserve existing cursor positions
  state.consumerSeqs = Array.from(
    { length: state.numConsumers },
    (_, i) => state.consumerSeqs[i] ?? -1
  );
  addLog('system', `Producers → <span class="amber">${state.numProducers}</span>`);
});

document.getElementById('sldrConsumers').addEventListener('input', e => {
  state.numConsumers = +e.target.value;
  document.getElementById('valConsumers').textContent = state.numConsumers;

  // New consumers start at the current minimum seq so they don't create
  // artificial back-pressure on a running simulation
  const minSeq = state.consumerSeqs.length
    ? Math.min(...state.consumerSeqs)
    : -1;

  state.consumerSeqs = Array.from(
    { length: state.numConsumers },
    (_, i) => state.consumerSeqs[i] !== undefined ? state.consumerSeqs[i] : minSeq
  );

  // Reset consumedBy on in-flight slots so the new consumer count is respected
  state.slots.forEach(s => {
    if (s.status !== 'empty') s.consumedBy = new Set();
  });

  addLog('system', `Consumers → <span class="amber">${state.numConsumers}</span>`);
});

document.getElementById('sldrRate').addEventListener('input', e => {
  state.publishRate = +e.target.value;
  document.getElementById('valRate').textContent = state.publishRate;
});

// ── Buffer size pills ─────────────────────────────────

onPillChange('bufGroup', 'data-buf', newSize => {
  const prev     = state.bufSize;
  state.bufSize  = +newSize;
  initSlots();   // re-allocate ring with new size; resets all sequences
  drawRing();
  addLog('system',
    `Buffer resized <span class="amber">${prev}</span>` +
    ` → <span class="green">${state.bufSize}</span>` +
    ` — sequences reset`
  );
});

// ── Topology pills ────────────────────────────────────

onPillChange('topoGroup', 'data-topo', newTopo => {
  state.topology  = newTopo;
  const isBc      = newTopo === 'broadcast';
  const color     = isBc ? 'var(--cyan)' : 'var(--amber)';
  const desc      = TOPO_DESC[newTopo];

  document.getElementById('topoDesc').innerHTML =
    `<span style="color:${color}">${desc}</span>`;

  // Align all consumers to the current minimum sequence so neither topology
  // starts with a stale cursor gap
  const minSeq = state.consumerSeqs.length
    ? Math.min(...state.consumerSeqs)
    : -1;
  state.consumerSeqs = Array.from({ length: state.numConsumers }, () => minSeq);
  state.slots.forEach(s => { s.consumedBy = new Set(); s.claimedBy = -1; });

  addLog('system',
    `Topology → <span style="color:${color}">${isBc ? 'BROADCAST' : 'WORK POOL'}</span>` +
    ` — ${desc}`
  );
});

// ── Wait strategy pills ───────────────────────────────

onPillChange('wsGroup', 'data-ws', newStrategy => {
  state.waitStrategy = newStrategy;
  document.getElementById('wsDesc').textContent = WS_DESC[newStrategy];
  addLog('system', `Wait strategy → <span class="cyan">${newStrategy}</span>`);
});

// ── Slow consumer pills ───────────────────────────────
// Pick a consumer to throttle to ~1/8 speed to demonstrate backpressure.

onPillChange('slowGroup', 'data-slow', newValue => {
  const prev        = state.slowConsumer;
  state.slowConsumer = +newValue; // -1 = off

  const descEl = document.getElementById('slowDesc');

  if (state.slowConsumer === -1) {
    descEl.innerHTML =
      `<span style="color:var(--text3)">Throttle one consumer to 1/8 speed — forces backpressure</span>`;
    if (prev >= 0) {
      addLog('system', `C${prev + 1} throttle <span class="green">REMOVED</span> — back to full speed`);
    }
  } else {
    descEl.innerHTML =
      `<span style="color:var(--amber)">C${state.slowConsumer + 1} throttled to 1/8 speed` +
      ` — watch the buffer fill and producer stall</span>`;
    addLog('warn',
      `<span class="amber">⚠ THROTTLE</span>` +
      ` C${state.slowConsumer + 1} slowed to 1/8 speed` +
      ` — buffer will fill · producer will stall`
    );
  }
});

// ── Live clock ────────────────────────────────────────

setInterval(() => {
  document.getElementById('clockEl').textContent =
    new Date().toTimeString().substr(0, 8);
}, 1000);

// ── Boot sequence ─────────────────────────────────────

initSlots();
resizeCanvas();
drawRing();

setTimeout(() => addLog('system',
  `<span class="green">LMAX Disruptor Simulation v3.4.2</span> initialised`
), 100);

setTimeout(() => addLog('system',
  `Ring buffer allocated: <span class="amber">${state.bufSize}</span> slots` +
  ` × 64 bytes = <span class="green">${state.bufSize * 64}B</span>`
), 300);

setTimeout(() => addLog('system',
  `Wait strategy: <span class="cyan">${state.waitStrategy}</span>` +
  ` — ${WS_DESC[state.waitStrategy]}`
), 500);

setTimeout(() => addLog('system',
  `<span style="color:var(--text3)">Press </span>` +
  `<span class="green">▶ START</span>` +
  `<span style="color:var(--text3)"> to begin publishing events</span>`
), 700);
