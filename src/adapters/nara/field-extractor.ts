/**
 * Field Extractor
 * Extracts text from entities for embedding generation
 */

import _ from 'lodash';
import type { NaraConfig } from './config.js';

/**
 * Extract text fields for embedding
 * @param entity Catalog record data
 * @param schemaType Schema type (e.g., "fileUnit", "series")
 * @param config Configuration object
 * @returns Extracted and formatted text, truncated to limits
 * 
 * @example
 * extractText(catalogRecord, "fileUnit", config)
 * // Returns:
 * // "title: Bosnia Trip - Address to People of Bosnia 1/11/96
 * // access_restriction.note: These records may need to be screened...
 * // ancestors.title: Records of the National Security Council..."
 */
export function extractText(
  entity: any,
  schemaType: string,
  config: NaraConfig
): string {
  if (!entity || typeof entity !== 'object') {
    return '';
  }

  // Get field paths for this schema type
  const fieldPaths = config.embedding_fields[schemaType];
  if (!fieldPaths || !Array.isArray(fieldPaths)) {
    return '';
  }

  const extractedParts: string[] = [];

  for (const path of fieldPaths) {
    const values = extractValuesFromPath(entity, path);
    if (values.length > 0) {
      // Format: "field_name: value1\nfield_name: value2"
      const fieldName = path.split('.').pop() || path;
      for (const value of values) {
        if (value && typeof value === 'string' && value.trim()) {
          extractedParts.push(fieldName + ': ' + value.trim());
        }
      }
    }
  }

  if (extractedParts.length === 0) {
    return '';
  }

  // Join with newlines
  const fullText = extractedParts.join('\n');

  // Truncate to limits
  return truncateText(fullText, config.text_limits.max_chars, config.text_limits.max_words);
}

/**
 * Extract values from a JSON path (handles arrays and nested structures)
 * @param obj Source object
 * @param path Dot-notation path (e.g., "nara_full_metadata.ancestors.title")
 * @returns Array of extracted string values
 */
function extractValuesFromPath(obj: any, path: string): string[] {
  const values: string[] = [];

  // Handle simple paths first
  const value = _.get(obj, path);
  
  if (value !== undefined && value !== null) {
    if (typeof value === 'string') {
      values.push(value);
    } else if (Array.isArray(value)) {
      // Array of strings
      for (const item of value) {
        if (typeof item === 'string') {
          values.push(item);
        }
      }
    }
    return values;
  }

  // Handle paths that traverse arrays (e.g., "ancestors.title")
  const parts = path.split('.');
  const results = traversePath(obj, parts);
  
  for (const result of results) {
    if (typeof result === 'string') {
      values.push(result);
    }
  }

  return values;
}

/**
 * Recursively traverse a path through nested objects and arrays
 * @param obj Current object
 * @param parts Remaining path parts
 * @returns Array of values found at the end of the path
 */
function traversePath(obj: any, parts: string[]): any[] {
  if (!obj || parts.length === 0) {
    return [obj];
  }

  const [current, ...remaining] = parts;
  
  if (Array.isArray(obj)) {
    // Traverse into all array elements
    const results: any[] = [];
    for (const item of obj) {
      if (item && typeof item === 'object') {
        results.push(...traversePath(item, parts));
      }
    }
    return results;
  }

  if (typeof obj === 'object' && current in obj) {
    return traversePath(obj[current], remaining);
  }

  return [];
}

/**
 * Truncate text to character and word limits
 * @param text Input text
 * @param maxChars Maximum characters
 * @param maxWords Maximum words
 * @returns Truncated text
 */
function truncateText(text: string, maxChars: number, maxWords: number): string {
  if (!text) return '';

  // Truncate by characters first
  let truncated = text;
  if (text.length > maxChars) {
    truncated = text.substring(0, maxChars);
  }

  // Truncate by words
  const words = truncated.split(/\s+/);
  if (words.length > maxWords) {
    truncated = words.slice(0, maxWords).join(' ');
  }

  return truncated;
}
