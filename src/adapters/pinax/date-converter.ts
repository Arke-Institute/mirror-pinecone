/**
 * Date Converter
 * Normalizes dates to YYYYMMDD integer format for Pinecone metadata
 * Handles flexible PINAX date formats (ISO and year-only)
 */

/**
 * Convert flexible date string to YYYYMMDD integer
 * @param dateStr Date in YYYY-MM-DD or YYYY format
 * @returns YYYYMMDD integer or null if invalid
 *
 * @example
 * convertDate("1997-05-02") // 19970502
 * convertDate("1898")       // 18980101 (defaults to Jan 1)
 * convertDate("invalid")    // null
 */
export function convertDate(dateStr: string): number | null {
  if (!dateStr || typeof dateStr !== 'string') {
    return null;
  }

  // Try ISO format (YYYY-MM-DD)
  const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10);
    const day = parseInt(isoMatch[3], 10);

    // Basic validation
    if (year < 1000 || year > 9999) return null;
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;

    // Return as YYYYMMDD integer
    return year * 10000 + month * 100 + day;
  }

  // Try year only (YYYY)
  const yearMatch = dateStr.match(/^(\d{4})$/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1], 10);

    // Basic validation
    if (year < 1000 || year > 9999) return null;

    // Default to January 1st for year-only dates
    return year * 10000 + 101;
  }

  // No match
  return null;
}
