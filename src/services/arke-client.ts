/**
 * Arke Client
 * Fetches entity manifests and catalog data from Arke IPFS API
 */

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

export interface EntityWithCatalog {
  manifest: EntityManifest;
  catalog: any;
}

export class ArkeClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
  }

  /**
   * Fetch entity manifest
   * @param pi Entity persistent identifier
   * @returns Entity manifest
   */
  async getEntity(pi: string): Promise<EntityManifest> {
    const url = this.baseUrl + '/entities/' + pi;
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Entity not found: ' + pi);
      }
      throw new Error('Failed to fetch entity ' + pi + ': ' + response.statusText);
    }

    return await response.json() as EntityManifest;
  }

  /**
   * Fetch catalog record by CID
   * @param cid IPFS CID
   * @returns Catalog data (JSON)
   */
  async getCatalogRecord(cid: string): Promise<any> {
    const url = this.baseUrl + '/cat/' + cid;
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Catalog record not found: ' + cid);
      }
      throw new Error('Failed to fetch catalog ' + cid + ': ' + response.statusText);
    }

    return await response.json();
  }

  /**
   * Fetch entity with resolved catalog data
   * @param pi Entity persistent identifier
   * @returns Entity manifest and catalog data
   */
  async getEntityWithCatalog(pi: string): Promise<EntityWithCatalog> {
    // Fetch manifest
    const manifest = await this.getEntity(pi);

    // Determine which component key contains the catalog
    const catalogKey = this.getCatalogKey(manifest);
    if (!catalogKey) {
      throw new Error('No catalog component found in entity ' + pi);
    }

    const catalogCid = manifest.components![catalogKey];
    const catalog = await this.getCatalogRecord(catalogCid);

    return {
      manifest,
      catalog
    };
  }

  /**
   * Determine which component key contains the catalog record
   * Tries: catalog_record, metadata, digital_object_metadata
   */
  private getCatalogKey(manifest: EntityManifest): string | null {
    if (!manifest.components) {
      return null;
    }

    const keys = ['catalog_record', 'metadata', 'digital_object_metadata'];
    for (const key of keys) {
      if (key in manifest.components) {
        return key;
      }
    }

    return null;
  }
}
