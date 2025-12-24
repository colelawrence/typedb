/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { Database } from "./database.ts";

// --- Types ---

/** Supported value types for custom properties */
export type ScalarKind = "string" | "integer" | "double" | "boolean" | "datetime";

/** Definition of a custom collection (dynamic table) */
export interface CustomCollectionDef {
  id: string;
  displayName: string;
  typeName: string;
  description?: string;
  icon?: string;
  createdAt: Date;
  archived: boolean;
}

/** Definition of a custom property (dynamic column) */
export interface CustomPropertyDef {
  id: string;
  displayName: string;
  typeName: string;
  kind: ScalarKind;
  order: number;
  createdAt: Date;
  archived: boolean;
}

// --- Shared Helpers ---

function generateShortId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function formatDatetime(date: Date): string {
  return date.toISOString().slice(0, 19);
}

function parseDatetime(str: string): Date {
  return new Date(str);
}

function escapeString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Check if an error indicates a schema element doesn't exist (expected) vs other failures */
function isNotFoundError(e: unknown): boolean {
  const msg = String(e);
  return msg.includes("not found") || msg.includes("unknown") || msg.includes("does not exist");
}

async function fetchOptionalAttribute(
  db: Database,
  entityType: string,
  keyAttr: string,
  keyValue: string,
  targetAttr: string,
  varName: string,
): Promise<string | undefined> {
  try {
    const result = await db.query(
      `match $e isa ${entityType}, has ${keyAttr} "${keyValue}", has ${targetAttr} $${varName};`,
    );
    if (result.rowCount > 0) {
      return result.rows[0]![varName]!.asString();
    }
  } catch (e) {
    if (!isNotFoundError(e)) {
      console.error(`[dynamic-schema] fetchOptionalAttribute failed:`, e);
      throw e;
    }
    // Attribute doesn't exist - expected for optional fields
  }
  return undefined;
}

async function updateAttribute(
  db: Database,
  entityType: string,
  keyAttr: string,
  keyValue: string,
  targetAttr: string,
  newValue: unknown,
): Promise<void> {
  const escapedValue = typeof newValue === "string" ? `"${escapeString(newValue)}"` : String(newValue);

  await db.execute(`
    match
      $e isa ${entityType}, has ${keyAttr} "${keyValue}", has ${targetAttr} $old;
    delete
      has $old of $e;
    insert
      $e has ${targetAttr} ${escapedValue};
  `);
}

async function upsertOptionalAttribute(
  db: Database,
  entityType: string,
  keyAttr: string,
  keyValue: string,
  targetAttr: string,
  newValue: string,
): Promise<void> {
  const escapedValue = `"${escapeString(newValue)}"`;

  const existsResult = await db.query(
    `match $e isa ${entityType}, has ${keyAttr} "${keyValue}", has ${targetAttr} $old;`,
  );

  if (existsResult.rowCount > 0) {
    await db.execute(`
      match
        $e isa ${entityType}, has ${keyAttr} "${keyValue}", has ${targetAttr} $old;
      delete
        has $old of $e;
      insert
        $e has ${targetAttr} ${escapedValue};
    `);
  } else {
    await db.execute(`
      match
        $e isa ${entityType}, has ${keyAttr} "${keyValue}";
      insert
        $e has ${targetAttr} ${escapedValue};
    `);
  }
}

// --- CustomCollectionManager ---

/**
 * Manages dynamic collections (user-created "tables") in TypeDB.
 *
 * Each collection is stored as:
 * 1. A custom_collection metadata entity (stores display name, description, etc.)
 * 2. A dynamically created TypeDB entity type: col_dyn_<uuid8>
 */
export class CustomCollectionManager {
  constructor(private db: Database) {}

  async createCollection(input: {
    displayName: string;
    description?: string;
    icon?: string;
  }): Promise<CustomCollectionDef> {
    const id = crypto.randomUUID();
    const shortId = generateShortId();
    const typeName = `col_dyn_${shortId}`;
    const now = new Date();

    await this.db.define(`define entity ${typeName};`);

    const descriptionAttr = input.description
      ? `, has ccoll_description "${escapeString(input.description)}"`
      : "";
    const iconAttr = input.icon ? `, has ccoll_icon "${escapeString(input.icon)}"` : "";

    await this.db.execute(`
      insert $c isa custom_collection,
        has ccoll_id "${id}",
        has ccoll_display_name "${escapeString(input.displayName)}",
        has ccoll_type_name "${typeName}",
        has ccoll_created_at ${formatDatetime(now)},
        has ccoll_archived false${descriptionAttr}${iconAttr};
    `);

    return {
      id,
      displayName: input.displayName,
      typeName,
      description: input.description,
      icon: input.icon,
      createdAt: now,
      archived: false,
    };
  }

  async listCollections(options?: { includeArchived?: boolean }): Promise<CustomCollectionDef[]> {
    const archivedFilter = options?.includeArchived ? "" : ", has ccoll_archived false";

    const result = await this.db.query(`
      match $c isa custom_collection,
        has ccoll_id $id,
        has ccoll_display_name $displayName,
        has ccoll_type_name $typeName,
        has ccoll_created_at $createdAt,
        has ccoll_archived $archived${archivedFilter};
    `);

    const collections: CustomCollectionDef[] = [];
    for (const row of result.rows) {
      const id = row.id.asString();
      const description = await fetchOptionalAttribute(this.db, "custom_collection", "ccoll_id", id, "ccoll_description", "v");
      const icon = await fetchOptionalAttribute(this.db, "custom_collection", "ccoll_id", id, "ccoll_icon", "v");

      collections.push({
        id,
        displayName: row.displayName.asString(),
        typeName: row.typeName.asString(),
        description,
        icon,
        createdAt: parseDatetime(row.createdAt.asDateTime()),
        archived: row.archived.asBoolean(),
      });
    }

    return collections;
  }

  async getCollectionById(id: string): Promise<CustomCollectionDef | null> {
    const result = await this.db.query(`
      match $c isa custom_collection,
        has ccoll_id "${id}",
        has ccoll_display_name $displayName,
        has ccoll_type_name $typeName,
        has ccoll_created_at $createdAt,
        has ccoll_archived $archived;
    `);

    if (result.rowCount === 0) return null;
    const row = result.rows[0]!;

    const description = await fetchOptionalAttribute(this.db, "custom_collection", "ccoll_id", id, "ccoll_description", "v");
    const icon = await fetchOptionalAttribute(this.db, "custom_collection", "ccoll_id", id, "ccoll_icon", "v");

    return {
      id,
      displayName: row.displayName.asString(),
      typeName: row.typeName.asString(),
      description,
      icon,
      createdAt: parseDatetime(row.createdAt.asDateTime()),
      archived: row.archived.asBoolean(),
    };
  }

  async getCollectionByName(displayName: string): Promise<CustomCollectionDef | null> {
    const result = await this.db.query(`
      match $c isa custom_collection,
        has ccoll_id $id,
        has ccoll_display_name "${escapeString(displayName)}",
        has ccoll_type_name $typeName,
        has ccoll_created_at $createdAt,
        has ccoll_archived $archived;
    `);

    if (result.rowCount === 0) return null;
    const row = result.rows[0]!;
    const id = row.id.asString();

    const description = await fetchOptionalAttribute(this.db, "custom_collection", "ccoll_id", id, "ccoll_description", "v");
    const icon = await fetchOptionalAttribute(this.db, "custom_collection", "ccoll_id", id, "ccoll_icon", "v");

    return {
      id,
      displayName,
      typeName: row.typeName.asString(),
      description,
      icon,
      createdAt: parseDatetime(row.createdAt.asDateTime()),
      archived: row.archived.asBoolean(),
    };
  }

  async updateCollection(
    id: string,
    updates: Partial<{ displayName: string; description: string; icon: string }>,
  ): Promise<void> {
    if (updates.displayName !== undefined) {
      await updateAttribute(this.db, "custom_collection", "ccoll_id", id, "ccoll_display_name", updates.displayName);
    }
    if (updates.description !== undefined) {
      await upsertOptionalAttribute(this.db, "custom_collection", "ccoll_id", id, "ccoll_description", updates.description);
    }
    if (updates.icon !== undefined) {
      await upsertOptionalAttribute(this.db, "custom_collection", "ccoll_id", id, "ccoll_icon", updates.icon);
    }
  }

  async archiveCollection(id: string): Promise<void> {
    await updateAttribute(this.db, "custom_collection", "ccoll_id", id, "ccoll_archived", true);
  }

  async unarchiveCollection(id: string): Promise<void> {
    await updateAttribute(this.db, "custom_collection", "ccoll_id", id, "ccoll_archived", false);
  }

  getPropertyManager(collectionId: string, collectionTypeName: string): CustomPropertyManager {
    return new CustomPropertyManager(this.db, collectionId, collectionTypeName);
  }
}

// --- CustomPropertyManager ---

/**
 * Manages dynamic properties (user-created "columns") for a specific collection.
 *
 * Each property is stored as:
 * 1. A custom_property metadata entity (stores display name, type, order, etc.)
 * 2. A dynamically created TypeDB attribute type: <collection>__cust_<uuid8>
 * 3. An 'owns' clause on the collection's entity type
 */
export class CustomPropertyManager {
  constructor(
    private db: Database,
    private collectionId: string,
    private collectionTypeName: string,
  ) {}

  async createProperty(input: { displayName: string; kind: ScalarKind; order?: number }): Promise<CustomPropertyDef> {
    const id = crypto.randomUUID();
    const shortId = generateShortId();
    const typeName = `${this.collectionTypeName}__cust_${shortId}`;
    const now = new Date();
    const order = input.order ?? (await this.getNextOrder());

    await this.db.define(`define attribute ${typeName} value ${input.kind};`);
    await this.db.define(`define ${this.collectionTypeName} owns ${typeName};`);

    await this.db.execute(`
      insert $p isa custom_property,
        has cprop_id "${id}",
        has cprop_display_name "${escapeString(input.displayName)}",
        has cprop_type_name "${typeName}",
        has cprop_value_kind "${input.kind}",
        has cprop_order ${order},
        has cprop_created_at ${formatDatetime(now)},
        has cprop_archived false;
    `);

    await this.db.execute(`
      match
        $c isa custom_collection, has ccoll_id "${this.collectionId}";
        $p isa custom_property, has cprop_id "${id}";
      insert
        (collection: $c, property: $p) isa collection_has_property;
    `);

    return { id, displayName: input.displayName, typeName, kind: input.kind, order, createdAt: now, archived: false };
  }

  async listProperties(options?: { includeArchived?: boolean }): Promise<CustomPropertyDef[]> {
    const archivedFilter = options?.includeArchived ? "" : ", has cprop_archived false";

    const result = await this.db.query(`
      match
        $c isa custom_collection, has ccoll_id "${this.collectionId}";
        (collection: $c, property: $p) isa collection_has_property;
        $p has cprop_id $id,
           has cprop_display_name $displayName,
           has cprop_type_name $typeName,
           has cprop_value_kind $kind,
           has cprop_order $order,
           has cprop_created_at $createdAt,
           has cprop_archived $archived${archivedFilter};
    `);

    return result.rows.map((row) => ({
      id: row.id.asString(),
      displayName: row.displayName.asString(),
      typeName: row.typeName.asString(),
      kind: row.kind.asString() as ScalarKind,
      order: row.order.asInteger(),
      createdAt: parseDatetime(row.createdAt.asDateTime()),
      archived: row.archived.asBoolean(),
    }));
  }

  async getPropertyById(id: string): Promise<CustomPropertyDef | null> {
    const result = await this.db.query(`
      match
        $c isa custom_collection, has ccoll_id "${this.collectionId}";
        (collection: $c, property: $p) isa collection_has_property;
        $p has cprop_id "${id}",
           has cprop_display_name $displayName,
           has cprop_type_name $typeName,
           has cprop_value_kind $kind,
           has cprop_order $order,
           has cprop_created_at $createdAt,
           has cprop_archived $archived;
    `);

    if (result.rowCount === 0) return null;
    const row = result.rows[0]!;

    return {
      id,
      displayName: row.displayName.asString(),
      typeName: row.typeName.asString(),
      kind: row.kind.asString() as ScalarKind,
      order: row.order.asInteger(),
      createdAt: parseDatetime(row.createdAt.asDateTime()),
      archived: row.archived.asBoolean(),
    };
  }

  async getPropertyByName(displayName: string): Promise<CustomPropertyDef | null> {
    const result = await this.db.query(`
      match
        $c isa custom_collection, has ccoll_id "${this.collectionId}";
        (collection: $c, property: $p) isa collection_has_property;
        $p has cprop_id $id,
           has cprop_display_name "${escapeString(displayName)}",
           has cprop_type_name $typeName,
           has cprop_value_kind $kind,
           has cprop_order $order,
           has cprop_created_at $createdAt,
           has cprop_archived $archived;
    `);

    if (result.rowCount === 0) return null;
    const row = result.rows[0]!;

    return {
      id: row.id.asString(),
      displayName,
      typeName: row.typeName.asString(),
      kind: row.kind.asString() as ScalarKind,
      order: row.order.asInteger(),
      createdAt: parseDatetime(row.createdAt.asDateTime()),
      archived: row.archived.asBoolean(),
    };
  }

  async resolvePropertyName(displayName: string): Promise<string | null> {
    const prop = await this.getPropertyByName(displayName);
    return prop?.typeName ?? null;
  }

  async updateProperty(id: string, updates: Partial<{ displayName: string; order: number }>): Promise<void> {
    if (updates.displayName !== undefined) {
      await updateAttribute(this.db, "custom_property", "cprop_id", id, "cprop_display_name", updates.displayName);
    }
    if (updates.order !== undefined) {
      await updateAttribute(this.db, "custom_property", "cprop_id", id, "cprop_order", updates.order);
    }
  }

  async archiveProperty(id: string): Promise<void> {
    await updateAttribute(this.db, "custom_property", "cprop_id", id, "cprop_archived", true);
  }

  async unarchiveProperty(id: string): Promise<void> {
    await updateAttribute(this.db, "custom_property", "cprop_id", id, "cprop_archived", false);
  }

  private async getNextOrder(): Promise<number> {
    const result = await this.db.query(`
      match
        $c isa custom_collection, has ccoll_id "${this.collectionId}";
        (collection: $c, property: $p) isa collection_has_property;
        $p has cprop_order $order;
    `);

    if (result.rowCount === 0) return 0;

    let maxOrder = 0;
    for (const row of result.rows) {
      const order = row.order.asInteger();
      if (order > maxOrder) maxOrder = order;
    }
    return maxOrder + 1;
  }
}

// --- Re-exports ---

export {
  initializeDynamicSchema,
  isDynamicSchemaInitialized,
  ensureDynamicSchemaInitialized,
  DYNAMIC_SCHEMA_DEFINITION,
} from "./dynamic-schema-bootstrap.js";
