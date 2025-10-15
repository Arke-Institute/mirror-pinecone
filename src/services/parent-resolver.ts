/**
 * Parent Resolver
 * Walks parent chain and resolves ancestry arrays
 */

import type { ArkeClient } from './arke-client.js';

const ARKE_ROOT_PI = '00000000000000000000000000';

export class ParentResolver {
  private arkeClient: ArkeClient;
  private cache: Map<string, string[]>;

  constructor(arkeClient: ArkeClient) {
    this.arkeClient = arkeClient;
    this.cache = new Map();
  }

  /**
   * Get ancestry from immediate parent to root
   * @param pi Entity PI
   * @returns Array of parent PIs [immediate_parent, grandparent, ..., root]
   * 
   * @example
   * await resolver.getAncestry("01K7JRK9VSD7S6MN45QR745Z40")
   * // Returns: ["01K7JRF6H9WXSNM51NHS0RN9CC", "01K7JRF6D9XF6PN5436B4CECG1", ...]
   */
  async getAncestry(pi: string): Promise<string[]> {
    // Check cache
    if (this.cache.has(pi)) {
      return this.cache.get(pi)!;
    }

    try {
      const entity = await this.arkeClient.getEntity(pi);

      // No parent or reached root
      if (!entity.parent_pi || entity.parent_pi === ARKE_ROOT_PI) {
        const ancestry: string[] = [];
        this.cache.set(pi, ancestry);
        return ancestry;
      }

      // Recursively get parent's ancestry
      const parentAncestry = await this.getAncestry(entity.parent_pi);
      
      // Build ancestry: [immediate_parent, ...parent's_ancestry]
      const ancestry = [entity.parent_pi, ...parentAncestry];
      
      this.cache.set(pi, ancestry);
      return ancestry;
    } catch (error) {
      // If entity not found or error, return empty ancestry
      console.warn('Failed to resolve ancestry for ' + pi + ':', error);
      return [];
    }
  }

  /**
   * Clear cache (call periodically to prevent memory issues)
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache size
   */
  getCacheSize(): number {
    return this.cache.size;
  }
}
