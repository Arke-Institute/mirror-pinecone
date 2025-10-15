/**
 * Pinecone Client
 * Manages Pinecone index and vector upserts
 */

import { Pinecone } from '@pinecone-database/pinecone';
import type { RecordMetadata } from '@pinecone-database/pinecone';

export interface PineconeVector {
  id: string;
  values: number[];
  metadata: RecordMetadata;
}

export class PineconeClient {
  private client: Pinecone;
  private indexName: string;
  private indexHost: string | null = null;
  private dimensions: number;

  constructor(apiKey: string, indexName: string = 'arke-institute', dimensions: number = 768) {
    this.client = new Pinecone({ apiKey });
    this.indexName = indexName;
    this.dimensions = dimensions;
  }

  /**
   * Ensure index exists, create if not, and cache host
   */
  async ensureIndex(): Promise<void> {
    try {
      // Try to describe the index (also gets the host)
      const indexDesc = await this.client.describeIndex(this.indexName);
      this.indexHost = indexDesc.host;
      console.log('Connected to existing index: ' + this.indexName);
      console.log('Index host: ' + this.indexHost);
    } catch (error: any) {
      // Index doesn't exist, create it
      if (error.status === 404 || error.message?.includes('not found') || error.constructor.name === 'PineconeNotFoundError') {
        console.log('Creating index: ' + this.indexName);
        await this.client.createIndex({
          name: this.indexName,
          dimension: this.dimensions,
          metric: 'cosine',
          spec: {
            serverless: {
              cloud: 'aws',
              region: 'us-east-1'
            }
          }
        });

        // Wait for index to be ready and get host
        await this.waitForIndexReady();
      } else {
        throw error;
      }
    }
  }

  /**
   * Wait for index to be ready and cache host
   */
  private async waitForIndexReady(): Promise<void> {
    console.log('Waiting for index to be ready...');
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes

    while (attempts < maxAttempts) {
      try {
        const indexDesc = await this.client.describeIndex(this.indexName);
        if (indexDesc.status?.ready) {
          this.indexHost = indexDesc.host;
          console.log('Index ready! Host: ' + this.indexHost);
          return;
        }
      } catch (error) {
        // Continue waiting
      }

      await new Promise(resolve => setTimeout(resolve, 5000));
      attempts++;
    }

    throw new Error('Timeout waiting for index to be ready');
  }

  /**
   * Upsert vectors to namespace
   * @param namespace Pinecone namespace
   * @param vectors Array of vectors with metadata
   */
  async upsert(namespace: string, vectors: PineconeVector[]): Promise<void> {
    if (!this.indexHost) {
      throw new Error('Index host not initialized. Call ensureIndex() first.');
    }

    if (vectors.length === 0) {
      return;
    }

    try {
      // Target index by host (recommended for production)
      const index = this.client.index(this.indexName, this.indexHost);
      
      // Upsert to namespace
      await index.namespace(namespace).upsert(vectors);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error('Failed to upsert vectors: ' + error.message);
      }
      throw error;
    }
  }

  /**
   * Get index statistics
   */
  async getStats(): Promise<any> {
    if (!this.indexHost) {
      throw new Error('Index host not initialized. Call ensureIndex() first.');
    }

    const index = this.client.index(this.indexName, this.indexHost);
    return await index.describeIndexStats();
  }
}
