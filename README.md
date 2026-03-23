# LMAX Disruptor — Terminal Simulation

A browser-based, terminal-themed visualisation of the **LMAX Disruptor** pattern — the lock-free, ultra-low-latency inter-thread messaging library used in high-frequency trading systems.

[LMAX Disruptor Live Demo]([https://lmax-exchange.github.io/disruptor/disruptor.html](https://wahidsaeed.github.io/LMAX-Disruptor/))

---

## What is the LMAX Disruptor?

The Disruptor is a data structure and concurrency pattern developed by LMAX Exchange (2011) that replaces traditional queues for passing events between threads. Instead of a linked-list queue with locks, it uses a **fixed-size circular ring buffer** pre-allocated in a single contiguous block of memory.

Why it's fast:
- **Zero allocation** in the hot path — event objects are pre-created and reused forever
- **Cache-friendly** — contiguous memory means the CPU prefetcher loads the next slot before you need it
- **Lock-free** — producers and consumers coordinate purely via sequence numbers (no mutexes)
- **Back-pressure by design** — a full buffer stalls the producer instead of growing unboundedly

---

## File Structure

```
lmax-disruptor/
│
├── index.html          # HTML structure — layout, panels, controls
├── style.css           # All styles — design tokens, layout, components
│
└── js/
    ├── constants.js    # Read-only lookup tables (colours, descriptions, event types)
    ├── state.js        # Single source of truth — the `state` object + initSlots()
    ├── renderer.js     # Canvas drawing — ring, producers, consumers, stall overlay
    ├── simulation.js   # Tick logic — producer publish, consumer advance, latency EMA
    ├── ui.js           # DOM updates, terminal log, sim lifecycle (start/stop/reset)
    └── controls.js     # Event listeners for all UI controls + boot sequence
```

### Script load order

Scripts are loaded in dependency order at the bottom of `index.html`:

```
constants → state → renderer → simulation → ui → controls
```

Each file only uses globals defined by files loaded before it.

---

## Concepts Simulated

### Ring Buffer

A fixed-size circular array. Slots are indexed as:

```
slotIndex = sequence & (bufferSize - 1)   // fast bitwise AND (power-of-two size)
```

Each slot is pre-allocated and reused on every lap. The producer stamps a `publishedSeq` on each slot so consumers can verify they're reading the right lap.

### Slot Lifecycle

```
empty → published → consuming → processed → empty
           ↓ (buffer full)
       backpressure   ← producer blocked here
```

### Back-pressure

The producer checks before every publish:

```
nextProducerSeq - slowestConsumerSeq >= bufferSize  →  BLOCK
```

The producer spins (or yields/parks, depending on wait strategy) until the slowest consumer advances. **No events are dropped. No queue grows.**

### Topology: Broadcast vs Work Pool

| Mode | Behaviour | Use case |
|------|-----------|----------|
| **Broadcast** | Every consumer reads every event independently | Journal + Replication + Business Logic handlers all see every trade |
| **Work Pool** | Consumers compete — one slot goes to exactly one consumer | N identical validation workers splitting load |

In Broadcast mode, a slot is only freed once **all** consumers have consumed it — the slowest one gates the producer.

### Wait Strategies

| Strategy | Mechanism | CPU | Latency |
|----------|-----------|-----|---------|
| BusySpin | Spin loop | 100% | Lowest |
| LiteSpin | Reduced spin count | High | Low |
| Yielding | `Thread.yield()` | Medium | Medium |
| Sleeping | `LockSupport.parkNanos(1)` | Low | Higher |
| Blocking | Conditional lock wait | Minimal | Highest |

---

## Controls Reference

| Control | Description |
|---------|-------------|
| **PRODUCERS** (1–4) | Number of concurrent publishers writing to the ring |
| **CONSUMERS** (1–6) | Number of concurrent handlers reading from the ring |
| **PUB RATE** (1–100) | Relative publish rate; higher = more events per tick |
| **BUF SIZE** | Ring buffer capacity (64 / 128 / 256 / 512 — must be power-of-two) |
| **Topology** | Broadcast (all read all) vs Work Pool (compete per slot) |
| **Wait Strategy** | Consumer wait mechanism — affects latency and CPU usage |
| **▶ START** | Begin the simulation loop (50ms tick interval) |
| **■ STOP** | Pause the simulation |
| **↺ RESET** | Stop and reinitialise all sequences and slot states |
| **⚡ BURST** | Temporarily pin publish rate to max for 2 seconds |
| **SLOW C** | Throttle one consumer to 1/8 speed to trigger backpressure |

---

## How to Run

No build step required. Open `index.html` directly in any modern browser:

```bash
# Option 1: open directly
open index.html

# Option 2: local dev server (avoids any CORS issues)
npx serve .
# or
python3 -m http.server 8080
```

---

## Demonstrating Back-pressure

1. Set **BUF SIZE** to `64`
2. Set **PUB RATE** to `80`
3. Press **▶ START**
4. Under **SLOW C**, select **C1**

C1 will now process events at 1/8 speed. Within a few seconds the buffer fills, the producer stalls, and you'll see:
- The ring turn red with a pulsing **⛔ PRODUCER STALLED** banner
- The bottleneck consumer badge glow red with an expanding halo
- The header status switch to **STALLED**
- The log stream identify C1 as the bottleneck and report the sequence gap

Set **SLOW C** back to **OFF** to watch the stall resolve as C1 catches up.

---

## References

- [LMAX Disruptor technical paper](https://lmax-exchange.github.io/disruptor/disruptor.html)
- [Disruptor GitHub repository](https://github.com/LMAX-Exchange/disruptor)
- [Martin Fowler — LMAX Architecture](https://martinfowler.com/articles/lmax.html)
- [Mechanical Sympathy blog](https://mechanical-sympathy.blogspot.com/)
