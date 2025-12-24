/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { Database } from "./database.ts";
import type { ScalarKind } from "./dynamic-schema.ts";

// --- Types ---

/** Source of a resolved property (static from meta-graph or dynamic from custom_property) */
export type PropertySource = "static" | "dynamic";

/** A resolved property with its TypeQL type name and metadata */
export interface ResolvedProperty {
  displayName: string;
  typeName: string;
  kind: ScalarKind;
  source: PropertySource;
  order?: number;
}

/** Static property definition from meta-graph schema */
export interface StaticPropertyDef {
  displayName: string;
  typeName: string;
  kind: ScalarKind;
}

/** A resolved collection with its TypeQL type name and metadata */
export interface ResolvedCollection {
  displayName: string;
  typeName: string;
  source: PropertySource;
  description?: string;
  icon?: string;
}

// --- Helpers ---

function escapeString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function isNotFoundError(e: unknown): boolean {
  const msg = String(e);
  return msg.includes("not found") || msg.includes("unknown") || msg.includes("does not exist");
}

async function fetchOptionalStringAttr(
  db: Database,
  entityType: string,
  keyAttr: string,
  keyValue: string,
  targetAttr: string,
): Promise<string | undefined> {
  try {
    const result = await db.query(
      `match $e isa ${entityType}, has ${keyAttr} "${keyValue}", has ${targetAttr} $v;`,
    );
    if (result.rowCount > 0) {
      return result.rows[0]!.v.asString();
    }
  } catch (e) {
    if (!isNotFoundError(e)) {
      console.error(`[property-resolver] fetchOptionalStringAttr failed:`, e);
      throw e;
    }
  }
  return undefined;
}

// --- PropertyResolver ---

/**
 * Unified property resolver for static + dynamic properties.
 * Resolves user-facing property names to TypeQL attribute type names.
 */
export class PropertyResolver {
  private staticPropsMap: Map<string, StaticPropertyDef>;

  constructor(
    private db: Database,
    private collectionTypeName: string,
    staticProperties: StaticPropertyDef[] = [],
  ) {
    this.staticPropsMap = new Map(staticProperties.map((p) => [p.displayName.toLowerCase(), p]));
  }

  async resolve(displayName: string): Promise<ResolvedProperty | null> {
    const staticProp = this.staticPropsMap.get(displayName.toLowerCase());
    if (staticProp) {
      return {
        displayName: staticProp.displayName,
        typeName: staticProp.typeName,
        kind: staticProp.kind,
        source: "static",
      };
    }
    return this.resolveDynamicProperty(displayName);
  }

  async listAll(): Promise<ResolvedProperty[]> {
    const result: ResolvedProperty[] = [];

    for (const prop of this.staticPropsMap.values()) {
      result.push({
        displayName: prop.displayName,
        typeName: prop.typeName,
        kind: prop.kind,
        source: "static",
      });
    }

    const dynamicProps = await this.listDynamicProperties();
    result.push(...dynamicProps);

    return result;
  }

  async resolveByTypeName(typeName: string): Promise<ResolvedProperty | null> {
    for (const prop of this.staticPropsMap.values()) {
      if (prop.typeName === typeName) {
        return {
          displayName: prop.displayName,
          typeName: prop.typeName,
          kind: prop.kind,
          source: "static",
        };
      }
    }
    return this.resolveDynamicPropertyByTypeName(typeName);
  }

  private async resolveDynamicProperty(displayName: string): Promise<ResolvedProperty | null> {
    try {
      const result = await this.db.query(`
        match
          $c isa custom_collection, has ccoll_type_name "${this.collectionTypeName}";
          (collection: $c, property: $p) isa collection_has_property;
          $p has cprop_display_name "${escapeString(displayName)}",
             has cprop_type_name $typeName,
             has cprop_value_kind $kind,
             has cprop_order $order,
             has cprop_archived false;
      `);

      if (result.rowCount === 0) return null;
      const row = result.rows[0]!;

      return {
        displayName,
        typeName: row.typeName.asString(),
        kind: row.kind.asString() as ScalarKind,
        source: "dynamic",
        order: row.order.asInteger(),
      };
    } catch (e) {
      if (!isNotFoundError(e)) {
        console.error(`[property-resolver] resolveDynamicProperty failed for "${displayName}":`, e);
        throw e;
      }
      return null;
    }
  }

  private async resolveDynamicPropertyByTypeName(typeName: string): Promise<ResolvedProperty | null> {
    try {
      const result = await this.db.query(`
        match
          $c isa custom_collection, has ccoll_type_name "${this.collectionTypeName}";
          (collection: $c, property: $p) isa collection_has_property;
          $p has cprop_display_name $displayName,
             has cprop_type_name "${typeName}",
             has cprop_value_kind $kind,
             has cprop_order $order,
             has cprop_archived false;
      `);

      if (result.rowCount === 0) return null;
      const row = result.rows[0]!;

      return {
        displayName: row.displayName.asString(),
        typeName,
        kind: row.kind.asString() as ScalarKind,
        source: "dynamic",
        order: row.order.asInteger(),
      };
    } catch (e) {
      if (!isNotFoundError(e)) {
        console.error(`[property-resolver] resolveDynamicPropertyByTypeName failed for "${typeName}":`, e);
        throw e;
      }
      return null;
    }
  }

  private async listDynamicProperties(): Promise<ResolvedProperty[]> {
    try {
      const result = await this.db.query(`
        match
          $c isa custom_collection, has ccoll_type_name "${this.collectionTypeName}";
          (collection: $c, property: $p) isa collection_has_property;
          $p has cprop_display_name $displayName,
             has cprop_type_name $typeName,
             has cprop_value_kind $kind,
             has cprop_order $order,
             has cprop_archived false;
      `);

      return result.rows.map((row) => ({
        displayName: row.displayName.asString(),
        typeName: row.typeName.asString(),
        kind: row.kind.asString() as ScalarKind,
        source: "dynamic" as const,
        order: row.order.asInteger(),
      }));
    } catch (e) {
      if (!isNotFoundError(e)) {
        console.error(`[property-resolver] listDynamicProperties failed:`, e);
        throw e;
      }
      return [];
    }
  }
}

// --- Collection Resolution ---

export async function resolveCollection(
  db: Database,
  nameOrType: string,
  staticCollections: Map<string, string> = new Map(),
): Promise<ResolvedCollection | null> {
  const staticTypeName = staticCollections.get(nameOrType);
  if (staticTypeName) {
    return { displayName: nameOrType, typeName: staticTypeName, source: "static" };
  }

  for (const [displayName, typeName] of staticCollections) {
    if (typeName === nameOrType) {
      return { displayName, typeName, source: "static" };
    }
  }

  return resolveDynamicCollection(db, nameOrType);
}

async function resolveDynamicCollection(db: Database, nameOrType: string): Promise<ResolvedCollection | null> {
  try {
    let result = await db.query(`
      match $c isa custom_collection,
        has ccoll_display_name "${escapeString(nameOrType)}",
        has ccoll_type_name $typeName,
        has ccoll_archived false;
    `);

    if (result.rowCount === 0) {
      result = await db.query(`
        match $c isa custom_collection,
          has ccoll_display_name $displayName,
          has ccoll_type_name "${nameOrType}",
          has ccoll_archived false;
      `);
    }

    if (result.rowCount === 0) return null;
    const row = result.rows[0]!;
    const typeName = row.typeName?.asString() ?? nameOrType;

    const description = await fetchOptionalStringAttr(db, "custom_collection", "ccoll_type_name", typeName, "ccoll_description");
    const icon = await fetchOptionalStringAttr(db, "custom_collection", "ccoll_type_name", typeName, "ccoll_icon");

    return {
      displayName: row.displayName?.asString() ?? nameOrType,
      typeName,
      source: "dynamic",
      description,
      icon,
    };
  } catch (e) {
    if (!isNotFoundError(e)) {
      console.error(`[property-resolver] resolveDynamicCollection failed for "${nameOrType}":`, e);
      throw e;
    }
    return null;
  }
}

export async function listAllCollections(
  db: Database,
  staticCollections: Map<string, string> = new Map(),
): Promise<ResolvedCollection[]> {
  const result: ResolvedCollection[] = [];

  for (const [displayName, typeName] of staticCollections) {
    result.push({ displayName, typeName, source: "static" });
  }

  try {
    const queryResult = await db.query(`
      match $c isa custom_collection,
        has ccoll_display_name $displayName,
        has ccoll_type_name $typeName,
        has ccoll_archived false;
    `);

    for (const row of queryResult.rows) {
      result.push({
        displayName: row.displayName.asString(),
        typeName: row.typeName.asString(),
        source: "dynamic",
      });
    }
  } catch (e) {
    // Dynamic schema might not be initialized - this is expected
    if (!isNotFoundError(e)) {
      console.error(`[property-resolver] listAllCollections failed:`, e);
      throw e;
    }
  }

  return result;
}
