/**
 * PINAX Metadata Extractor
 * Extracts filterable metadata fields for Pinecone from PINAX data
 */

import { convertDate } from './date-converter.js';
import type { PinaxMetadata } from './field-extractor.js';

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
 * Extract metadata for Pinecone from PINAX data, manifest, and ancestry
 * @param pinax PINAX metadata object
 * @param manifest Entity manifest
 * @param ancestry Array of parent PIs (immediate to root)
 * @returns Metadata object for Pinecone with all filterable fields
 *
 * @example
 * extractMetadata(pinaxData, manifest, ["parent1", "parent2"])
 * // Returns: { pi, ver, title, type, creator, institution, created_date, ... }
 */
export function extractMetadata(
  pinax: PinaxMetadata,
  manifest: EntityManifest,
  ancestry: string[]
): Record<string, any> {
  const metadata: Record<string, any> = {
    // Entity identifiers (from manifest)
    pi: manifest.pi,
    ver: manifest.ver,

    // Core PINAX fields (from pinax.json)
    title: pinax.title || '',
    type: pinax.type || '',
    institution: pinax.institution || '',
    language: pinax.language || '',
    source: pinax.source || '',

    // Parent relationships (from ParentResolver)
    parent_ancestry: ancestry,

    // Timestamps (from manifest)
    last_updated: manifest.ts,
  };

  // Creator (handle both string and array)
  if (pinax.creator) {
    if (Array.isArray(pinax.creator)) {
      // Store array for multiple creators
      metadata.creator = pinax.creator;
      // Also store first creator as string for simple filtering
      if (pinax.creator.length > 0 && pinax.creator[0]) {
        metadata.creator_primary = pinax.creator[0];
      }
    } else {
      // Single creator
      metadata.creator = pinax.creator;
      metadata.creator_primary = pinax.creator;
    }
  } else {
    metadata.creator = '';
    metadata.creator_primary = '';
  }

  // Subjects (array of keywords)
  if (pinax.subjects && pinax.subjects.length > 0) {
    metadata.subjects = pinax.subjects;
  } else {
    metadata.subjects = [];
  }

  // Place (handle both string and array)
  if (pinax.place) {
    if (Array.isArray(pinax.place)) {
      metadata.place = pinax.place;
    } else {
      metadata.place = [pinax.place];
    }
  } else {
    metadata.place = [];
  }

  // Rights (optional)
  if (pinax.rights) {
    metadata.rights = pinax.rights;
  }

  // Description (optional, for display)
  if (pinax.description) {
    metadata.description = pinax.description;
  }

  // Parent PI (from manifest)
  if (manifest.parent_pi) {
    metadata.parent_pi = manifest.parent_pi;
  }

  // Created date - convert to YYYYMMDD integer for range filtering
  if (pinax.created) {
    const dateInt = convertDate(pinax.created);
    if (dateInt !== null) {
      metadata.created_date = dateInt;
    }
    // Also store original string for reference
    metadata.created_original = pinax.created;
  }

  // Access URL (from pinax.json)
  if (pinax.access_url) {
    metadata.access_url = pinax.access_url;
  }

  // PINAX ID (stable record identifier)
  if (pinax.id) {
    metadata.pinax_id = pinax.id;
  }

  return metadata;
}
