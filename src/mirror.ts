import 'dotenv/config';
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ArkeClient } from './services/arke-client.js';
import { OpenAIClient } from './services/openai-client.js';
import { PineconeClient } from './services/pinecone-client.js';
import { ParentResolver } from './services/parent-resolver.js';
import { loadConfig } from './adapters/pinax/config.js';
import { extractText } from './adapters/pinax/field-extractor.js';
import { extractMetadata } from './adapters/pinax/metadata-extractor.js';
import { getNamespace } from './adapters/pinax/namespace-resolver.js';
import type { PinaxMetadata } from './adapters/pinax/field-extractor.js';
import type { PineconeVector } from './services/pinecone-client.js';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Types
interface EntityEntry {
  pi: string;
  ver: number;
  tip_cid: string;
}

interface SnapshotResponse {
  schema: string;
  seq: number;
  ts: string;
  event_cid: string;
  total_count: number;
  prev_snapshot?: { '/': string };
  entries: EntityEntry[];
  snapshot_time?: string; // Legacy field, may not be present
}

interface EntitiesResponse {
  items: EntityEntry[];
  has_more: boolean;
  next_cursor?: string;
}

interface Event {
  event_cid: string;
  type: 'create' | 'update';
  pi: string;
  ver: number;
  tip_cid: string;
  ts: string;
}

interface EventsResponse {
  items: Event[];
  total_events: number;
  total_pis: number;
  has_more: boolean;
  next_cursor?: string;
}

interface MirrorState {
  phase: 'not_started' | 'bulk_sync' | 'polling';
  cursor_event_cid: string | null; // Most recent event CID we've seen
  connected: boolean;
  backoff_seconds: number;
  last_poll_time: string | null;
  total_entities: number;

  // Pinecone integration (optional)
  pinecone?: {
    enabled: boolean;
    last_processed_event_cid: string | null;  // Checkpoint in event stream
    processed_count: number;                   // Total vectors upserted
    failed_count: number;                      // Total failures
    skipped_count: number;                     // Entities with no text
    last_processed_time: string | null;        // ISO timestamp
    queue_size: number;                        // Current queue size
  };
}

interface ProcessingItem {
  pi: string;
  text: string;
  namespace: string;
  metadata: Record<string, any>;
}

class ArkeIPFSMirror {
  private backendApiUrl: string;  // Backend API (port 3000) - events, snapshots
  private arkeApiUrl: string;      // Wrapper API (port 8787) - entity CRUD
  private state: MirrorState;
  private stateFilePath: string;
  private dataFilePath: string;
  private minBackoff = 30;
  private maxBackoff = 600;

  // Pinecone integration fields
  private pineconeEnabled: boolean;
  private pineconeQueue: Event[] = [];
  private pineconeProcessing: boolean = false;
  private maxQueueSize: number = 100;
  private lastPineconeProcessTime: number = 0;
  private shouldStopPolling: boolean = false;

  private arkeClient?: ArkeClient;
  private openaiClient?: OpenAIClient;
  private pineconeClient?: PineconeClient;
  private parentResolver?: ParentResolver;
  private pinaxConfig?: any;

  constructor(backendApiUrl: string, arkeApiUrl: string, stateFilePath?: string, dataFilePath?: string) {
    this.backendApiUrl = backendApiUrl;
    this.arkeApiUrl = arkeApiUrl;
    this.stateFilePath = stateFilePath || join(dirname(__dirname), 'mirror-state.json');
    this.dataFilePath = dataFilePath || join(dirname(__dirname), 'mirror-data.jsonl');
    this.state = this.loadState();

    // Initialize Pinecone settings from environment
    this.pineconeEnabled = process.env.ENABLE_PINECONE === 'true';

    if (this.pineconeEnabled) {
      console.log('Pinecone integration enabled');
    }
  }

  private loadState(): MirrorState {
    if (existsSync(this.stateFilePath)) {
      try {
        const data = readFileSync(this.stateFilePath, 'utf-8');
        return JSON.parse(data);
      } catch (error) {
        console.error('Error loading state file, starting fresh:', error);
      }
    }

    return {
      phase: 'not_started',
      cursor_event_cid: null,
      connected: false,
      backoff_seconds: this.minBackoff,
      last_poll_time: null,
      total_entities: 0,
    };
  }

  private saveState(): void {
    try {
      writeFileSync(this.stateFilePath, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (error) {
      console.error('Error saving state:', error);
    }
  }

  private async initializePinecone(): Promise<void> {
    console.log('Initializing Pinecone integration...');

    // Get configuration
    const configPath = process.env.CONFIG_PATH || './config/pinax-config.json';
    const openaiKey = process.env.OPENAI_API_KEY;
    const pineconeKey = process.env.PINECONE_API_KEY;

    if (!openaiKey) {
      throw new Error('OPENAI_API_KEY environment variable required for Pinecone integration');
    }
    if (!pineconeKey) {
      throw new Error('PINECONE_API_KEY environment variable required for Pinecone integration');
    }

    // Load config
    console.log('Loading PINAX config from: ' + configPath);
    this.pinaxConfig = loadConfig(configPath);

    // Initialize services (use wrapper API for entity operations)
    this.arkeClient = new ArkeClient(this.arkeApiUrl);
    this.openaiClient = new OpenAIClient(
      openaiKey,
      this.pinaxConfig.embedding_model,
      this.pinaxConfig.embedding_dimensions
    );
    const indexName = process.env.PINECONE_INDEX_NAME || 'arke-institute';
    this.pineconeClient = new PineconeClient(
      pineconeKey,
      indexName,
      this.pinaxConfig.embedding_dimensions
    );
    this.parentResolver = new ParentResolver(this.arkeClient);

    // Ensure index exists
    console.log('Ensuring Pinecone index exists...');
    await this.pineconeClient.ensureIndex();

    // Initialize state if first time
    if (!this.state.pinecone) {
      this.state.pinecone = {
        enabled: true,
        last_processed_event_cid: null,
        processed_count: 0,
        failed_count: 0,
        skipped_count: 0,
        last_processed_time: null,
        queue_size: 0
      };
      this.saveState();
    }

    console.log('Pinecone initialization complete');

    // Backfill if needed
    await this.backfillPinecone();
  }

  private async backfillPinecone(): Promise<void> {
    if (!this.state.pinecone) {
      return;
    }

    if (this.state.pinecone.last_processed_event_cid) {
      // Already initialized - check if we need to catch up using /events API
      const lastProcessed = this.state.pinecone.last_processed_event_cid;
      const currentCursor = this.state.cursor_event_cid;

      if (lastProcessed !== currentCursor) {
        console.log('Pinecone behind mirror cursor, catching up via /events API...');
        console.log(`  Last processed: ${lastProcessed}`);
        console.log(`  Current cursor: ${currentCursor}`);

        try {
          // Walk backwards from current cursor to find the gap
          const gapEvents = await this.getEventsGap(lastProcessed, currentCursor);

          if (gapEvents.length > 0) {
            console.log(`Queueing ${gapEvents.length} events for Pinecone processing...`);
            this.pineconeQueue.push(...gapEvents);
            this.state.pinecone.queue_size = this.pineconeQueue.length;
            this.saveState();

            // Start processing
            this.startPineconeProcessing();
          } else {
            console.log('No gap events found - already up to date');
          }
        } catch (error) {
          console.error('Failed to catch up via /events API:', error);
          console.error('Pinecone will remain at checkpoint and catch up as new events arrive');
        }
      } else {
        console.log('Pinecone checkpoint matches mirror cursor - up to date');
      }
      return;
    }

    // First time: Read entire JSONL and queue everything (snapshot data)
    console.log('First time Pinecone setup - reading all historical data from snapshot...');

    if (!existsSync(this.dataFilePath)) {
      console.log('No historical data file found, starting fresh');
      return;
    }

    const allEvents = this.readAllEventsFromJSONL();
    console.log(`Found ${allEvents.length} entities to index from snapshot`);

    this.pineconeQueue.push(...allEvents);
    this.state.pinecone.queue_size = this.pineconeQueue.length;
    this.saveState();

    // Start processing
    this.startPineconeProcessing();
  }

  private readAllEventsFromJSONL(): Event[] {
    const content = readFileSync(this.dataFilePath, 'utf-8');
    const lines = content.trim().split('\n');

    return lines
      .filter(line => line.trim())
      .map(line => {
        const data = JSON.parse(line);
        // Convert EntityEntry to Event format if needed
        if (!data.type) {
          return {
            pi: data.pi,
            ver: data.ver,
            tip_cid: data.tip_cid,
            type: 'create' as const,
            ts: data.ts || new Date().toISOString(),
            event_cid: data.tip_cid // Best guess
          };
        }
        return data as Event;
      });
  }

  private appendData(data: EntityEntry | Event): void {
    try {
      appendFileSync(this.dataFilePath, JSON.stringify(data) + '\n', 'utf-8');
    } catch (error) {
      console.error('Error appending data:', error);
      throw error;
    }

    // Add to Pinecone queue if enabled
    if (this.pineconeEnabled) {
      const event = this.toEvent(data);
      this.pineconeQueue.push(event);

      // Trigger processing if queue is full
      if (this.pineconeQueue.length >= this.maxQueueSize) {
        console.log(`Pinecone queue full (${this.pineconeQueue.length}), triggering batch`);
        this.startPineconeProcessing();
      }
    }
  }

  private toEvent(data: EntityEntry | Event): Event {
    if ('type' in data) {
      return data as Event;
    }

    // Convert EntityEntry to Event
    return {
      pi: data.pi,
      ver: data.ver,
      tip_cid: data.tip_cid,
      type: 'create',
      ts: new Date().toISOString(),
      event_cid: data.tip_cid
    };
  }

  private startPineconeProcessing(): void {
    if (this.pineconeProcessing) {
      console.log('Pinecone processing already running, skipping...');
      return;
    }

    if (this.pineconeQueue.length === 0) {
      return;
    }

    // Fire and forget (don't await)
    this.processPineconeQueue().catch(error => {
      console.error('Pinecone processing error:', error);
      this.pineconeProcessing = false;
    });
  }

  private async processPineconeQueue(): Promise<void> {
    this.pineconeProcessing = true;

    try {
      while (this.pineconeQueue.length > 0) {
        console.log(`\n[Pinecone] Processing batch (targeting 100 items with text)...`);

        try {
          // Keep processing events until we have 100 items with text or run out of queue
          const result = await this.processPineconeBatch();

          console.log(`[Pinecone] Batch complete: ${result.processed} items upserted, ${result.skipped} skipped, ${result.failed} failed`);
        } catch (error) {
          console.error('[Pinecone] Batch processing failed:', error);
        }

        // Update state
        if (this.state.pinecone) {
          this.state.pinecone.queue_size = this.pineconeQueue.length;
        }
        this.saveState();

        console.log(`[Pinecone] Queue remaining: ${this.pineconeQueue.length} events`);
      }
    } finally {
      this.pineconeProcessing = false;
      this.lastPineconeProcessTime = Date.now();
    }
  }

  private async processPineconeBatch(): Promise<{ processed: number; skipped: number; failed: number }> {
    const items: ProcessingItem[] = [];
    const targetBatchSize = 100;
    let skipped = 0;
    let failed = 0;
    let lastEventCid: string | null = null;

    // Keep pulling from queue until we have 100 items with text, or queue is empty
    while (items.length < targetBatchSize && this.pineconeQueue.length > 0) {
      const event = this.pineconeQueue.shift()!;
      lastEventCid = event.event_cid;

      try {
        // Fetch entity + pinax.json + description.md
        const { manifest, pinax, description } = await this.arkeClient!.getEntityWithPinax(event.pi);

        // Type assertion for PINAX metadata
        const pinaxData = pinax as PinaxMetadata;

        // Extract namespace from institution (not entity type)
        const namespace = getNamespace(pinaxData.institution);

        // Extract text for embedding
        const text = extractText(pinaxData, description, this.pinaxConfig!);

        // Skip if no text
        if (!text || text.trim().length === 0) {
          console.log(`  [SKIP] ${event.pi} - no text`);
          skipped++;
          if (this.state.pinecone) {
            this.state.pinecone.skipped_count++;
          }
          continue;
        }

        // Get parent ancestry
        const ancestry = await this.parentResolver!.getAncestry(event.pi);

        // Extract metadata
        const metadata = extractMetadata(pinaxData, manifest, ancestry);

        items.push({ pi: event.pi, text, namespace, metadata });

        console.log(`  [OK] ${event.pi} - ${text.length} chars, ns: ${namespace}, institution: ${pinaxData.institution}`);
      } catch (error) {
        console.error(`  [FAIL] ${event.pi} -`, error);
        failed++;
        if (this.state.pinecone) {
          this.state.pinecone.failed_count++;
        }
      }
    }

    // Skip if no items
    if (items.length === 0) {
      console.log('  No items with text in this batch');
      return { processed: 0, skipped, failed };
    }

    // Generate embeddings
    console.log(`  Generating embeddings for ${items.length} items...`);
    const texts = items.map(item => item.text);
    const embeddings = await this.openaiClient!.createEmbeddings(texts);

    // Group by namespace
    const byNamespace: Record<string, { item: ProcessingItem; embedding: number[] }[]> = {};
    items.forEach((item, idx) => {
      if (!byNamespace[item.namespace]) {
        byNamespace[item.namespace] = [];
      }
      byNamespace[item.namespace].push({ item, embedding: embeddings[idx] });
    });

    // Upsert to Pinecone
    let totalUpserted = 0;
    for (const [namespace, namespaceItems] of Object.entries(byNamespace)) {
      const vectors: PineconeVector[] = namespaceItems.map(({ item, embedding }) => ({
        id: item.pi,
        values: embedding,
        metadata: item.metadata
      }));

      await this.pineconeClient!.upsert(namespace, vectors);
      totalUpserted += vectors.length;
      if (this.state.pinecone) {
        this.state.pinecone.processed_count += vectors.length;
      }
      console.log(`  [UPSERT] ${vectors.length} vectors to ${namespace}`);
    }

    // Update checkpoint (last event processed)
    if (lastEventCid && this.state.pinecone) {
      this.state.pinecone.last_processed_event_cid = lastEventCid;
      this.state.pinecone.last_processed_time = new Date().toISOString();
    }

    return { processed: totalUpserted, skipped, failed };
  }

  // Phase 1: Bulk Sync
  private async bulkSync(): Promise<void> {
    console.log('=== Phase 1: Bulk Sync ===');
    console.log('Downloading snapshot...');

    try {
      const response = await fetch(`${this.backendApiUrl}/snapshot/latest`);

      if (response.status === 404) {
        console.log('No snapshot exists yet - system is new');
        console.log('Skipping to polling phase');
        this.state.phase = 'polling';
        this.state.connected = true;
        this.saveState();
        return;
      }

      if (!response.ok) {
        throw new Error(`Snapshot fetch failed: ${response.status}`);
      }

      const snapshot = await response.json() as SnapshotResponse;

      console.log(`Snapshot metadata:`);
      console.log(`  - Time: ${snapshot.ts}`);
      console.log(`  - Sequence: ${snapshot.seq}`);
      console.log(`  - Event CID: ${snapshot.event_cid}`);
      console.log(`  - Total entities: ${snapshot.total_count}`);

      // Append entities from snapshot to data file
      for (const entry of snapshot.entries) {
        this.appendData(entry);
        console.log(`  Loaded: ${entry.pi} (v${entry.ver})`);
      }

      // Set cursor to snapshot's event_cid (checkpoint in event stream)
      this.state.cursor_event_cid = snapshot.event_cid;

      this.state.total_entities = snapshot.total_count;
      this.state.phase = 'polling';
      this.state.connected = true;
      this.saveState();

      console.log(`\nBulk sync complete: ${this.state.total_entities} entities loaded`);
    } catch (error) {
      console.error('Bulk sync failed:', error);
      throw error;
    }
  }

  // Unified sync: Walk backwards from HEAD until finding cursor
  private async syncFromCursor(): Promise<{ updates: number }> {
    const cursor_event_cid = this.state.cursor_event_cid;
    let apiCursor: string | undefined = undefined;
    const newEvents: Event[] = [];
    let pollCount = 0;

    try {
      while (true) {
        pollCount++;
        let url = `${this.backendApiUrl}/events?limit=100`;
        if (apiCursor) {
          url += `&cursor=${apiCursor}`;
        }

        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`Events fetch failed: ${response.status}`);
        }

        const data = await response.json() as EventsResponse;
        let foundCursor = false;

        for (const event of data.items) {
          if (cursor_event_cid && event.event_cid === cursor_event_cid) {
            // Found our cursor! Stop accumulating
            foundCursor = true;
            console.log(`  ✓ Found cursor at event CID: ${event.event_cid}`);
            break;
          } else {
            // New event we haven't seen
            newEvents.push(event);
          }
        }

        if (foundCursor) {
          break;
        }

        if (!data.has_more) {
          // Reached end of chain without finding cursor (fresh system or genesis)
          console.log('  Reached end of chain');
          break;
        }

        apiCursor = data.next_cursor;
      }

      // Append new events in correct order (reverse since we walked backwards)
      const updates = newEvents.length;
      if (updates > 0) {
        console.log(`\nAdding ${updates} new events:`);
        for (const event of newEvents.reverse()) {
          this.appendData(event);
          console.log(`  ${event.type}: ${event.pi} (v${event.ver}) - ${event.event_cid}`);
        }

        // Update cursor to most recent event (last one appended, which is at end of reversed array)
        this.state.cursor_event_cid = newEvents[newEvents.length - 1].event_cid;
        // Note: We don't increment total_entities here since updates can happen to same PI
        // The total_entities from snapshot is a count of unique PIs, not events
      }

      this.state.last_poll_time = new Date().toISOString();
      this.saveState();

      return { updates };
    } catch (error) {
      console.error('Sync from cursor failed:', error);
      throw error;
    }
  }

  // Get events between two event CIDs by walking backwards from current to target
  private async getEventsGap(fromEventCid: string, toEventCid: string | null): Promise<Event[]> {
    console.log(`  Walking /events API from ${toEventCid || 'HEAD'} back to ${fromEventCid}...`);

    let apiCursor: string | undefined = undefined;
    const gapEvents: Event[] = [];
    let foundTarget = false;
    let pollCount = 0;

    try {
      while (true) {
        pollCount++;
        let url = `${this.backendApiUrl}/events?limit=100`;
        if (apiCursor) {
          url += `&cursor=${apiCursor}`;
        }

        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`Events fetch failed: ${response.status}`);
        }

        const data = await response.json() as EventsResponse;

        for (const event of data.items) {
          // Stop when we reach the target checkpoint
          if (event.event_cid === fromEventCid) {
            foundTarget = true;
            console.log(`  ✓ Found checkpoint at event CID: ${event.event_cid}`);
            break;
          }

          // Collect events newer than the checkpoint
          gapEvents.push(event);
        }

        if (foundTarget) {
          break;
        }

        if (!data.has_more) {
          // Reached end of chain without finding checkpoint
          console.log(`  ✗ Checkpoint ${fromEventCid} not found in event chain`);
          throw new Error(`Checkpoint event_cid ${fromEventCid} not found in event stream`);
        }

        apiCursor = data.next_cursor;
      }

      // Return events in chronological order (reverse since we walked backwards)
      const orderedEvents = gapEvents.reverse();
      console.log(`  Found ${orderedEvents.length} events to catch up (${pollCount} API calls)`);
      return orderedEvents;
    } catch (error) {
      console.error('Failed to get events gap:', error);
      throw error;
    }
  }

  // Initialize
  async initialize(): Promise<void> {
    if (this.state.phase === 'not_started') {
      await this.bulkSync();
    }

    if (this.state.phase === 'polling') {
      console.log('\n=== Mirror Already Initialized ===');
      console.log(`  - Total entities: ${this.state.total_entities}`);
      console.log(`  - Last poll: ${this.state.last_poll_time || 'never'}`);
      console.log(`  - Current backoff: ${this.state.backoff_seconds}s`);
    }

    // Initialize Pinecone if enabled
    if (this.pineconeEnabled) {
      await this.initializePinecone();
    }
  }

  // Main poll loop
  async pollLoop(): Promise<void> {
    if (!this.state.connected) {
      throw new Error('Must call initialize() first');
    }

    console.log('\n=== Continuous Polling ===');
    console.log('Starting continuous polling with exponential backoff...\n');

    while (true) {
      if (this.shouldStopPolling) {
        console.log('Polling stopped');
        break;
      }

      console.log(`[${new Date().toISOString()}] Polling for updates...`);

      try {
        const { updates } = await this.syncFromCursor();

        if (updates > 0) {
          // Activity detected - reset to minimum
          console.log(`  Found ${updates} updates, resetting backoff`);
          this.state.backoff_seconds = this.minBackoff;
        } else {
          // No new data - increase backoff
          this.state.backoff_seconds = Math.min(
            this.state.backoff_seconds * 2,
            this.maxBackoff
          );
          console.log(`  No updates, backing off to ${this.state.backoff_seconds}s`);
        }

        // Periodic Pinecone queue flush (every 5 minutes)
        if (this.pineconeEnabled && this.pineconeQueue.length > 0) {
          const timeSinceLastProcess = Date.now() - this.lastPineconeProcessTime;
          if (timeSinceLastProcess > 5 * 60 * 1000) {  // 5 minutes
            console.log(`Flushing Pinecone queue (${this.pineconeQueue.length} items)...`);
            this.startPineconeProcessing();
          }
        }

        this.saveState();
      } catch (error) {
        console.error('Poll error:', error);
        // Don't reset backoff on errors, just wait minimum time
        await this.sleep(this.minBackoff * 1000);
        continue;
      }

      console.log(`  Next poll in ${this.state.backoff_seconds}s\n`);
      await this.sleep(this.state.backoff_seconds * 1000);
    }
  }

  // Complete workflow
  async run(): Promise<void> {
    console.log('=== Arke IPFS Mirror Starting ===');
    console.log(`Backend API URL: ${this.backendApiUrl} (events, snapshots)`);
    console.log(`Wrapper API URL: ${this.arkeApiUrl} (entity CRUD)`);
    console.log(`State File: ${this.stateFilePath}`);
    console.log(`Data File: ${this.dataFilePath}\n`);

    await this.initialize();
    await this.pollLoop();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stopPolling(): void {
    this.shouldStopPolling = true;
  }

  async flushPineconeQueue(): Promise<void> {
    if (!this.pineconeEnabled || this.pineconeQueue.length === 0) {
      return;
    }

    console.log(`Flushing Pinecone queue (${this.pineconeQueue.length} items)...`);

    // If already processing, wait for it to complete
    if (this.pineconeProcessing) {
      console.log('Waiting for current processing to complete...');
      // Wait with timeout
      const maxWait = 60000; // 60 seconds
      const startTime = Date.now();
      while (this.pineconeProcessing && (Date.now() - startTime) < maxWait) {
        await this.sleep(1000);
      }
    }

    // Process any remaining items
    if (this.pineconeQueue.length > 0) {
      await this.processPineconeQueue();
    }

    console.log('Pinecone queue flushed');
  }

  // Utility: Get current stats
  getStats() {
    return {
      phase: this.state.phase,
      total_entities: this.state.total_entities,
      connected: this.state.connected,
      backoff_seconds: this.state.backoff_seconds,
      last_poll_time: this.state.last_poll_time,
      pinecone: this.state.pinecone
    };
  }
}

// Main entry point
async function main() {
  // Get API URLs from environment or use defaults
  const backendApiUrl = process.env.BACKEND_API_URL || 'http://localhost:3000';
  const arkeApiUrl = process.env.ARKE_API_URL || 'http://localhost:8787';

  // Get file paths from environment (for Docker/Fly.io deployment)
  const stateFilePath = process.env.STATE_FILE_PATH;
  const dataFilePath = process.env.DATA_FILE_PATH;

  const mirror = new ArkeIPFSMirror(backendApiUrl, arkeApiUrl, stateFilePath, dataFilePath);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\nGraceful shutdown initiated...');

    // Stop accepting new items
    mirror.stopPolling();

    // Flush remaining Pinecone queue
    await mirror.flushPineconeQueue();

    // Save final state
    console.log('Saving final state...');
    console.log('Final stats:', mirror.getStats());

    console.log('Shutdown complete');
    process.exit(0);
  });

  try {
    await mirror.run();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();
