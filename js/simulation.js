/**
 * simulation.js
 *
 * Core simulation engine. Called once every 50ms by setInterval in ui.js.
 *
 * Each tick:
 *   1. Producers try to claim and publish new slots.
 *      → If the slowest consumer is too far behind, the producer stalls (backpressure).
 *   2. Consumers advance their cursor.
 *      → Broadcast: every consumer reads every event independently.
 *      → Work Pool: consumers race; the first to claim a slot processes it exclusively.
 *   3. Stats are updated and the canvas is redrawn.
 */

function simTick() {
  state.tick++;

  _tickProducers();
  _tickConsumers();
  _tickLatency();

  updateStats();
  drawRing();
}

// ── Producer phase ────────────────────────────────────

function _tickProducers() {
  const n             = state.bufSize;
  const pubsThisTick  = Math.ceil(state.publishRate / 20);
  let   stalledThisTick = false;

  for (let p = 0; p < state.numProducers; p++) {
    for (let k = 0; k < pubsThisTick; k++) {

      const nextSeq = state.producerSeq + 1;
      const idx     = nextSeq % n;

      // ── Back-pressure check ──────────────────────
      //
      // The Disruptor rule: a producer cannot publish to slot [idx] until
      // every consumer has moved past it. This prevents a fast producer
      // from overwriting events a slow consumer hasn't read yet.
      //
      //   nextSeq - slowestConsumerSeq >= bufSize  →  BLOCKED
      //
      const slowestConsumerSeq = Math.min(...state.consumerSeqs);
      const bottleneckIdx      = state.consumerSeqs.indexOf(slowestConsumerSeq);

      if (nextSeq - slowestConsumerSeq >= n - 1) {
        // Producer cannot advance — mark slot as backpressure and record the stall
        state.slots[idx].status = 'backpressure';
        stalledThisTick = true;

        _recordStall(bottleneckIdx);
        break; // No point trying to publish more events this tick
      }

      // ── Publish ──────────────────────────────────
      // If we were previously stalled, log the recovery
      if (state.isStalled) {
        _recordStallResolved(bottleneckIdx);
      }

      const isWrap = nextSeq > 0 && nextSeq % n === 0;
      if (isWrap) state.wraps++;

      // Stamp the slot with the new event
      const slot         = state.slots[idx];
      slot.status        = 'published';
      slot.publishedBy   = p;
      slot.publishedSeq  = nextSeq;
      slot.consumedBy    = new Set(); // reset from previous lap
      slot.claimedBy     = -1;
      slot.age           = 0;
      slot.eventType     = EVENT_TYPES[Math.floor(Math.random() * EVENT_TYPES.length)];

      state.producerSeq = nextSeq;
      state.totalPublished++;
      state.throughputAccum++;

      if (Math.random() < 0.03) {
        addLog('producer',
          `P${p+1} published <span class="green">${slot.eventType}</span>` +
          ` → slot <span class="hi">[${idx}]</span>` +
          ` seq=<span class="amber">${nextSeq}</span>`
        );
      }
    }
  }

  // If no producer stalled this tick, clear any lingering stall flag
  if (!stalledThisTick && state.isStalled) {
    state.isStalled          = false;
    state.bottleneckConsumer = -1;
  }
}

function _recordStall(bottleneckIdx) {
  state.bottleneckConsumer = bottleneckIdx;

  if (!state.isStalled) {
    // First tick of this stall
    state.isStalled         = true;
    state.stalledSinceTick  = state.tick;
    state.totalStallEvents++;

    addLog('warn',
      `<span class="red">⛔ PRODUCER STALLED</span>` +
      ` — buffer full (${state.bufSize}/${state.bufSize} slots)` +
      ` · gated by <span class="amber">C${bottleneckIdx + 1}</span>` +
      ` @ seq <span class="hi">${state.consumerSeqs[bottleneckIdx]}</span>` +
      ` · producer seq=<span class="hi">${state.producerSeq}</span>`
    );
  } else {
    // Ongoing stall — log a reminder every 20 ticks
    const stalledFor = state.tick - state.stalledSinceTick;
    if (stalledFor % 20 === 0) {
      addLog('warn',
        `<span class="red">STALL</span> +${stalledFor} ticks` +
        ` — waiting for <span class="amber">C${bottleneckIdx + 1}</span>` +
        ` to advance past seq <span class="hi">${state.consumerSeqs[bottleneckIdx]}</span>`
      );
    }
  }
}

function _recordStallResolved(bottleneckIdx) {
  const duration          = state.tick - state.stalledSinceTick;
  state.totalStalledTicks += duration;
  state.isStalled          = false;
  state.bottleneckConsumer = -1;

  addLog('system',
    `<span class="green">✓ STALL RESOLVED</span>` +
    ` — stalled for <span class="amber">${duration}</span> ticks` +
    ` · C${bottleneckIdx + 1} caught up · resuming`
  );
}

// ── Consumer phase ────────────────────────────────────

function _tickConsumers() {
  const delay = (WS_DELAY_MULT[state.waitStrategy] || 0) * 50;

  if (state.topology === 'broadcast') {
    _tickBroadcastConsumers(delay);
  } else {
    _tickWorkPoolConsumers(delay);
  }
}

/**
 * Broadcast: every consumer independently reads every published event.
 * A slot is only freed once ALL consumers have consumed it.
 *
 * Real-world use: journal handler + replication handler + business logic handler
 * all need to see every trade event.
 */
function _tickBroadcastConsumers(delay) {
  const n = state.bufSize;

  for (let c = 0; c < state.numConsumers; c++) {
    // Throttled consumer: skip most ticks to simulate a slow handler
    if (c === state.slowConsumer && state.tick % 8 !== 0) continue;

    const nextConsSeq = state.consumerSeqs[c] + 1;

    // Nothing published ahead of us yet
    if (nextConsSeq > state.producerSeq) continue;

    const idx  = ((nextConsSeq % n) + n) % n;
    const slot = state.slots[idx];

    // Guard: the slot must carry the sequence we expect.
    // Without this check a consumer could re-read a slot that was already
    // overwritten by the producer on a new lap of the ring.
    if (slot.publishedSeq !== nextConsSeq) continue;

    // Guard: this specific consumer must not have already consumed this slot
    if (slot.consumedBy.has(c)) continue;

    // Mark as consumed by this consumer
    slot.consumedBy.add(c);
    if (slot.status === 'published' || slot.status === 'consuming') {
      slot.status = 'consuming';
    }
    state.consumerSeqs[c] = nextConsSeq;
    state.totalConsumed++;

    // Schedule slot release — only after ALL consumers have consumed it
    const capturedSlot = slot;
    const requiredCount = state.numConsumers;
    setTimeout(() => {
      if (capturedSlot.consumedBy.size >= requiredCount) {
        capturedSlot.status = 'processed';
        setTimeout(() => {
          if (capturedSlot.status === 'processed') capturedSlot.status = 'empty';
        }, 180 + delay);
      }
    }, 60 + delay + Math.random() * 40);

    if (Math.random() < 0.025) {
      addLog('consumer',
        `C${c+1} <span class="cyan">broadcast</span>` +
        ` <span class="hi">${slot.eventType}</span>` +
        ` @ slot <span class="amber">[${idx}]</span>` +
        ` (${slot.consumedBy.size}/${state.numConsumers})`
      );
    }
  }
}

/**
 * Work Pool: consumers compete for each event.
 * Only ONE consumer processes each slot — whoever claims it first via CAS.
 *
 * Real-world use: three identical order-validation workers splitting load.
 * Consumer order is shuffled each tick to prevent starvation.
 */
function _tickWorkPoolConsumers(delay) {
  const n = state.bufSize;

  // Shuffle consumer order so no single consumer always wins the race
  const order = Array.from({ length: state.numConsumers }, (_, i) => i)
    .sort(() => Math.random() - 0.5);

  for (const c of order) {
    // Throttled consumer
    if (c === state.slowConsumer && state.tick % 8 !== 0) continue;

    const nextConsSeq = state.consumerSeqs[c] + 1;
    if (nextConsSeq > state.producerSeq) continue;

    const idx  = ((nextConsSeq % n) + n) % n;
    const slot = state.slots[idx];

    if (slot.publishedSeq !== nextConsSeq) continue;

    if (slot.claimedBy !== -1) {
      // Slot already claimed by another worker.
      // Advance our cursor past it so we don't stall behind the claimer.
      state.consumerSeqs[c] = nextConsSeq;
      continue;
    }

    // ── CAS claim ────────────────────────────────────
    slot.claimedBy       = c;
    slot.status          = 'consuming';
    state.consumerSeqs[c] = nextConsSeq;
    state.totalConsumed++;

    const capturedSlot = slot;
    setTimeout(() => {
      capturedSlot.status = 'processed';
      setTimeout(() => {
        if (capturedSlot.status === 'processed') capturedSlot.status = 'empty';
      }, 180 + delay);
    }, 60 + delay + Math.random() * 60);

    if (Math.random() < 0.04) {
      addLog('consumer',
        `C${c+1} <span class="amber">claimed</span>` +
        ` <span class="hi">${slot.eventType}</span>` +
        ` @ slot <span class="amber">[${idx}]</span>` +
        ` — others skip`
      );
    }
  }
}

// ── Latency EMA ───────────────────────────────────────

/**
 * Simulate latency as an exponential moving average.
 * The base value is determined by the selected wait strategy —
 * BusySpin (lowest) to Blocking (highest).
 */
function _tickLatency() {
  const base   = WS_LATENCY_BASE[state.waitStrategy] || 50;
  const target = base + Math.random() * 20;
  state.avgLatency = state.avgLatency * 0.9 + target * 0.1;
}
