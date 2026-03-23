/**
 * state.js
 *
 * Single source of truth for the simulation.
 * All modules read from and write to this object.
 *
 * Slot lifecycle (status field):
 *   empty  →  published  →  consuming  →  processed  →  empty
 *                ↓ (if buffer full)
 *           backpressure  (producer blocked)
 */

const state = {

  // ── Simulation lifecycle ──────────────────────────
  running: false,

  // ── Configuration (mirrored from UI controls) ────
  bufSize:      64,          // ring buffer capacity (must stay power-of-two)
  numProducers: 1,
  numConsumers: 3,
  publishRate:  40,          // arbitrary units; divided by tick rate to get pubs/tick
  waitStrategy: 'BusySpin',
  topology:     'broadcast', // 'broadcast' | 'workpool'

  // ── Sequence cursors ──────────────────────────────
  producerSeq:  -1,  // global sequence of the last published event
  consumerSeqs: [],  // per-consumer sequence cursor (index = consumer id)

  // ── Ring buffer slots ─────────────────────────────
  // Populated by initSlots(). Each slot object:
  //   { status, publishedBy, claimedBy, consumedBy, publishedSeq, age, eventType }
  slots: [],

  // ── Live statistics ───────────────────────────────
  totalPublished:    0,
  totalConsumed:     0,
  wraps:             0,   // how many times the ring has cycled
  throughputAccum:   0,   // events published since last display refresh
  throughputDisplay: 0,   // events/sec shown in the UI
  tLastThroughput:   performance.now(),
  avgLatency:        50,  // exponential-moving-average of simulated latency (ns)

  // ── Backpressure / stall tracking ────────────────
  isStalled:         false,
  stalledSinceTick:  -1,
  totalStallEvents:  0,   // how many times the producer has been blocked
  totalStalledTicks: 0,   // total ticks spent in a stall
  bottleneckConsumer: -1, // index of the slowest consumer during a stall

  // ── Slow-consumer injection (for demos) ──────────
  slowConsumer: -1,       // consumer index to throttle; -1 = none

  // ── Internal ─────────────────────────────────────
  tick: 0,
};

/**
 * initSlots()
 *
 * Allocates (or reallocates) the ring buffer and resets all
 * sequence cursors and counters. Call on startup and on reset.
 */
function initSlots() {
  state.slots = Array.from({ length: state.bufSize }, () => ({
    status:       'empty',

    publishedBy:  -1,        // which producer wrote this slot
    claimedBy:    -1,        // work-pool only: which consumer claimed it
    consumedBy:   new Set(), // broadcast: set of consumer ids that have read it
    publishedSeq: -1,        // sequence number stamped when published
                             //   → used to guard against stale reads after a wrap

    age:          0,
    eventType:    null,      // e.g. 'TRADE', 'ORDER' — set at publish time
  }));

  state.producerSeq  = -1;
  state.consumerSeqs = Array.from({ length: state.numConsumers }, () => -1);

  state.totalPublished    = 0;
  state.totalConsumed     = 0;
  state.wraps             = 0;
  state.isStalled         = false;
  state.stalledSinceTick  = -1;
  state.totalStallEvents  = 0;
  state.totalStalledTicks = 0;
  state.bottleneckConsumer = -1;
}
