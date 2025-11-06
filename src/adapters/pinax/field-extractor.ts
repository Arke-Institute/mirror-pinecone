/**
 * PINAX Field Extractor
 * Extracts text from pinax.json and description.md for embedding generation
 */

import type { PinaxConfig } from './config.js';

/**
 * PINAX Metadata Schema (Dublin Core-based)
 * See: pinax-schema.md for full specification
 */
export interface PinaxMetadata {
  id: string;                      // ULID or UUID - stable source record ID
  title: string;                   // Display title
  type: string;                    // DCMI Type vocabulary
  creator: string | string[];      // People/orgs who created
  institution: string;             // Owning/issuing institution
  created: string;                 // Creation date (YYYY-MM-DD or YYYY)
  language?: string;               // BCP-47 language code (e.g., "en", "en-US")
  subjects?: string[];             // Keywords/topics
  description?: string;            // Short abstract
  access_url: string;              // Click-through link
  source?: string;                 // Source system label
  rights?: string;                 // Rights statement
  place?: string | string[];       // Geographic location(s)
}

/**
 * Extract text for embedding from pinax.json and description.md
 * @param pinax PINAX metadata object
 * @param descriptionMd Optional extended description from description.md
 * @param config Configuration object
 * @returns Formatted text for embedding, truncated to limits
 *
 * @example
 * extractText(pinaxData, descriptionContent, config)
 * // Returns:
 * // "Title: Accounting Ledger
 * // Type: PhysicalObject
 * // Subjects: Accounting, Ledgers, Financial Records
 * //
 * // Extended Description:
 * // ## Overview
 * // An accounting ledger from 1898..."
 */
export function extractText(
  pinax: PinaxMetadata,
  descriptionMd: string | null,
  config: PinaxConfig
): string {
  const parts: string[] = [];

  // Title (highest weight - appears first for embedding)
  if (pinax.title && pinax.title.trim()) {
    parts.push(`Title: ${pinax.title.trim()}`);
  }

  // Type (DCMI Type vocabulary - important for categorization)
  if (pinax.type && pinax.type.trim()) {
    parts.push(`Type: ${pinax.type.trim()}`);
  }

  // Creator (attribution)
  if (pinax.creator) {
    const creators = Array.isArray(pinax.creator) ? pinax.creator : [pinax.creator];
    const creatorList = creators
      .filter(c => c && c.trim())
      .join(', ');
    if (creatorList) {
      parts.push(`Creator: ${creatorList}`);
    }
  }

  // Institution (provenance)
  if (pinax.institution && pinax.institution.trim()) {
    parts.push(`Institution: ${pinax.institution.trim()}`);
  }

  // Subjects (keywords for topical search)
  if (pinax.subjects && pinax.subjects.length > 0) {
    const subjectList = pinax.subjects
      .filter(s => s && s.trim())
      .join(', ');
    if (subjectList) {
      parts.push(`Subjects: ${subjectList}`);
    }
  }

  // Place (geographic context)
  if (pinax.place) {
    const places = Array.isArray(pinax.place) ? pinax.place : [pinax.place];
    const placeList = places
      .filter(p => p && p.trim())
      .join(', ');
    if (placeList) {
      parts.push(`Place: ${placeList}`);
    }
  }

  // Description from pinax.json (short abstract)
  if (pinax.description && pinax.description.trim()) {
    parts.push(`Description: ${pinax.description.trim()}`);
  }

  // Extended description from description.md (rich markdown content)
  if (descriptionMd && descriptionMd.trim()) {
    parts.push(`\nExtended Description:\n${descriptionMd.trim()}`);
  }

  if (parts.length === 0) {
    return '';
  }

  // Join with newlines
  const fullText = parts.join('\n');

  // Truncate to configured limits
  return truncateText(fullText, config.text_limits.max_chars, config.text_limits.max_words);
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
