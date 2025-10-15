# Pinecone Mirror Implementation Plan

## Overview

This document outlines the implementation plan for mirroring Arke IPFS entities to Pinecone with vector embeddings for semantic search.

**Goal**: Process events from the Arke IPFS mirror, fetch entity data, extract text hierarchically, generate embeddings via OpenAI, and upsert vectors to Pinecone with rich metadata for filtering.

**Status**: Plan validated through API testing with live data

---

## API Testing Results

### Entity Hierarchy Observed

```
Arke Genesis (00000000000000000000000000)
└── Institution (01K7JRF4PWJB75K4SJ2APMCRE6)
    └── Collection (01K7JRF6D9XF6PN5436B4CECG1)
        └── Series (01K7JRF6H9WXSNM51NHS0RN9CC)
            └── FileUnit (01K7JRK9VSD7S6MN45QR745Z40)
                └── DigitalObject (01K7JRKKWFFBJQ2CF1H0XBFX9V)
```

### Data Structures by Schema

#### 1. Institution (`nara-institution@v1`)

**Entity Manifest**:
```json
{
  "pi": "01K7JRF4PWJB75K4SJ2APMCRE6",
  "ver": 2,
  "components": {
    "catalog_record": "bafkreih..."
  },
  "parent_pi": "00000000000000000000000000",
  "children_pi": ["01K7JRF6D9XF6PN5436B4CECG1"]
}
```

**Catalog Record** (via `/cat/{cid}`):
```json
{
  "schema": "nara-institution@v1",
  "name": "National Archives",
  "description": "National Archives and Records Administration",
  "url": "https://www.archives.gov/",
  "import_timestamp": "2025-10-15T01:41:31.348020Z"
}
```

**Text Fields for Embedding**:
- `name`
- `description`

**Metadata Fields**:
- `nara_naId`: N/A (institutions don't have naIds)
- `schema`: "nara-institution@v1"
- `date_range`: N/A

---

#### 2. Collection (`nara-collection@v1`)

**Catalog Record**:
```json
{
  "schema": "nara-collection@v1",
  "title": "Records of the National Security Council Speechwriting Office (Clinton Administration)",
  "nara_naId": 7388842,
  "collection_identifier": "WJC-NSCSW",
  "date_range": {
    "start": "1993-01-01",
    "end": "2001-12-31"
  },
  "import_timestamp": "2025-10-15T01:41:33.209998Z"
}
```

**Text Fields for Embedding**:
- `title`

**Metadata Fields**:
- `nara_naId`: 7388842
- `schema`: "nara-collection@v1"
- `date_range.start`: "1993-01-01" → 19930101
- `date_range.end`: "2001-12-31" → 20011231

---

#### 3. Series (`nara-series@v1`)

**Catalog Record**:
```json
{
  "schema": "nara-series@v1",
  "title": "Antony Blinken's Files",
  "nara_naId": 7585787,
  "parent_naId": 7388842,
  "date_range": {
    "start": "1994-01-01",
    "end": "1998-12-31"
  },
  "creators": [
    {
      "heading": "President (1993-2001 : Clinton). National Security Council. (1993 - 2001)",
      "authorityType": "organization",
      "creatorType": "Most Recent",
      "naId": 10500730,
      "establishDate": {"logicalDate": "1993-01-01", "year": 1993},
      "abolishDate": {"logicalDate": "2001-12-31", "year": 2001}
    }
  ],
  "import_timestamp": "2025-10-15T01:41:33.343685Z"
}
```

**Text Fields for Embedding**:
- `title`
- `creators[].heading` (concatenate all)

**Metadata Fields**:
- `nara_naId`: 7585787
- `schema`: "nara-series@v1"
- `date_range.start`: 19940101
- `date_range.end`: 19981231

---

#### 4. FileUnit (`nara-fileunit@v1`)

**Catalog Record** (partial):
```json
{
  "schema": "nara-fileunit@v1",
  "title": "Bosnia Trip - Address to People of Bosnia 1/11/96",
  "nara_naId": 23903281,
  "parent_naId": 7585787,
  "collection_naId": 7388842,
  "level": "fileUnit",
  "digital_object_count": 45,
  "foia_tracking": "LPWJC 2006-0459-F",
  "access_restriction": {
    "status": "Restricted - Partly",
    "note": "These records may need to be screened for personal privacy...",
    "specificAccessRestrictions": [
      {"restriction": "FOIA (b)(1) National Security", "securityClassification": "Secret"}
    ]
  },
  "nara_full_metadata": {
    "ancestors": [
      {
        "levelOfDescription": "collection",
        "naId": 7388842,
        "title": "Records of the National Security Council Speechwriting Office (Clinton Administration)",
        "collectionIdentifier": "WJC-NSCSW",
        "distance": 2,
        "inclusiveStartDate": {"logicalDate": "1993-01-01", "year": 1993},
        "inclusiveEndDate": {"logicalDate": "2001-12-31", "year": 2001}
      },
      {
        "levelOfDescription": "series",
        "naId": 7585787,
        "title": "Antony Blinken's Files",
        "distance": 1,
        "creators": [
          {
            "heading": "President (1993-2001 : Clinton). National Security Council. (1993 - 2001)"
          }
        ],
        "inclusiveStartDate": {"logicalDate": "1994-01-01", "year": 1994},
        "inclusiveEndDate": {"logicalDate": "1998-12-31", "year": 1998}
      }
    ],
    "digitalObjects": [
      {
        "objectId": "55261641",
        "objectType": "Portable Document File (PDF)",
        "objectFilename": "42-t-7585787-20060459F-018-004-2014.pdf",
        "extractedText": "\nCase Number: 2006-0459-F\nFOIA\nMARKER\n...[~15000 chars of speech text]..."
      }
    ]
  },
  "import_timestamp": "2025-10-15T01:43:47.783780Z"
}
```

**Text Fields for Embedding**:
- `title`
- `access_restriction.note`
- `nara_full_metadata.ancestors[].title` (all ancestor titles)
- `nara_full_metadata.ancestors[].creators[].heading` (all creator headings)
- `nara_full_metadata.digitalObjects[].extractedText` (PDF OCR text - can be huge!)

**Metadata Fields**:
- `nara_naId`: 23903281
- `schema`: "nara-fileunit@v1"
- `date_range`: Extract from `nara_full_metadata.ancestors[0].inclusiveStartDate/EndDate`

**Special Handling**:
- FileUnits can have MASSIVE extracted text from PDFs (15k+ characters)
- Need to truncate to 20k chars / 5k words
- Ancestor data provides rich hierarchical context

---

#### 5. DigitalObject (`nara-digitalobject@v1`)

**Catalog Record** (Image, no text):
```json
{
  "schema": "nara-digitalobject@v1",
  "nara_objectId": "55261667",
  "parent_naId": 23903281,
  "filename": "42_t_7585787_20060459F_018_004_2016_Page_026.JPG",
  "object_type": "Image (JPG)",
  "file_size": 466944,
  "page_number": 26,
  "s3_url": "https://s3.amazonaws.com/NARAprodstorage/...",
  "content_hash": {
    "algorithm": "sha256",
    "digest_hex": "6403df44..."
  },
  "nara_full_metadata": {
    "objectId": "55261667",
    "objectType": "Image (JPG)",
    "objectFilename": "42_t_7585787_20060459F_018_004_2016_Page_026.JPG",
    "objectFileSize": 466944,
    "objectUrl": "https://s3.amazonaws.com/..."
  },
  "import_timestamp": "2025-10-15T01:43:58.070781Z"
}
```

**Catalog Record** (PDF with text):
```json
{
  "schema": "nara-digitalobject@v1",
  "nara_objectId": "55261641",
  "parent_naId": 23903281,
  "filename": "42-t-7585787-20060459F-018-004-2014.pdf",
  "object_type": "Portable Document File (PDF)",
  "extracted_text": "\nCase Number: 2006-0459-F\nFOIA MARKER...[15000+ chars]...",
  "file_size": 1353310,
  "s3_url": "https://s3.amazonaws.com/...",
  "import_timestamp": "2025-10-15T01:43:47.753806Z"
}
```

**Text Fields for Embedding**:
- `extracted_text` (direct field on digitalObject - if present)

**Metadata Fields**:
- `nara_naId`: Use `nara_objectId` instead (55261641)
- `schema`: "nara-digitalobject@v1"
- `date_range`: N/A (inherit from parent fileUnit if needed)

**Special Handling**:
- Many digitalObjects are images with NO text - skip these
- PDFs have `extracted_text` directly on the catalog record
- Text can be very long - truncate to limits

---

## Implementation Architecture

### File Structure

```
mirror-pinecone/
├── src/
│   ├── mirror.ts                    # Existing (keep as-is)
│   ├── pinecone-mirror.ts          # NEW: Main orchestrator
│   ├── services/
│   │   ├── arke-client.ts          # NEW: Fetch entity + catalog data
│   │   ├── openai-client.ts        # NEW: Generate embeddings
│   │   ├── pinecone-client.ts      # NEW: Upsert vectors
│   │   └── parent-resolver.ts      # NEW: Walk ancestry tree
│   └── adapters/
│       └── nara/
│           ├── config.ts            # NEW: Load & validate config
│           ├── field-extractor.ts   # NEW: Extract text for embedding
│           ├── metadata-extractor.ts # NEW: Extract filterable metadata
│           ├── namespace-resolver.ts # NEW: Schema → namespace
│           └── date-converter.ts    # NEW: Normalize dates to YYYYMMDD
├── config/
│   └── nara-config.json             # NEW: Field paths & rules
├── .env.example                     # NEW: Template
├── .env                            # NEW: Secrets (gitignored)
└── package.json                     # UPDATE: Add dependencies
```

---

## Configuration System

### `config/nara-config.json`

```json
{
  "embedding_fields": {
    "institution": ["name", "description"],
    "collection": ["title"],
    "series": ["title", "creators.heading"],
    "fileUnit": [
      "title",
      "access_restriction.note",
      "nara_full_metadata.ancestors.title",
      "nara_full_metadata.ancestors.creators.heading",
      "nara_full_metadata.digitalObjects.extractedText"
    ],
    "digitalObject": ["extracted_text"]
  },
  "metadata_fields": {
    "pi": {
      "source": "pi",
      "type": "string",
      "description": "Entity persistent identifier (vector ID)"
    },
    "nara_naId": {
      "source": ["nara_naId", "nara_objectId"],
      "type": "number",
      "description": "NARA identifier"
    },
    "date_start": {
      "source": [
        "date_range.start",
        "nara_full_metadata.ancestors[0].inclusiveStartDate.logicalDate"
      ],
      "type": "date",
      "format": "YYYYMMDD"
    },
    "date_end": {
      "source": [
        "date_range.end",
        "nara_full_metadata.ancestors[0].inclusiveEndDate.logicalDate"
      ],
      "type": "date",
      "format": "YYYYMMDD"
    },
    "schema": {
      "source": "schema",
      "type": "string"
    },
    "parent_ancestry": {
      "source": "parent_ancestry",
      "type": "array",
      "description": "Array of parent PIs from immediate to root"
    },
    "last_updated": {
      "source": "ts",
      "type": "string",
      "description": "Last update timestamp"
    }
  },
  "namespace_mapping": {
    "nara-institution@v1": "institution",
    "nara-collection@v1": "collection",
    "nara-series@v1": "series",
    "nara-fileunit@v1": "fileUnit",
    "nara-digitalobject@v1": "digitalObject"
  },
  "text_limits": {
    "max_chars": 20000,
    "max_words": 5000
  },
  "batch_size": 100,
  "embedding_model": "text-embedding-3-small",
  "embedding_dimensions": 768
}
```

---

## Module Specifications

### 1. Arke Client (`src/services/arke-client.ts`)

**Purpose**: Fetch entity manifest and catalog data from Arke API

**Functions**:

```typescript
interface ArkeClient {
  // Fetch entity manifest
  getEntity(pi: string): Promise<EntityManifest>;

  // Fetch catalog record by CID
  getCatalogRecord(cid: string): Promise<any>;

  // Fetch entity with resolved catalog data
  getEntityWithCatalog(pi: string): Promise<{
    manifest: EntityManifest;
    catalog: any;
  }>;
}

interface EntityManifest {
  pi: string;
  ver: number;
  ts: string;
  manifest_cid: string;
  components: {
    catalog_record?: string;
    metadata?: string;
    digital_object_metadata?: string;
  };
  parent_pi?: string;
  children_pi?: string[];
  note?: string;
}
```

**Implementation Notes**:
- Base URL: `http://localhost:8787` (from env: `ARKE_API_URL`)
- GET `/entities/{pi}` for manifest
- GET `/cat/{cid}` for catalog data
- Component key varies: `catalog_record`, `metadata`, or `digital_object_metadata`
- Combine manifest + catalog into single object for adapters

**Error Handling**:
- 404 Not Found → Skip entity, log warning
- Network errors → Retry with exponential backoff
- Invalid JSON → Skip entity, log error

---

### 2. OpenAI Client (`src/services/openai-client.ts`)

**Purpose**: Generate embeddings via OpenAI API

**Functions**:

```typescript
interface OpenAIClient {
  // Generate embeddings for batch of texts
  createEmbeddings(texts: string[]): Promise<number[][]>;
}
```

**Implementation**:
- Use `openai` npm package
- Model: `text-embedding-3-small`
- Dimensions: 768
- Batch size: Up to 100 texts per request
- Max input: 8192 tokens per text (enforced by truncation in field extractor)
- Total limit: 300,000 tokens per request (should be fine with 100 × 5k words max)

**API Request**:
```typescript
const response = await openai.embeddings.create({
  model: "text-embedding-3-small",
  input: texts, // Array of strings
  dimensions: 768,
  encoding_format: "float"
});

return response.data.map(d => d.embedding);
```

**Error Handling**:
- 429 Rate Limit → Retry with exponential backoff
- 400 Bad Request → Log error, skip batch
- Network errors → Retry up to 5 times

---

### 3. Pinecone Client (`src/services/pinecone-client.ts`)

**Purpose**: Upsert vectors to Pinecone index

**Functions**:

```typescript
interface PineconeClient {
  // Ensure index exists, create if not
  ensureIndex(): Promise<void>;

  // Upsert vectors to namespace
  upsert(namespace: string, vectors: PineconeVector[]): Promise<void>;
}

interface PineconeVector {
  id: string;           // PI
  values: number[];     // Embedding (768 dims)
  metadata: Record<string, any>;
}
```

**Implementation**:
- Use `@pinecone-database/pinecone` npm package
- Index name: `arke-institute`
- Index config: 768 dimensions, cosine metric
- Batch size: Up to 100 vectors per upsert

**Index Creation** (if not exists):
```typescript
await pinecone.createIndex({
  name: 'arke-institute',
  dimension: 768,
  metric: 'cosine',
  spec: {
    serverless: {
      cloud: 'aws',
      region: 'us-east-1'
    }
  }
});
```

**Upsert Request**:
```typescript
const index = pinecone.index('arke-institute');
await index.namespace(namespace).upsert(vectors);
```

**Error Handling**:
- 429 Rate Limit → Retry with exponential backoff
- Network errors → Retry up to 5 times
- Invalid dimensions → Log error, skip batch

---

### 4. Parent Resolver (`src/services/parent-resolver.ts`)

**Purpose**: Walk parent chain and return array of ancestor PIs

**Functions**:

```typescript
interface ParentResolver {
  // Get ancestry from immediate parent to root
  getAncestry(pi: string, arkeClient: ArkeClient): Promise<string[]>;

  // Clear cache
  clearCache(): void;
}
```

**Implementation**:
- Cache: `Map<PI, string[]>` for resolved ancestry
- Walk parent_pi chain until reaching root (no parent_pi or parent_pi === "00000000000000000000000000")
- Return array: [immediate_parent, grandparent, ..., root]

**Algorithm**:
```typescript
async getAncestry(pi: string): Promise<string[]> {
  // Check cache
  if (this.cache.has(pi)) return this.cache.get(pi);

  const ancestry: string[] = [];
  const entity = await this.arkeClient.getEntity(pi);

  if (!entity.parent_pi || entity.parent_pi === "00000000000000000000000000") {
    this.cache.set(pi, ancestry);
    return ancestry;
  }

  // Recursively get parent's ancestry
  const parentAncestry = await this.getAncestry(entity.parent_pi);
  ancestry.push(entity.parent_pi, ...parentAncestry);

  this.cache.set(pi, ancestry);
  return ancestry;
}
```

**Optimization**:
- Cache all intermediate results
- Higher-level entities cached first (fewer lookups)
- Clear cache periodically to prevent memory issues

---

### 5. NARA Config Loader (`src/adapters/nara/config.ts`)

**Purpose**: Load and validate NARA configuration

**Functions**:

```typescript
interface NaraConfig {
  embedding_fields: Record<string, string[]>;
  metadata_fields: Record<string, FieldConfig>;
  namespace_mapping: Record<string, string>;
  text_limits: { max_chars: number; max_words: number };
  batch_size: number;
  embedding_model: string;
  embedding_dimensions: number;
}

function loadConfig(path: string): NaraConfig;
```

**Implementation**:
- Read JSON file
- Validate schema
- Return typed config object

---

### 6. Field Extractor (`src/adapters/nara/field-extractor.ts`)

**Purpose**: Extract text from entity for embedding

**Functions**:

```typescript
interface FieldExtractor {
  // Extract text fields for given schema type
  extractText(entity: any, schemaType: string, config: NaraConfig): string;
}
```

**Algorithm**:
1. Get field paths from `config.embedding_fields[schemaType]`
2. For each path:
   - Walk JSON using dot notation (e.g., `nara_full_metadata.ancestors.title`)
   - Handle arrays (collect all values)
   - Concatenate with format: `field_name: value`
3. Join all extracted text with newlines
4. Truncate to limits (20k chars or 5k words, whichever comes first)
5. Return final text

**Example Output**:
```
title: Bosnia Trip - Address to People of Bosnia 1/11/96
access_restriction.note: These records may need to be screened for personal privacy...
ancestors.title: Records of the National Security Council Speechwriting Office (Clinton Administration)
ancestors.title: Antony Blinken's Files
ancestors.creators.heading: President (1993-2001 : Clinton). National Security Council. (1993 - 2001)
digitalObjects.extractedText: Case Number: 2006-0459-F FOIA MARKER...[truncated at 20k chars]
```

**Implementation Notes**:
- Use lodash `_.get()` or custom JSON walker
- Handle missing fields gracefully (skip, don't error)
- Arrays: recursively extract from all elements
- Nested arrays: flatten and extract
- Return empty string if no text found

---

### 7. Metadata Extractor (`src/adapters/nara/metadata-extractor.ts`)

**Purpose**: Extract filterable metadata fields

**Functions**:

```typescript
interface MetadataExtractor {
  // Extract metadata for Pinecone
  extractMetadata(
    entity: any,
    manifest: EntityManifest,
    ancestry: string[],
    config: NaraConfig
  ): Record<string, any>;
}
```

**Algorithm**:
1. For each field in `config.metadata_fields`:
   - Try each source path in order
   - Apply type conversion (string, number, date, array)
   - Use first successful extraction
2. Add `parent_ancestry` from resolver
3. Add `pi` from manifest
4. Add `last_updated` from manifest.ts
5. Return metadata object

**Example Output**:
```json
{
  "pi": "01K7JRK9VSD7S6MN45QR745Z40",
  "nara_naId": 23903281,
  "date_start": 19930101,
  "date_end": 20011231,
  "schema": "nara-fileunit@v1",
  "parent_ancestry": ["01K7JRF6H9WXSNM51NHS0RN9CC", "01K7JRF6D9XF6PN5436B4CECG1", "01K7JRF4PWJB75K4SJ2APMCRE6"],
  "last_updated": "2025-10-15T01:43:47.783780Z"
}
```

**Type Conversions**:
- `string`: Direct extraction
- `number`: `parseInt()` or `parseFloat()`
- `date`: Convert YYYY-MM-DD → YYYYMMDD integer
- `array`: Keep as array (Pinecone supports array metadata)

---

### 8. Namespace Resolver (`src/adapters/nara/namespace-resolver.ts`)

**Purpose**: Map schema to Pinecone namespace

**Functions**:

```typescript
interface NamespaceResolver {
  // Get namespace for schema
  getNamespace(schema: string, config: NaraConfig): string;
}
```

**Algorithm**:
1. Look up schema in `config.namespace_mapping`
2. Return mapped namespace
3. Default to "unknown" if not found

**Example**:
- `nara-fileunit@v1` → `fileUnit`
- `nara-series@v1` → `series`

---

### 9. Date Converter (`src/adapters/nara/date-converter.ts`)

**Purpose**: Normalize dates to YYYYMMDD integer

**Functions**:

```typescript
interface DateConverter {
  // Convert date string to YYYYMMDD integer
  convertDate(dateStr: string): number | null;
}
```

**Implementation**:
- Parse `YYYY-MM-DD` format
- Extract year, month, day
- Return as integer: `year * 10000 + month * 100 + day`
- Handle invalid dates gracefully (return null)

**Examples**:
- `"1993-01-01"` → `19930101`
- `"2001-12-31"` → `20011231`
- `"invalid"` → `null`

---

## Main Orchestrator

### `src/pinecone-mirror.ts`

**Purpose**: Main entry point that coordinates all services

**Process Flow**:

```typescript
async function main() {
  // 1. Initialize services
  const config = loadConfig('./config/nara-config.json');
  const arkeClient = new ArkeClient(process.env.ARKE_API_URL);
  const openaiClient = new OpenAIClient(process.env.OPENAI_API_KEY);
  const pineconeClient = new PineconeClient(process.env.PINECONE_API_KEY);
  const parentResolver = new ParentResolver(arkeClient);

  // 2. Ensure Pinecone index exists
  await pineconeClient.ensureIndex();

  // 3. Read events from mirror-data.jsonl
  const events = readEventsFromFile('./mirror-data.jsonl');

  // 4. Process in batches
  const batches = chunk(events, config.batch_size); // 100 per batch

  for (const batch of batches) {
    await processBatch(batch, {
      arkeClient,
      openaiClient,
      pineconeClient,
      parentResolver,
      config
    });
  }
}

async function processBatch(events, services) {
  const items = [];

  // Fetch and prepare all items
  for (const event of events) {
    try {
      // Fetch entity + catalog
      const { manifest, catalog } = await services.arkeClient.getEntityWithCatalog(event.pi);

      // Extract schema type
      const schemaType = getSchemaType(catalog.schema); // "fileUnit", "series", etc.

      // Extract text for embedding
      const text = extractText(catalog, schemaType, services.config);

      // Skip if no text
      if (!text || text.trim().length === 0) {
        console.log(`Skipping ${event.pi} - no text extracted`);
        continue;
      }

      // Get namespace
      const namespace = getNamespace(catalog.schema, services.config);

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
    } catch (error) {
      console.error(`Error processing ${event.pi}:`, error);
      // Continue with next item
    }
  }

  // Skip batch if no items
  if (items.length === 0) return;

  // Generate embeddings (single API call)
  const texts = items.map(item => item.text);
  const embeddings = await services.openaiClient.createEmbeddings(texts);

  // Group by namespace
  const byNamespace = groupBy(items, 'namespace');

  // Upsert to Pinecone (one call per namespace)
  for (const [namespace, namespaceItems] of Object.entries(byNamespace)) {
    const vectors = namespaceItems.map((item, idx) => ({
      id: item.pi,
      values: embeddings[idx],
      metadata: item.metadata
    }));

    await services.pineconeClient.upsert(namespace, vectors);
    console.log(`Upserted ${vectors.length} vectors to namespace: ${namespace}`);
  }
}
```

**Error Handling**:
- Per-item errors: Log and continue (don't fail entire batch)
- Batch-level errors: Retry with exponential backoff
- Fatal errors: Exit with error code

**Progress Tracking**:
- Log every batch completion
- Track total items processed
- Track items skipped (no text)
- Track errors

---

## Environment Variables

### `.env.example`

```bash
# Arke IPFS API
ARKE_API_URL=http://localhost:8787

# OpenAI
OPENAI_API_KEY=sk-...

# Pinecone
PINECONE_API_KEY=pcsk_...
PINECONE_HOST=https://arke-institute-xxxxx.svc.pinecone.io

# Optional
NODE_ENV=production
LOG_LEVEL=info
```

### `.env` (actual)

```bash
# User will fill this in
```

**Gitignore**:
```
.env
```

---

## Dependencies

### `package.json` Updates

```json
{
  "dependencies": {
    "openai": "^4.20.0",
    "@pinecone-database/pinecone": "^2.0.0",
    "lodash": "^4.17.21"
  },
  "devDependencies": {
    "@types/lodash": "^4.14.202"
  }
}
```

---

## Testing Strategy

### Phase 1: Unit Tests

1. **Field Extractor**
   - Test with sample fileUnit (with extractedText)
   - Test with sample series (with creators)
   - Test truncation (20k chars, 5k words)
   - Test missing fields (should not error)

2. **Metadata Extractor**
   - Test date conversion
   - Test fallback sources (try multiple paths)
   - Test type conversions

3. **Namespace Resolver**
   - Test all schema types
   - Test unknown schema (default namespace)

### Phase 2: Integration Tests

1. **API Client**
   - Fetch real entity from Arke API
   - Verify manifest + catalog structure

2. **Small Batch Processing**
   - Process 10 events from mirror-data.jsonl
   - Verify embeddings generated (768 dims)
   - Verify vectors upserted to Pinecone
   - Query Pinecone to verify data

3. **Parent Ancestry**
   - Verify ancestry resolution
   - Verify caching works
   - Test deep hierarchies (5+ levels)

### Phase 3: Full Run

1. Process all events from mirror-data.jsonl
2. Monitor:
   - OpenAI API usage
   - Pinecone usage
   - Processing speed
   - Error rate
3. Validate random samples in Pinecone

---

## Error Handling & Retry Logic

### Retry Configuration

```typescript
const RETRY_CONFIG = {
  maxRetries: 5,
  initialDelay: 1000,      // 1s
  maxDelay: 30000,         // 30s
  backoffMultiplier: 2
};
```

### Retryable Errors

- Network failures (`ECONNRESET`, `ETIMEDOUT`, etc.)
- 429 Rate Limit
- 500/502/503/504 Server errors
- Transient API errors

### Non-Retryable Errors

- 400 Bad Request (log and skip)
- 401/403 Authentication (fail immediately)
- 404 Not Found (log and skip)
- Invalid data format (log and skip)

### Exponential Backoff

```typescript
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  attempt = 0
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!isRetryable(error) || attempt >= RETRY_CONFIG.maxRetries) {
      throw error;
    }

    const delay = Math.min(
      RETRY_CONFIG.initialDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt),
      RETRY_CONFIG.maxDelay
    );

    console.log(`Retry attempt ${attempt + 1} after ${delay}ms`);
    await sleep(delay);
    return retryWithBackoff(fn, attempt + 1);
  }
}
```

---

## Performance Optimization

### Batching Strategy

- **Events**: Process 100 events per batch
- **Embeddings**: Single API call for 100 texts
- **Pinecone**: Single upsert per namespace (up to 100 vectors)

### Caching

- **Parent Ancestry**: Cache resolved ancestry chains
- **Entity Data**: Optional - cache frequently accessed entities

### Parallelization

- **Within Batch**: Fetch entities in parallel (Promise.all)
- **Across Batches**: Sequential (to respect rate limits)

### Memory Management

- **Streaming**: Read events from file line-by-line (don't load all in memory)
- **Cache Limits**: Clear parent resolver cache every 1000 items
- **Garbage Collection**: Explicit cleanup between batches

---

## Monitoring & Logging

### Metrics to Track

- Total events processed
- Items skipped (no text)
- Items failed (errors)
- Embeddings generated
- Vectors upserted
- API calls made (OpenAI, Pinecone, Arke)
- Processing time per batch
- Average text length

### Log Levels

- **INFO**: Batch progress, completion
- **WARN**: Skipped items, retries
- **ERROR**: Failed items, API errors
- **DEBUG**: Per-item details, API responses

---

## Future Enhancements

1. **Incremental Sync**: Process only new events since last run
2. **Delta Updates**: Update only changed entities
3. **Metadata Enrichment**: Add more filterable fields
4. **Query Interface**: CLI for searching Pinecone
5. **Monitoring Dashboard**: Track processing stats
6. **Parallel Processing**: Multiple workers for large datasets
7. **Checkpointing**: Resume from last processed event on failure

---

## Success Criteria

- [ ] All events from mirror-data.jsonl processed
- [ ] Vectors created for all entities with text
- [ ] Correct namespaces assigned based on schema
- [ ] Metadata includes PI, nara_naId, dates, ancestry
- [ ] Parent ancestry correctly resolved
- [ ] Date ranges converted to numeric format
- [ ] Text truncated to limits (20k chars / 5k words)
- [ ] No authentication errors
- [ ] Error rate < 1%
- [ ] Can query Pinecone and find relevant results

---

## Example Query Results (Expected)

### Search: "Bosnia peacekeeping"

**Expected Result**:
- **Namespace**: `fileUnit`
- **Top Result PI**: `01K7JRK9VSD7S6MN45QR745Z40`
- **Title**: "Bosnia Trip - Address to People of Bosnia 1/11/96"
- **Text Snippet**: "...American peacekeeping forces stationed in Bosnia..."
- **Metadata**:
  - `nara_naId`: 23903281
  - `date_start`: 19930101
  - `date_end`: 20011231
  - `parent_ancestry`: [...series, collection, institution PIs...]

### Filter Example: By Date Range

```typescript
// Find documents from 1996
const results = await index.namespace('fileUnit').query({
  vector: queryEmbedding,
  topK: 10,
  filter: {
    date_start: { $lte: 19961231 },
    date_end: { $gte: 19960101 }
  }
});
```

### Filter Example: By Collection

```typescript
// Find all items in a collection (via ancestry)
const results = await index.namespace('fileUnit').query({
  vector: queryEmbedding,
  topK: 10,
  filter: {
    parent_ancestry: { $in: ['01K7JRF6D9XF6PN5436B4CECG1'] } // Collection PI
  }
});
```

---

## Timeline Estimate

- **Config Setup**: 1 hour
- **Service Modules**: 4 hours
  - Arke Client: 1h
  - OpenAI Client: 1h
  - Pinecone Client: 1h
  - Parent Resolver: 1h
- **NARA Adapters**: 4 hours
  - Field Extractor: 2h
  - Metadata Extractor: 1h
  - Other utilities: 1h
- **Main Orchestrator**: 2 hours
- **Testing**: 3 hours
  - Unit tests: 1h
  - Integration tests: 1h
  - Small batch run: 1h
- **Full Run**: 2-4 hours (depending on data size)

**Total**: ~16-18 hours

---

## Appendix: Sample Data References

### Real PIs Tested

- **Institution**: `01K7JRF4PWJB75K4SJ2APMCRE6`
- **Collection**: `01K7JRF6D9XF6PN5436B4CECG1`
- **Series**: `01K7JRF6H9WXSNM51NHS0RN9CC`
- **FileUnit**: `01K7JRK9VSD7S6MN45QR745Z40`
- **DigitalObject** (image): `01K7JRKKWFFBJQ2CF1H0XBFX9V`

### API Endpoints Used

- Health: `GET http://localhost:8787/`
- Entity: `GET http://localhost:8787/entities/{pi}`
- Catalog: `GET http://localhost:8787/cat/{cid}`

---

**End of Implementation Plan**
