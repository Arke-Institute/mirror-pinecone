/**
 * Date Converter
 * Normalizes dates to YYYYMMDD integer format for Pinecone metadata
 */

/**
 * Convert date string to YYYYMMDD integer
 * @param dateStr Date in YYYY-MM-DD format
 * @returns YYYYMMDD integer or null if invalid
 * 
 * @example
 * convertDate("1993-01-01") // 19930101
 * convertDate("2001-12-31") // 20011231
 * convertDate("invalid") // null
 */
export function convertDate(dateStr: string): number | null {
  if (!dateStr || typeof dateStr !== 'string') {
    return null;
  }

  // Parse YYYY-MM-DD format
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  // Basic validation
  if (year < 1000 || year > 9999) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  // Return as YYYYMMDD integer
  return year * 10000 + month * 100 + day;
}
