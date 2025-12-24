/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { Database } from "./database.ts";

/**
 * TypeQL schema for storing metadata about dynamic collections and properties.
 *
 * Enables runtime creation of "tables" (collections) and typed properties,
 * with display name → TypeQL type name resolution.
 */
export const DYNAMIC_SCHEMA_DEFINITION = `
define

# Collection Metadata - stores info about user-created collections
# Each collection maps to a TypeDB entity type: col_dyn_<uuid8>
attribute ccoll_id value string;
attribute ccoll_display_name value string;
attribute ccoll_type_name value string;
attribute ccoll_description value string;
attribute ccoll_icon value string;
attribute ccoll_created_at value datetime;
attribute ccoll_archived value boolean;

entity custom_collection,
  owns ccoll_id @key,
  owns ccoll_display_name,
  owns ccoll_type_name,
  owns ccoll_description,
  owns ccoll_icon,
  owns ccoll_created_at,
  owns ccoll_archived,
  plays collection_has_property:collection;

# Property Metadata - stores info about user-created properties
# Each property maps to a TypeDB attribute type: <collection>__cust_<uuid8>
# ex: [Apartment]__cust_[Sqft] = C1902738909__cust_P12678
attribute cprop_id value string;
attribute cprop_display_name value string;
attribute cprop_type_name value string;
attribute cprop_value_kind value string;
attribute cprop_order value integer;
attribute cprop_created_at value datetime;
attribute cprop_archived value boolean;

entity custom_property,
  owns cprop_id @key,
  owns cprop_display_name,
  owns cprop_type_name,
  owns cprop_value_kind,
  owns cprop_order,
  owns cprop_created_at,
  owns cprop_archived,
  plays collection_has_property:property;

# Collection ↔ Property Relation
relation collection_has_property,
  relates collection,
  relates property;
`.trim();

/**
 * Initialize the dynamic schema metadata types in a TypeDB database.
 * Idempotent - safe to call on a database that already has the schema.
 */
export async function initializeDynamicSchema(db: Database): Promise<void> {
  await db.define(DYNAMIC_SCHEMA_DEFINITION);
}

/**
 * Check if the dynamic schema has been initialized in the database.
 */
export async function isDynamicSchemaInitialized(db: Database): Promise<boolean> {
  try {
    await db.query(`match $c isa custom_collection;`);
    return true;
  } catch (e) {
    const msg = String(e);
    if (msg.includes("custom_collection") && (msg.includes("not found") || msg.includes("unknown"))) {
      return false;
    }
    return true;
  }
}

/**
 * Ensure the dynamic schema is initialized, only defining it if not already present.
 */
export async function ensureDynamicSchemaInitialized(db: Database): Promise<void> {
  if (!(await isDynamicSchemaInitialized(db))) {
    await initializeDynamicSchema(db);
  }
}
