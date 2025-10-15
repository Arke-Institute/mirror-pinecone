/**
 * Metadata Extractor
 * Extracts filterable metadata fields for Pinecone
 */

import _ from 'lodash';
import type { NaraConfig } from './config.js';
import { convertDate } from './date-converter.js';

export interface EntityManifest {
  pi: string;
  ver: number;
  ts: string;
  manifest_cid: string;
  components?: Record<string, string>;
  parent_pi?: string;
  children_pi?: string[];
  note?: string;
}

/**
 * Extract metadata for Pinecone
 * @param entity Catalog record data
 * @param manifest Entity manifest
 * @param ancestry Array of parent PIs (immediate to root)
 * @param config Configuration object
 * @returns Metadata object for Pinecone
 */
export function extractMetadata(
  entity: any,
  manifest: EntityManifest,
  ancestry: string[],
  config: NaraConfig
): Record<string, any> {
  const metadata: Record<string, any> = {};

  // Process each metadata field from config
  for (const [fieldName, fieldConfig] of Object.entries(config.metadata_fields)) {
    // Special case: parent_ancestry comes from resolver, not entity
    if (fieldName === 'parent_ancestry') {
      metadata[fieldName] = ancestry;
      continue;
    }

    // Special case: pi comes from manifest
    if (fieldName === 'pi') {
      metadata[fieldName] = manifest.pi;
      continue;
    }

    // Try each source path in order
    const sources = Array.isArray(fieldConfig.source) 
      ? fieldConfig.source 
      : [fieldConfig.source];

    let value: any = undefined;
    
    for (const source of sources) {
      // Check manifest first for certain fields
      if (source === 'ts') {
        value = manifest.ts;
        break;
      }

      // Then check entity/catalog
      const extracted = _.get(entity, source);
      if (extracted !== undefined && extracted !== null) {
        value = extracted;
        break;
      }
    }

    if (value === undefined || value === null) {
      continue;
    }

    // Apply type conversion
    try {
      const converted = convertValue(value, fieldConfig.type);
      if (converted !== null) {
        metadata[fieldName] = converted;
      }
    } catch (error) {
      // Skip field if conversion fails
      console.warn('Failed to convert field ' + fieldName + ':', error);
    }
  }

  return metadata;
}

/**
 * Convert value to specified type
 * @param value Raw value
 * @param type Target type
 * @returns Converted value or null
 */
function convertValue(value: any, type: string): any {
  switch (type) {
    case 'string':
      return String(value);
    
    case 'number':
      const num = Number(value);
      return isNaN(num) ? null : num;
    
    case 'date':
      if (typeof value === 'string') {
        return convertDate(value);
      }
      return null;
    
    case 'array':
      if (Array.isArray(value)) {
        return value;
      }
      return [value];
    
    default:
      return value;
  }
}
