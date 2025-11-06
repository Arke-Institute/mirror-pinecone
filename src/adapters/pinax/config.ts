/**
 * PINAX Configuration Loader
 * Loads and validates PINAX-specific configuration
 */

import { readFileSync } from 'fs';

export interface PinaxConfig {
  text_limits: {
    max_chars: number;
    max_words: number;
  };
  embedding_model: string;
  embedding_dimensions: number;
  batch_size: number;
}

/**
 * Load PINAX configuration from JSON file
 * @param path Path to configuration file
 * @returns Parsed and validated configuration
 * @throws Error if file cannot be read or parsed
 */
export function loadConfig(path: string): PinaxConfig {
  try {
    const content = readFileSync(path, 'utf-8');
    const config = JSON.parse(content) as PinaxConfig;

    // Basic validation
    if (!config.text_limits || typeof config.text_limits.max_chars !== 'number') {
      throw new Error('Missing or invalid text_limits');
    }

    if (typeof config.batch_size !== 'number' || config.batch_size < 1) {
      throw new Error('Invalid batch_size');
    }

    if (!config.embedding_model || typeof config.embedding_model !== 'string') {
      throw new Error('Missing or invalid embedding_model');
    }

    if (typeof config.embedding_dimensions !== 'number' || config.embedding_dimensions < 1) {
      throw new Error('Invalid embedding_dimensions');
    }

    return config;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load config from ${path}: ${error.message}`);
    }
    throw error;
  }
}
