/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * Storage adapter interface for persisting database snapshots.
 *
 * Implement this interface to provide custom storage backends for
 * database persistence. Built-in adapters include `IndexedDBStorage`.
 *
 * @example
 * ```typescript
 * const customStorage: StorageAdapter = {
 *   loadSnapshot: async (name) => {
 *     const data = localStorage.getItem(`typedb:${name}`);
 *     return data ? base64ToBytes(data) : null;
 *   },
 *   saveSnapshot: async (name, bytes) => {
 *     localStorage.setItem(`typedb:${name}`, bytesToBase64(bytes));
 *   },
 *   deleteSnapshot: async (name) => {
 *     localStorage.removeItem(`typedb:${name}`);
 *   }
 * };
 *
 * const db = await Database.open('mydb', { storage: customStorage });
 * ```
 */
export interface StorageAdapter {
  /**
   * Load a snapshot for the given database name.
   *
   * @param name - The database name
   * @returns The snapshot bytes, or null if no snapshot exists
   */
  loadSnapshot(name: string): Promise<Uint8Array | null>;

  /**
   * Save a snapshot for the given database name.
   *
   * @param name - The database name
   * @param bytes - The snapshot bytes to save
   */
  saveSnapshot(name: string, bytes: Uint8Array): Promise<void>;

  /**
   * Delete a snapshot for the given database name.
   *
   * @param name - The database name
   */
  deleteSnapshot(name: string): Promise<void>;
}

/**
 * Persistence policy for automatic snapshot saving.
 *
 * - `'manual'`: Only save when explicitly calling `db.persist()`
 * - `'onClose'`: Save when calling `db.close()` (default for storage-enabled databases)
 */
export type PersistencePolicy = 'manual' | 'onClose';

/**
 * Storage configuration options.
 *
 * @example
 * ```typescript
 * // Use IndexedDB with auto-save on close
 * const db = await Database.open('mydb', {
 *   storage: 'indexeddb',
 *   persistence: 'onClose'
 * });
 *
 * // Use custom storage with manual persistence
 * const db = await Database.open('mydb', {
 *   storage: myCustomAdapter,
 *   persistence: 'manual'
 * });
 * ```
 */
export interface StorageOptions {
  /**
   * Storage backend to use.
   *
   * - `'indexeddb'`: Use IndexedDB for persistence (works in all browsers)
   * - `StorageAdapter`: Custom storage adapter implementation
   * - `undefined`: In-memory only (no persistence)
   */
  storage?: 'indexeddb' | StorageAdapter;

  /**
   * When to automatically save snapshots.
   *
   * - `'manual'`: Only save when calling `db.persist()`
   * - `'onClose'`: Save when calling `db.close()` (default)
   *
   * @default 'onClose'
   */
  persistence?: PersistencePolicy;
}

// ============================================================================
// IndexedDB Storage Adapter
// ============================================================================

const INDEXEDDB_NAME = 'typedb-embedded';
const INDEXEDDB_VERSION = 1;
const STORE_NAME = 'snapshots';

/**
 * IndexedDB storage adapter for browser persistence.
 *
 * Stores database snapshots in the browser's IndexedDB, allowing
 * databases to survive page reloads.
 *
 * @example
 * ```typescript
 * import { IndexedDBStorage, Database } from '@typedb/embedded';
 *
 * const storage = new IndexedDBStorage();
 * const db = await Database.open('mydb', { storage });
 *
 * // Data will be loaded from IndexedDB if a snapshot exists
 * await db.execute('insert $p isa person;');
 *
 * // Save to IndexedDB
 * await db.persist();
 * ```
 */
export class IndexedDBStorage implements StorageAdapter {
  private dbPromise: Promise<IDBDatabase> | null = null;

  /**
   * Open the IndexedDB database (creates if not exists).
   */
  private async openDB(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(INDEXEDDB_NAME, INDEXEDDB_VERSION);

        request.onerror = () => {
          reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
        };

        request.onsuccess = () => {
          resolve(request.result);
        };

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'name' });
          }
        };
      });
    }
    return this.dbPromise;
  }

  /**
   * Load a snapshot from IndexedDB.
   */
  async loadSnapshot(name: string): Promise<Uint8Array | null> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(name);

      request.onerror = () => {
        reject(new Error(`Failed to load snapshot: ${request.error?.message}`));
      };

      request.onsuccess = () => {
        const result = request.result as { name: string; snapshot: Uint8Array } | undefined;
        resolve(result?.snapshot ?? null);
      };
    });
  }

  /**
   * Save a snapshot to IndexedDB.
   */
  async saveSnapshot(name: string, bytes: Uint8Array): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put({ name, snapshot: bytes });

      request.onerror = () => {
        reject(new Error(`Failed to save snapshot: ${request.error?.message}`));
      };

      request.onsuccess = () => {
        resolve();
      };
    });
  }

  /**
   * Delete a snapshot from IndexedDB.
   */
  async deleteSnapshot(name: string): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(name);

      request.onerror = () => {
        reject(new Error(`Failed to delete snapshot: ${request.error?.message}`));
      };

      request.onsuccess = () => {
        resolve();
      };
    });
  }

  /**
   * List all stored database names.
   */
  async listDatabases(): Promise<string[]> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAllKeys();

      request.onerror = () => {
        reject(new Error(`Failed to list databases: ${request.error?.message}`));
      };

      request.onsuccess = () => {
        resolve(request.result as string[]);
      };
    });
  }
}

/**
 * Resolve storage configuration to a StorageAdapter.
 *
 * @internal
 */
export function resolveStorage(
  options?: StorageOptions
): StorageAdapter | undefined {
  if (!options?.storage) {
    return undefined;
  }

  if (options.storage === 'indexeddb') {
    return new IndexedDBStorage();
  }

  return options.storage;
}
