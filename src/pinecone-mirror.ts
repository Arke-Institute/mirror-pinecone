/**
 * Pinecone Mirror
 * Main orchestrator for mirroring Arke entities to Pinecone
 */

import 'dotenv/config';
import { readFileSync } from 'fs';
import { ArkeClient } from './services/arke-client.js';
import { OpenAIClient } from './services/openai-client.js';
import { PineconeClient } from './services/pinecone-client.js';
import { ParentResolver } from './services/parent-resolver.js';
import { loadConfig } from './adapters/nara/config.js';
import { extractText } from './adapters/nara/field-extractor.js';
import { extractMetadata } from './adapters/nara/metadata-extractor.js';
import { getNamespace } from './adapters/nara/namespace-resolver.js';
import type { PineconeVector } from './services/pinecone-client.js';

interface Event {
  pi: string;
  type: 'create' | 'update';
  ver: number;
  tip_cid: string;
  ts: string;
}

interface ProcessingItem {
  pi: string;
  text: string;
  namespace: string;
  metadata: Record<string, any>;
}

interface Stats {
  totalEvents: number;
  processed: number;
  skipped: number;
  failed: number;
  embeddingsGenerated: number;
  vectorsUpserted: number;
}

async function main() {
  console.log('=== Pinecone Mirror Starting ===\n');

  // Load configuration
  const configPath = process.env.CONFIG_PATH || './config/nara-config.json';
  console.log('Loading config from: ' + configPath);
  const config = loadConfig(configPath);

  // Initialize services
  const arkeUrl = process.env.ARKE_API_URL || 'http://localhost:8787';
  const openaiKey = process.env.OPENAI_API_KEY;
  const pineconeKey = process.env.PINECONE_API_KEY;

  if (!openaiKey) {
    throw new Error('OPENAI_API_KEY environment variable required');
  }
  if (!pineconeKey) {
    throw new Error('PINECONE_API_KEY environment variable required');
  }

  console.log('Initializing services...');
  const arkeClient = new ArkeClient(arkeUrl);
  const openaiClient = new OpenAIClient(
    openaiKey,
    config.embedding_model,
    config.embedding_dimensions
  );
  const pineconeClient = new PineconeClient(
    pineconeKey,
    'arke-institute',
    config.embedding_dimensions
  );
  const parentResolver = new ParentResolver(arkeClient);

  // Ensure Pinecone index exists
  console.log('Ensuring Pinecone index exists...');
  await pineconeClient.ensureIndex();

  // Read events from file
  const eventsPath = process.env.EVENTS_FILE || './mirror-data.jsonl';
  console.log('\nReading events from: ' + eventsPath);
  const events = readEvents(eventsPath);
  console.log('Total events: ' + events.length);

  // Limit for testing (set TEST_LIMIT env var)
  const testLimit = process.env.TEST_LIMIT ? parseInt(process.env.TEST_LIMIT, 10) : undefined;
  const eventsToProcess = testLimit ? events.slice(0, testLimit) : events;
  
  if (testLimit) {
    console.log('TEST MODE: Processing only ' + testLimit + ' events\n');
  }

  // Process in batches
  const stats: Stats = {
    totalEvents: eventsToProcess.length,
    processed: 0,
    skipped: 0,
    failed: 0,
    embeddingsGenerated: 0,
    vectorsUpserted: 0
  };

  const batchSize = config.batch_size;
  const batches = chunk(eventsToProcess, batchSize);

  console.log('Processing ' + eventsToProcess.length + ' events in ' + batches.length + ' batches\n');

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log('--- Batch ' + (i + 1) + '/' + batches.length + ' (' + batch.length + ' events) ---');

    try {
      await processBatch(batch, {
        arkeClient,
        openaiClient,
        pineconeClient,
        parentResolver,
        config,
        stats
      });

      // Clear cache periodically
      if ((i + 1) % 10 === 0) {
        console.log('Clearing parent resolver cache (size: ' + parentResolver.getCacheSize() + ')');
        parentResolver.clearCache();
      }
    } catch (error) {
      console.error('Batch failed:', error);
    }

    console.log('');
  }

  // Print final stats
  console.log('\n=== Processing Complete ===');
  console.log('Total events: ' + stats.totalEvents);
  console.log('Processed: ' + stats.processed);
  console.log('Skipped: ' + stats.skipped);
  console.log('Failed: ' + stats.failed);
  console.log('Embeddings generated: ' + stats.embeddingsGenerated);
  console.log('Vectors upserted: ' + stats.vectorsUpserted);
  console.log('\nSuccess rate: ' + ((stats.processed / stats.totalEvents) * 100).toFixed(1) + '%');

  // Show index stats
  console.log('\n=== Index Statistics ===');
  try {
    const indexStats = await pineconeClient.getStats();
    console.log(JSON.stringify(indexStats, null, 2));
  } catch (error) {
    console.error('Failed to get index stats:', error);
  }
}

async function processBatch(
  events: Event[],
  services: {
    arkeClient: ArkeClient;
    openaiClient: OpenAIClient;
    pineconeClient: PineconeClient;
    parentResolver: ParentResolver;
    config: any;
    stats: Stats;
  }
): Promise<void> {
  const items: ProcessingItem[] = [];

  // Fetch and prepare all items
  for (const event of events) {
    try {
      // Fetch entity + catalog
      const { manifest, catalog } = await services.arkeClient.getEntityWithCatalog(event.pi);

      // Extract schema type for namespace
      const namespace = getNamespace(catalog.schema, services.config);

      // Extract schema type for field extraction (e.g., "fileUnit")
      const schemaType = services.config.namespace_mapping[catalog.schema] || 'unknown';

      // Extract text for embedding
      const text = extractText(catalog, schemaType, services.config);

      // Skip if no text
      if (!text || text.trim().length === 0) {
        console.log('  [SKIP] ' + event.pi + ' - no text extracted');
        services.stats.skipped++;
        continue;
      }

      // Get parent ancestry
      const ancestry = await services.parentResolver.getAncestry(event.pi);

      // Extract metadata
      const metadata = extractMetadata(catalog, manifest, ancestry, services.config);

      items.push({
        pi: event.pi,
        text,
        namespace,
        metadata
      });

      console.log('  [OK] ' + event.pi + ' - ' + text.length + ' chars, namespace: ' + namespace);
    } catch (error) {
      console.error('  [FAIL] ' + event.pi + ' - ' + (error instanceof Error ? error.message : 'Unknown error'));
      services.stats.failed++;
    }
  }

  // Skip batch if no items
  if (items.length === 0) {
    console.log('  No items to process in this batch');
    return;
  }

  // Generate embeddings (single API call)
  console.log('  Generating embeddings for ' + items.length + ' items...');
  const texts = items.map(item => item.text);
  const embeddings = await services.openaiClient.createEmbeddings(texts);
  services.stats.embeddingsGenerated += embeddings.length;

  // Group by namespace
  const byNamespace: Record<string, { item: ProcessingItem; embedding: number[] }[]> = {};
  items.forEach((item, idx) => {
    if (!byNamespace[item.namespace]) {
      byNamespace[item.namespace] = [];
    }
    byNamespace[item.namespace].push({
      item,
      embedding: embeddings[idx]
    });
  });

  // Upsert to Pinecone (one call per namespace)
  for (const [namespace, namespaceItems] of Object.entries(byNamespace)) {
    const vectors: PineconeVector[] = namespaceItems.map(({ item, embedding }) => ({
      id: item.pi,
      values: embedding,
      metadata: item.metadata
    }));

    await services.pineconeClient.upsert(namespace, vectors);
    services.stats.vectorsUpserted += vectors.length;
    services.stats.processed += vectors.length;
    console.log('  [UPSERT] ' + vectors.length + ' vectors to namespace: ' + namespace);
  }
}

function readEvents(path: string): Event[] {
  const content = readFileSync(path, 'utf-8');
  const lines = content.trim().split('\n');
  
  return lines
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as Event);
}

function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// Run main
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
