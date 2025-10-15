/**
 * OpenAI Client
 * Generates embeddings via OpenAI API
 */

import OpenAI from 'openai';

export class OpenAIClient {
  private client: OpenAI;
  private model: string;
  private dimensions: number;

  constructor(apiKey: string, model: string = 'text-embedding-3-small', dimensions: number = 768) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
    this.dimensions = dimensions;
  }

  /**
   * Generate embeddings for batch of texts
   * @param texts Array of text strings to embed
   * @returns Array of embedding vectors (float arrays)
   * 
   * @example
   * const embeddings = await client.createEmbeddings(['text1', 'text2']);
   * // Returns: [[0.1, 0.2, ...], [0.3, 0.4, ...]]
   */
  async createEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: texts,
        dimensions: this.dimensions,
        encoding_format: 'float'
      });

      return response.data.map(item => item.embedding);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error('Failed to create embeddings: ' + error.message);
      }
      throw error;
    }
  }
}
