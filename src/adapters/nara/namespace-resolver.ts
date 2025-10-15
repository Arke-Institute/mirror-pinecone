/**
 * Namespace Resolver
 * Maps schema strings to Pinecone namespaces
 */

import type { NaraConfig } from './config.js';

/**
 * Get Pinecone namespace for schema
 * @param schema Schema string (e.g., "nara-fileunit@v1")
 * @param config Configuration object
 * @returns Namespace string (e.g., "fileUnit")
 * 
 * @example
 * getNamespace("nara-fileunit@v1", config) // "fileUnit"
 * getNamespace("nara-series@v1", config) // "series"
 * getNamespace("unknown-schema", config) // "unknown"
 */
export function getNamespace(schema: string, config: NaraConfig): string {
  if (!schema || typeof schema !== 'string') {
    return 'unknown';
  }

  // Look up in namespace mapping
  const namespace = config.namespace_mapping[schema];
  
  if (namespace) {
    return namespace;
  }

  // Fallback: extract type from schema string
  // Format: "nara-{type}@v{version}" -> "{type}"
  const match = schema.match(/^nara-([^@]+)@/);
  if (match) {
    return match[1];
  }

  return 'unknown';
}
