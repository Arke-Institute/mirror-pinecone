/**
 * PINAX Namespace Resolver
 * Maps institution names to Pinecone namespaces
 */

/**
 * Get Pinecone namespace from institution name
 * Converts institution name to URL-safe namespace identifier
 *
 * @param institution Institution name from pinax.json
 * @returns Normalized namespace string (lowercase, hyphen-separated)
 *
 * @example
 * getNamespace("Georgetown University") // "georgetown-university"
 * getNamespace("Arke Institute") // "arke-institute"
 * getNamespace("National Archives & Records Administration") // "national-archives-records-administration"
 * getNamespace("") // "unknown"
 * getNamespace("  ") // "unknown"
 */
export function getNamespace(institution: string): string {
  if (!institution || typeof institution !== 'string' || !institution.trim()) {
    return 'unknown';
  }

  // Normalize to lowercase, replace spaces/special chars with hyphens
  const normalized = institution
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')  // Replace non-alphanumeric with hyphen
    .replace(/^-+|-+$/g, '')      // Remove leading/trailing hyphens
    .replace(/-+/g, '-');         // Collapse multiple hyphens

  // Return normalized or 'unknown' if empty after normalization
  return normalized || 'unknown';
}
