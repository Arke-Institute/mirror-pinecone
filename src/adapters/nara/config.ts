/**
 * NARA Configuration Loader
 * Loads and validates NARA-specific configuration
 */

import { readFileSync } from 'fs';

export interface FieldConfig {
  source: string | string[];
  type: 'string' | 'number' | 'date' | 'array';
  format?: string;
  description?: string;
}

export interface NaraConfig {
  embedding_fields: Record<string, string[]>;
  metadata_fields: Record<string, FieldConfig>;
  namespace_mapping: Record<string, string>;
  text_limits: {
    max_chars: number;
    max_words: number;
  };
  batch_size: number;
  embedding_model: string;
  embedding_dimensions: number;
}

/**
 * Load NARA configuration from JSON file
 * @param path Path to configuration file
 * @returns Parsed and validated configuration
 * @throws Error if file cannot be read or parsed
 */
export function loadConfig(path: string): NaraConfig {
  try {
    const content = readFileSync(path, 'utf-8');
    const config = JSON.parse(content) as NaraConfig;

    // Basic validation
    if (!config.embedding_fields || typeof config.embedding_fields !== 'object') {
      throw new Error('Missing or invalid embedding_fields');
    }

    if (!config.metadata_fields || typeof config.metadata_fields !== 'object') {
      throw new Error('Missing or invalid metadata_fields');
    }

    if (!config.namespace_mapping || typeof config.namespace_mapping !== 'object') {
      throw new Error('Missing or invalid namespace_mapping');
    }

    if (!config.text_limits || typeof config.text_limits.max_chars !== 'number') {
      throw new Error('Missing or invalid text_limits');
    }

    if (typeof config.batch_size !== 'number' || config.batch_size < 1) {
      throw new Error('Invalid batch_size');
    }

    return config;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load config from ${path}: ${error.message}`);
    }
    throw error;
  }
}
