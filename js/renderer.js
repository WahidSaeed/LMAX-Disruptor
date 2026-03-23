/**
 * renderer.js
 *
 * Responsible for all canvas drawing. Reads from `state` but never writes to it.
 *
 * Drawing order each frame:
 *   1. Background + grid
 *   2. Outer glow halo
 *   3. Individual slots (coloured by status)
 *   4. Producer pointers (dashed arrows from centre)
 *   5. Consumer badges (broadcast = stacked orbits, workpool = shared dashed ring)
 *   6. Centre HUD (fill %, topology label, producer sequence)
 *   7. Stall overlay (only when state.isStalled)
 */

const canvas = document.getElementById('ringCanvas');
const ctx    = canvas.getContext('2d');

// ── Canvas sizing ─────────────────────────────────────

/**
 * Resize the canvas backing store to match its CSS size × devicePixelRatio.
 * Must be called on load and on every resize event.
 */
function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  canvas.width  = rect.width  * devicePixelRatio;
  canvas.height = rect.height * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
}

window.addEventListener('resize', () => {
  resizeCanvas();
  drawRing();
});

// ── Helpers ───────────────────────────────────────────

/** Returns the fraction of buffer slots that are occupied (0–1). */
function getBufferFill() {
  const occupied = state.slots.filter(
    s => s.status === 'published' || s.status === 'consuming'
  ).length;
  return occupied / state.bufSize;
}

// ── Main draw function ────────────────────────────────

function drawRing() {
  const w  = canvas.width  / devicePixelRatio;
  const h  = canvas.height / devicePixelRatio;
  const cx = w / 2;
  const cy = h / 2;
  const R  = Math.min(w, h) * 0.38;  // ring radius
  const n  = state.bufSize;

  ctx.clearRect(0, 0, w, h);

  _drawBackground(w, h);
  _drawOuterGlow(cx, cy, R);
  _drawSlots(cx, cy, R, n);
  _drawProducerPointers(cx, cy, R, n);
  _drawConsumerBadges(cx, cy, R, n);
  _drawCentreHUD(cx, cy, R);

  if (state.isStalled) {
    _drawStallOverlay(cx, cy, R, w, h);
  }
}

// ── Private drawing helpers ───────────────────────────

function _drawBackground(w, h) {
  ctx.fillStyle = '#0a0c0a';
  ctx.fillRect(0, 0, w, h);

  // Subtle grid
  ctx.strokeStyle = '#121612';
  ctx.lineWidth   = 0.5;
  const gridStep  = 40;
  for (let x = 0; x < w; x += gridStep) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 0; y < h; y += gridStep) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
}

function _drawOuterGlow(cx, cy, R) {
  const grd = ctx.createRadialGradient(cx, cy, R - 30, cx, cy, R + 30);
  grd.addColorStop(0,   'transparent');
  grd.addColorStop(0.5, '#39ff1406');
  grd.addColorStop(1,   'transparent');

  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = grd;
  ctx.lineWidth   = 60;
  ctx.stroke();
}

function _drawSlots(cx, cy, R, n) {
  // Slot radius shrinks as n grows so they don't overlap
  const slotR = Math.min(22, (Math.PI * 2 * R / n) * 0.38);

  for (let i = 0; i < n; i++) {
    const angle  = (i / n) * Math.PI * 2 - Math.PI / 2;
    const sx     = cx + R * Math.cos(angle);
    const sy     = cy + R * Math.sin(angle);
    const slot   = state.slots[i];
    const colors = SLOT_COLORS[slot.status] || SLOT_COLORS.empty;

    // Soft glow halo for active slots
    if (slot.status === 'consuming' || slot.status === 'published') {
      ctx.beginPath();
      ctx.arc(sx, sy, slotR + 6, 0, Math.PI * 2);
      ctx.fillStyle = slot.status === 'consuming' ? '#00e5ff18' : '#39ff1412';
      ctx.fill();
    }

    // Slot circle
    ctx.beginPath();
    ctx.arc(sx, sy, slotR, 0, Math.PI * 2);
    ctx.fillStyle   = colors.fill;
    ctx.fill();
    ctx.strokeStyle = colors.stroke;
    ctx.lineWidth   = slot.status === 'consuming' ? 1.5 : 1;
    ctx.stroke();

    // Index label — only show on every Nth slot to avoid clutter
    const labelEvery = Math.max(1, Math.floor(n / 16));
    if (n <= 128 && i % labelEvery === 0) {
      ctx.fillStyle    = '#2a3a2a';
      ctx.font         = `${Math.max(7, slotR * 0.55)}px JetBrains Mono`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(i, sx, sy);
    }
  }
}

function _drawProducerPointers(cx, cy, R, n) {
  // Slot radius duplicated here for arrowhead positioning
  const slotR = Math.min(22, (Math.PI * 2 * R / n) * 0.38);

  for (let p = 0; p < state.numProducers; p++) {
    const seq = state.producerSeq - p;
    if (seq < 0) continue;

    const idx   = ((seq % n) + n) % n;
    const angle = (idx / n) * Math.PI * 2 - Math.PI / 2;
    const color = PRODUCER_COLORS[p % PRODUCER_COLORS.length];

    // Dashed arrow from 62% radius to slot edge
    const arrowStart = R * 0.62;
    ctx.beginPath();
    ctx.moveTo(
      cx + arrowStart * Math.cos(angle),
      cy + arrowStart * Math.sin(angle)
    );
    ctx.lineTo(
      cx + R * Math.cos(angle) - (slotR + 4) * Math.cos(angle),
      cy + R * Math.sin(angle) - (slotR + 4) * Math.sin(angle)
    );
    ctx.strokeStyle = color + '88';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Circular badge at arrow base
    const bx = cx + (R * 0.58) * Math.cos(angle);
    const by = cy + (R * 0.58) * Math.sin(angle);
    ctx.beginPath();
    ctx.arc(bx, by, 9, 0, Math.PI * 2);
    ctx.fillStyle   = color + '22';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1;
    ctx.stroke();
    ctx.fillStyle    = color;
    ctx.font         = 'bold 7px JetBrains Mono';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('P' + (p + 1), bx, by);
  }
}

function _drawConsumerBadges(cx, cy, R, n) {
  if (state.topology === 'broadcast') {
    _drawBroadcastConsumers(cx, cy, R, n);
  } else {
    _drawWorkPoolConsumers(cx, cy, R, n);
  }
}

/**
 * Broadcast topology: each consumer gets its own orbit ring at increasing radii.
 * This makes it clear that all consumers are independently tracking the same events.
 */
function _drawBroadcastConsumers(cx, cy, R, n) {
  for (let c = 0; c < state.numConsumers; c++) {
    const seq = state.consumerSeqs[c];
    if (seq < 0) continue;

    const idx       = ((seq % n) + n) % n;
    const angle     = (idx / n) * Math.PI * 2 - Math.PI / 2;
    const color     = CONSUMER_COLORS[c % CONSUMER_COLORS.length];
    const orbitR    = R * 1.18 + c * 14; // stagger each consumer outward
    const sx        = cx + orbitR * Math.cos(angle);
    const sy        = cy + orbitR * Math.sin(angle);
    const isBottleneck = state.isStalled && c === state.bottleneckConsumer;
    const isSlow       = c === state.slowConsumer;

    // Track arc (short arc at current position)
    ctx.beginPath();
    ctx.arc(cx, cy, orbitR, angle - 0.08, angle + 0.08);
    ctx.strokeStyle = color + '44';
    ctx.lineWidth   = 8;
    ctx.stroke();

    // Pulsing alert ring around the bottleneck consumer
    if (isBottleneck) {
      ctx.beginPath();
      ctx.arc(sx, sy, 14 + Math.sin(state.tick * 0.3) * 3, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff3b3b44';
      ctx.lineWidth   = 2;
      ctx.stroke();
    }

    // Badge circle
    ctx.beginPath();
    ctx.arc(sx, sy, 10, 0, Math.PI * 2);
    ctx.fillStyle   = isBottleneck ? '#3d000022' : color + '22';
    ctx.fill();
    ctx.strokeStyle = isBottleneck ? '#ff3b3b' : isSlow ? '#ffb300' : color;
    ctx.lineWidth   = isBottleneck ? 2.5 : 1.5;
    ctx.stroke();

    // Label
    ctx.fillStyle    = isBottleneck ? '#ff3b3b' : isSlow ? '#ffb300' : color;
    ctx.font         = isBottleneck ? 'bold 8px JetBrains Mono' : 'bold 7px JetBrains Mono';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('C' + (c + 1), sx, sy);
  }
}

/**
 * Work-pool topology: all consumers compete on a single shared orbit.
 * The consumer that claimed a slot is highlighted in amber.
 */
function _drawWorkPoolConsumers(cx, cy, R, n) {
  const orbitR = R * 1.22;

  // Full dashed shared orbit ring
  ctx.beginPath();
  ctx.arc(cx, cy, orbitR, 0, Math.PI * 2);
  ctx.strokeStyle = '#ffb30022';
  ctx.lineWidth   = 10;
  ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  for (let c = 0; c < state.numConsumers; c++) {
    const seq = state.consumerSeqs[c];
    if (seq < 0) continue;

    const idx       = ((seq % n) + n) % n;
    // Small angular spread so badges don't stack on the same slot
    const baseAngle = (idx / n) * Math.PI * 2 - Math.PI / 2;
    const spread    = (c - (state.numConsumers - 1) / 2) * 0.08;
    const angle     = baseAngle + spread;
    const color     = CONSUMER_COLORS[c % CONSUMER_COLORS.length];
    const sx        = cx + orbitR * Math.cos(angle);
    const sy        = cy + orbitR * Math.sin(angle);

    // Check if this consumer currently owns the active slot
    const isClaimer = state.slots[idx] && state.slots[idx].claimedBy === c;

    ctx.beginPath();
    ctx.arc(sx, sy, isClaimer ? 12 : 10, 0, Math.PI * 2);
    ctx.fillStyle   = isClaimer ? color + '44' : color + '22';
    ctx.fill();
    ctx.strokeStyle = isClaimer ? '#ffb300' : color;
    ctx.lineWidth   = isClaimer ? 2 : 1.5;
    ctx.stroke();

    ctx.fillStyle    = isClaimer ? '#ffb300' : color;
    ctx.font         = 'bold 7px JetBrains Mono';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('C' + (c + 1), sx, sy);
  }
}

function _drawCentreHUD(cx, cy, R) {
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  // Background disc
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.42, 0, Math.PI * 2);
  ctx.fillStyle   = '#1a2b1a';
  ctx.fill();
  ctx.strokeStyle = '#1f2b1f';
  ctx.lineWidth   = 1;
  ctx.stroke();

  // Title
  ctx.fillStyle = '#39ff14';
  ctx.font      = 'bold 15px JetBrains Mono';
  ctx.fillText('RING', cx, cy - 22);

  ctx.fillStyle = '#22cc00';
  ctx.font      = 'bold 13px JetBrains Mono';
  ctx.fillText('BUFFER', cx, cy - 6);

  // Size
  ctx.fillStyle = '#7da87d';
  ctx.font      = '10px JetBrains Mono';
  ctx.fillText('SIZE: ' + state.bufSize, cx, cy + 12);

  // Fill % (colour-coded: green → amber → red)
  const fillPct   = Math.round(getBufferFill() * 100);
  const fillColor = fillPct > 80 ? '#ff3b3b' : fillPct > 50 ? '#ffb300' : '#39ff14';
  ctx.fillStyle   = fillColor;
  ctx.font        = 'bold 11px JetBrains Mono';
  ctx.fillText(fillPct + '%', cx, cy + 28);

  // Topology
  ctx.fillStyle = state.topology === 'broadcast' ? '#00e5ff' : '#ffb300';
  ctx.font      = 'bold 9px JetBrains Mono';
  ctx.fillText(
    state.topology === 'broadcast' ? 'BROADCAST' : 'WORK POOL',
    cx, cy + 44
  );

  // Producer sequence
  ctx.fillStyle = '#4a6b4a';
  ctx.font      = '9px JetBrains Mono';
  ctx.fillText('PROD SEQ: ' + Math.max(0, state.producerSeq), cx, cy + 58);
}

/**
 * Full-screen red vignette + floating banners shown while the producer is stalled.
 */
function _drawStallOverlay(cx, cy, R, w, h) {
  const stalledFor = state.tick - state.stalledSinceTick;
  const pulse      = 0.55 + 0.45 * Math.abs(Math.sin(state.tick * 0.18));

  // Red vignette wash
  const vigGrd = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 1.5);
  vigGrd.addColorStop(0, 'transparent');
  vigGrd.addColorStop(1, `rgba(255,59,59,${0.10 * pulse})`);
  ctx.fillStyle = vigGrd;
  ctx.fillRect(0, 0, w, h);

  // "PRODUCER STALLED" banner above ring
  const bw = 200, bh = 26;
  const bx = cx - bw / 2;
  const by = cy - R - 46;
  ctx.fillStyle   = `rgba(61,10,10,${0.92 * pulse})`;
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = `rgba(255,59,59,${pulse})`;
  ctx.lineWidth   = 1;
  ctx.strokeRect(bx, by, bw, bh);
  ctx.fillStyle    = `rgba(255,59,59,${pulse})`;
  ctx.font         = 'bold 11px JetBrains Mono';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`⛔ PRODUCER STALLED  +${stalledFor}t`, cx, by + 13);

  // Bottleneck label below ring
  if (state.bottleneckConsumer >= 0) {
    const lby = cy + R + 20;
    ctx.fillStyle   = '#3d000099';
    ctx.fillRect(cx - 130, lby, 260, 20);
    ctx.strokeStyle = '#ff3b3b66';
    ctx.lineWidth   = 1;
    ctx.strokeRect(cx - 130, lby, 260, 20);
    ctx.fillStyle    = '#ff6b6b';
    ctx.font         = '9px JetBrains Mono';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      `BOTTLENECK → C${state.bottleneckConsumer + 1}  ` +
      `seq=${state.consumerSeqs[state.bottleneckConsumer]}  ` +
      `(producer at ${state.producerSeq})`,
      cx, lby + 10
    );
  }
}
