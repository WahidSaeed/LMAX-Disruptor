/**
 * constants.js
 *
 * Read-only lookup tables shared across all modules.
 * No simulation logic lives here.
 */

// ── Wait strategy descriptions ────────────────────────
// Shown in the UI when a strategy is selected.
const WS_DESC = {
  BusySpin: 'CPU spin-loop; max throughput, 100% core usage',
  Yielding: 'Thread.yield() between checks; less CPU, slight latency',
  Sleeping: 'LockSupport.parkNanos(1); balanced latency/CPU trade-off',
  Blocking: 'Conditional wait; low CPU, higher latency variance',
  LiteSpin: 'Reduced spin count; compromise between BusySpin and Yielding',
};

// ── Wait strategy → simulated base latency (nanoseconds) ─
// Used by the simulation to weight the avg-latency readout.
const WS_LATENCY_BASE = {
  BusySpin:  35,
  LiteSpin:  55,
  Yielding:  90,
  Sleeping: 150,
  Blocking: 280,
};

// ── Wait strategy → consumer tick delay multiplier ───────
// Each unit adds 50ms to a consumer's processing timeout,
// simulating slower wake-up under less aggressive strategies.
const WS_DELAY_MULT = {
  BusySpin: 0,
  LiteSpin: 1,
  Yielding: 2,
  Sleeping: 3,
  Blocking: 4,
};

// ── Topology descriptions ─────────────────────────────
const TOPO_DESC = {
  broadcast: 'All consumers read every event — parallel pipeline handlers',
  workpool:  'Consumers compete for events — each event processed by exactly one worker',
};

// ── Simulated financial event types ──────────────────
const EVENT_TYPES = ['TRADE', 'ORDER', 'PRICE', 'BOOK', 'EXEC', 'RISK', 'MATCH', 'CLEAR'];

// ── Canvas slot colours by status ────────────────────
const SLOT_COLORS = {
  empty:        { fill: '#0f1a0f', stroke: '#1a2e1a' },
  published:    { fill: '#002233', stroke: '#005577' },
  consuming:    { fill: '#003355', stroke: '#00aabb' },
  processed:    { fill: '#0d3a0d', stroke: '#1a6b1a' },
  backpressure: { fill: '#3a0a0a', stroke: '#882222' },
};

// Producer badge colours (one per producer, up to 4)
const PRODUCER_COLORS = ['#39ff14', '#aaff00', '#00ff88', '#66ff33'];

// Consumer badge colours (one per consumer, up to 6)
const CONSUMER_COLORS = ['#00e5ff', '#00bcd4', '#4dd0e1', '#80deea', '#b2ebf2', '#e0f7fa'];
