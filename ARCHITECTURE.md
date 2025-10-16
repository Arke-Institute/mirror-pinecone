# Arke IPFS Mirror with Pinecone Architecture

## Overview

The Arke IPFS Mirror is a system that maintains a local replica of the Arke IPFS entity system and optionally indexes entities into Pinecone vector database for semantic search. The system is designed around the principle that **the `/events` API is the immutable source of truth**.

## Core Principle: Event Chain Immutability

**Key Insight:** The event chain at the `/events` API endpoint is append-only and never truncated. Events are never deleted when snapshots are created.

This fundamental property simplifies the architecture:
- Snapshots are convenience checkpoints for bulk synchronization
- JSONL files are local caches, not sources of truth
- Recovery always uses the `/events` API to catch up
- No special handling needed for snapshot refresh

## Architecture Components

### 1. Mirror Core

The mirror operates in two phases:

#### Phase 1: Bulk Sync (First Run)
```
GET /snapshot/latest
→ Returns current state of all entities
→ Stores event_cid as cursor for subsequent polling
```

**When to use snapshots:**
- `cursor_event_cid` is null (first time setup)
- Starting from scratch with no prior state

#### Phase 2: Continuous Polling
```
GET /events?limit=100&cursor={next_cursor}
→ Walk backwards from HEAD until finding known cursor
→ Append new events in chronological order
→ Update cursor to most recent event
```

**Exponential Backoff:**
- No updates detected → double backoff (30s to 600s max)
- Updates detected → reset to minimum backoff (30s)

### 2. State Management

The mirror maintains state in `mirror-state.json`:

```typescript
interface MirrorState {
  phase: 'not_started' | 'bulk_sync' | 'polling';
  cursor_event_cid: string | null;        // Mirror's position in event stream
  connected: boolean;
  backoff_seconds: number;
  last_poll_time: string | null;
  total_entities: number;
  pinecone?: {
    enabled: boolean;
    last_processed_event_cid: string | null;  // Pinecone's position in event stream
    processed_count: number;
    failed_count: number;
    skipped_count: number;
    last_processed_time: string | null;
    queue_size: number;
  };
}
```

### 3. Data Flow

```
┌─────────────────┐
│   /events API   │ ← Immutable source of truth
│  (append-only)  │    Never truncated
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│  Mirror Process │ ← Polls /events API
│  cursor_event_  │    Maintains cursor
│      cid        │
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│  mirror-data.   │ ← Local cache
│     jsonl       │    Contains events or snapshot data
└────────┬────────┘
         │
         ↓ (if Pinecone enabled)
┌─────────────────┐
│ Pinecone Queue  │ ← In-memory event queue
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│ Entity Fetcher  │ ← Fetches full entity from wrapper API
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│ Text Extractor  │ ← Extracts searchable text
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│ Embedding Gen   │ ← OpenAI text-embedding-3-large
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│ Pinecone Index  │ ← Vector storage (3072 dimensions)
│ last_processed_ │    Maintains separate checkpoint
│    event_cid    │
└─────────────────┘
```

## Pinecone Integration

### Dual Cursor System

The system maintains **two independent cursors**:

1. **Mirror Cursor** (`state.cursor_event_cid`)
   - Position in event stream for local JSONL
   - Updated immediately after polling `/events`
   - Represents what events have been cached locally

2. **Pinecone Cursor** (`state.pinecone.last_processed_event_cid`)
   - Position in event stream for Pinecone index
   - Updated only after successful embedding + upsert
   - Represents what events have been indexed

**Why two cursors?**
- Mirror is fast (just appending JSON)
- Pinecone is slow (fetch entity, extract text, generate embedding, upsert)
- Allows mirror to stay current while Pinecone catches up asynchronously

### Catch-up Logic

When the system restarts and Pinecone is behind the mirror:

```typescript
if (pinecone_cursor !== mirror_cursor && pinecone_cursor !== null) {
  // Walk /events API backwards to find gap
  const gapEvents = await getEventsGap(pinecone_cursor, mirror_cursor);

  // Queue events for processing
  pineconeQueue.push(...gapEvents);

  // Process asynchronously
  startPineconeProcessing();
}
```

**Key implementation details:**
1. Walk backwards from `mirror_cursor` (HEAD of known events)
2. Stop when finding `pinecone_cursor`
3. Reverse the collected events (to get chronological order)
4. Queue all gap events for processing

**Why this works:**
- `/events` API is immutable - events never disappear
- Can always walk backwards to find any checkpoint
- No risk of missing events between cursors

### Processing Pipeline

```
Event → Fetch Entity → Extract Text → Filter → Batch → Embed → Upsert
  ↓         ↓             ↓             ↓        ↓       ↓        ↓
Queue    GET /pi/{id}   namespace   skip if    100    OpenAI  Pinecone
                         text      no text    items   API      API
```

**Batching Strategy:**
- Target 100 items with text per batch
- Skip entities without searchable text
- Process batches asynchronously
- Update checkpoint only after successful upsert

**Text Extraction:**
```typescript
namespace → field with searchable text
fileUnit → description
collection → scopeAndContent
person → bioghist
digitalObject → techmd (technical metadata)
```

**Embedding:**
- Model: `text-embedding-3-large`
- Dimensions: 3072
- Max input: 20,000 characters (truncated if longer)

**Pinecone Namespaces:**
Entities are organized by namespace for filtered search:
- `fileUnit`
- `collection`
- `person`
- `digitalObject`
- etc.

### Recovery Scenarios

#### Scenario 1: Clean Restart (Both Cursors Match)
```
mirror_cursor:   event_123
pinecone_cursor: event_123
→ No action needed, system is synchronized
```

#### Scenario 2: Pinecone Behind
```
mirror_cursor:   event_200
pinecone_cursor: event_150
→ Use /events API to fetch events 151-200
→ Queue for Pinecone processing
```

#### Scenario 3: First Time Pinecone Setup
```
mirror_cursor:   event_200
pinecone_cursor: null
→ Read all entities from JSONL (snapshot data)
→ Queue entire dataset for indexing
```

#### Scenario 4: Mirror and Pinecone Both Fresh
```
mirror_cursor:   null
pinecone_cursor: null
→ Bulk sync from /snapshot/latest
→ Queue snapshot entities for indexing
```

## Data Integrity Guarantees

### No Data Loss

Events occurring between polls are always captured:

```
Poll 1 (T0):  cursor = event_100
  ↓
New events:   event_101, event_102, event_103 created
  ↓
Poll 2 (T1):  Walk /events backwards from HEAD
              Find events 101, 102, 103
              cursor = event_103
```

**Result:** All events are processed; no gaps in the event stream.

### Checkpoint Continuity

The cursor always points to the last event integrated:

```
Initial:     cursor = snapshot.event_cid (e.g., event #1000)
Poll 1:      Finds events #1001-1005 → cursor = event #1005
Poll 2:      Finds events #1006-1010 → cursor = event #1010
Restart:     Resumes from cursor = event #1010
Poll 3:      Finds events #1011-1015 → cursor = event #1015
```

**Guarantee:** The cursor always represents the last successfully integrated event.

### Idempotent Operations

All operations are safe to retry:

- **Mirror:** Appending the same event twice just duplicates a line in JSONL (harmless)
- **Pinecone:** Upserts are idempotent (updates existing vectors)
- **Cursor updates:** Atomic writes to state file

## Performance Characteristics

### Network Efficiency

**Polling (when no updates):**
- Request: GET /events?limit=100
- Response: ~5 KB (empty items array)
- Time: ~50-100ms
- Frequency: 30s to 600s (exponential backoff)

**Polling (with updates):**
- Request: GET /events?limit=100
- Response: ~50 KB per 100 events
- Time: ~100-200ms per page
- Pagination: Automatic if more than 100 events

**Pinecone Processing:**
- Entity fetch: ~100-200ms per entity
- Text extraction: <1ms (in-memory)
- Embedding generation: ~200-500ms per batch of 100 items
- Pinecone upsert: ~500-1000ms per batch of 100 vectors

### Storage Efficiency

**Mirror JSONL:**
- ~300 bytes per event (with metadata)
- 10,000 events = ~3 MB
- Grows linearly with event count (not entity count)

**Pinecone Index:**
- ~12 KB per vector (3072 dimensions × 4 bytes)
- 10,000 entities = ~120 MB in Pinecone
- Plus metadata (namespace, pi, ver, etc.)

## Configuration

### Environment Variables

```bash
# API endpoints
BACKEND_API_URL=http://localhost:3000   # Events and snapshots
WRAPPER_API_URL=http://localhost:8787   # Entity CRUD

# Pinecone
PINECONE_ENABLED=true                   # Enable Pinecone integration
PINECONE_API_KEY=xxx                     # Pinecone API key
PINECONE_ENVIRONMENT=us-east-1          # Pinecone environment
PINECONE_INDEX=arke-institute           # Index name

# OpenAI
OPENAI_API_KEY=xxx                       # For embeddings

# Storage paths
STATE_FILE_PATH=/data/mirror-state.json
DATA_FILE_PATH=/data/mirror-data.jsonl
```

### Backoff Parameters

```typescript
private minBackoff = 30;        // 30 seconds
private maxBackoff = 600;       // 10 minutes
```

### Batch Parameters

```typescript
private batchSize = 100;        // Target batch size
private maxTextLength = 20000;  // Max chars for embedding
```

## Monitoring

### Key Metrics

**Mirror Health:**
```bash
cat mirror-state.json | jq '{
  phase,
  cursor: .cursor_event_cid[:10],
  backoff: .backoff_seconds,
  last_poll: .last_poll_time
}'
```

**Pinecone Health:**
```bash
cat mirror-state.json | jq '.pinecone | {
  cursor: .last_processed_event_cid[:10],
  processed: .processed_count,
  skipped: .skipped_count,
  failed: .failed_count,
  queue: .queue_size
}'
```

**Gap Detection:**
```bash
# If cursors differ, system is catching up
cat mirror-state.json | jq '{
  mirror: .cursor_event_cid[:10],
  pinecone: .pinecone.last_processed_event_cid[:10],
  queue: .pinecone.queue_size
}'
```

### Log Monitoring

**Successful Poll:**
```
[2025-10-16T02:11:58.929Z] Polling for updates...
  ✓ Found cursor at event CID: bafyreig...
  No updates, backing off to 60s
```

**Updates Found:**
```
Adding 10 new events:
  create: 01K7NCJBZK... (v1) - bafyreig...
  Found 10 updates, resetting backoff
```

**Catch-up in Progress:**
```
Pinecone behind mirror cursor, catching up via /events API...
  Last processed: bafyreif...
  Current cursor: bafyreig...
  Walking /events API from bafyreig... back to bafyreif...
  ✓ Found checkpoint at event CID: bafyreif...
  Found 135 events to catch up (2 API calls)
Queueing 135 events for Pinecone processing...
```

**Batch Processing:**
```
[Pinecone] Processing batch (targeting 100 items with text)...
  [OK] 01K7NCBP8B... - 20000 chars, ns: digitalObject
  [SKIP] 01K7NCDNKG... - no text
  Generating embeddings for 10 items...
  [UPSERT] 6 vectors to digitalObject
  [UPSERT] 4 vectors to fileUnit
[Pinecone] Batch complete: 10 items upserted, 135 skipped, 0 failed
[Pinecone] Queue remaining: 0 events
```

## Testing the Catch-up Logic

To verify the catch-up logic works:

1. **Edit state file** to create a gap:
   ```bash
   # Manually set Pinecone cursor to older event
   jq '.pinecone.last_processed_event_cid = "bafyreif..."' mirror-state.json > tmp.json
   mv tmp.json mirror-state.json
   ```

2. **Restart mirror:**
   ```bash
   npm start
   ```

3. **Observe catch-up:**
   ```
   Pinecone behind mirror cursor, catching up via /events API...
   Walking /events API from X back to Y...
   ✓ Found checkpoint at event CID: ...
   Found N events to catch up
   Queueing N events for Pinecone processing...
   ```

4. **Verify completion:**
   ```bash
   # Check cursors match after processing
   cat mirror-state.json | jq '{
     mirror: .cursor_event_cid,
     pinecone: .pinecone.last_processed_event_cid,
     queue: .pinecone.queue_size
   }'
   ```

## Design Decisions

### Why Not Rely on JSONL for Catch-up?

**Problem:** After snapshot refresh, JSONL contains `EntityEntry` objects (just `pi`, `ver`, `tip_cid`) not `Event` objects (with `event_cid`, `type`, `ts`).

**Solution:** Always use `/events` API for catch-up when `pinecone_cursor` is non-null.

### Why Not Use Snapshot for Catch-up?

**Problem:** Snapshots are deduplicated current state. If Pinecone checkpoint points to `event_cid` that was part of an update series, that specific event won't exist in the snapshot (only the latest version will).

**Solution:** Only use snapshot when `pinecone_cursor` is null (first time setup).

### Why Two Separate Cursors?

**Alternatives Considered:**
1. **Single cursor:** Pinecone must process before mirror advances
   - ❌ Slow: Mirror blocked by Pinecone processing
   - ❌ Complex: Requires synchronous processing

2. **No cursor for Pinecone:** Always read from JSONL
   - ❌ Inefficient: Re-processes same events on every restart
   - ❌ Fragile: JSONL structure changes after snapshot refresh

**Chosen Approach:**
3. **Dual cursors:** Independent advancement
   - ✅ Fast: Mirror stays current regardless of Pinecone
   - ✅ Reliable: Can always catch up via `/events` API
   - ✅ Simple: Clear separation of concerns

## Future Optimizations

### Optional: Snapshot Refresh for JSONL Compaction

The JSONL file grows linearly with events. For long-running mirrors, periodic compaction via snapshot refresh could reduce file size:

```
Without refresh:
  Initial: 100 entities (100 lines)
  After 1 month: 100 entities + 10,000 updates = 10,100 lines

With periodic refresh (every 12h):
  Always: ~100 entities + updates since last refresh = 100-200 lines
```

**Implementation:**
- Check `/snapshot/latest` headers (`x-snapshot-seq`)
- If newer than `last_snapshot_seq`:
  - Download snapshot
  - Truncate JSONL
  - Write current state
  - Update cursor
  - Continue polling

**Note:** This is purely an optimization for JSONL file size. Not required for correctness since `/events` API is the source of truth.

## Summary

The Arke IPFS Mirror with Pinecone is designed around a simple principle: **the `/events` API is the immutable source of truth**. This enables:

✅ **Reliable catch-up** - Walk backwards in event chain to find any checkpoint
✅ **No data loss** - Events never disappear, always available
✅ **Simple recovery** - Just use `/events` API to fill gaps
✅ **Asynchronous processing** - Mirror and Pinecone advance independently
✅ **Efficient polling** - Exponential backoff when idle
✅ **Idempotent operations** - Safe to retry any operation

This architecture makes the system resilient to crashes, network failures, and long downtimes, while maintaining data integrity and semantic search capabilities.
