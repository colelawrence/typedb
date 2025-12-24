/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * Editable Graph: Values as first-class entities with provenance.
 *
 * This module provides a system where every property value is tracked as an entity,
 * linked to the edit that created it and the source of that edit (proposal, draft, etc.).
 *
 * Key concepts:
 * - EditSource: Origin of changes (proposal, draft, agent exploration)
 * - Edit: A single modification event, belongs to a source
 * - EditableValue: A typed value entity (string, number, etc.) with timestamp
 * - Cell: A row + property combination, identified by type names and IDs
 *
 * This enables queries like:
 * - "Find all properties worth > $500k"
 * - "When did that value first exceed $500k?"
 * - "What proposal/draft caused that change?"
 */

import type { Database } from "./database.ts";

// --- Types ---

export type EditSourceType = "proposal" | "draft" | "exploration";
export type ValueKind = "string" | "integer" | "double" | "boolean" | "datetime";

export interface EditSource {
  id: string;
  name: string;
  type: EditSourceType;
  createdAt: Date;
  description?: string;
  agentId?: string;
}

export interface Edit {
  id: string;
  sourceId: string;
  timestamp: Date;
  description?: string;
}

export interface CellRef {
  rowType: string;
  rowId: string;
  propertyType: string;
}

export interface EditableValue {
  id: string;
  kind: ValueKind;
  content: unknown;
  effectiveFrom: Date;
  superseded: boolean;
  seq: number;
}

export interface ValueWithProvenance {
  value: EditableValue;
  cell: CellRef;
  edit: Edit;
  source: EditSource;
}

export interface ValueFilter {
  eq?: unknown;
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
}

// --- Schema ---

export const EDITABLE_GRAPH_SCHEMA = `
define

# --- Edit Sources ---
attribute esrc_id value string;
attribute esrc_name value string;
attribute esrc_type value string;
attribute esrc_created_at value datetime;
attribute esrc_description value string;
attribute esrc_agent_id value string;

entity edit_source,
  owns esrc_id @key,
  owns esrc_name,
  owns esrc_type,
  owns esrc_created_at,
  owns esrc_description,
  owns esrc_agent_id,
  plays source_edit:source;

# --- Edit ---
attribute edit_id value string;
attribute edit_timestamp value datetime;
attribute edit_description value string;

entity edit,
  owns edit_id @key,
  owns edit_timestamp,
  owns edit_description,
  plays source_edit:edit,
  plays value_edit:edit;

relation source_edit,
  relates source,
  relates edit;

# --- Editable Values ---
attribute val_id value string;
attribute val_effective_from value datetime;
attribute val_superseded value boolean;
attribute val_seq value integer;
attribute val_string value string;
attribute val_integer value integer;
attribute val_double value double;
attribute val_boolean value boolean;
attribute val_datetime value datetime;

entity editable_value,
  owns val_id @key,
  owns val_effective_from,
  owns val_superseded,
  owns val_seq,
  plays value_edit:edited_value,
  plays cell_value:cell_val;

entity string_value sub editable_value,
  owns val_string;

entity integer_value sub editable_value,
  owns val_integer;

entity numeric_value sub editable_value,
  owns val_double;

entity boolean_value sub editable_value,
  owns val_boolean;

entity datetime_value sub editable_value,
  owns val_datetime;

relation value_edit,
  relates edited_value,
  relates edit;

# --- Cell Value ---
attribute cell_row_type value string;
attribute cell_row_id value string;
attribute cell_prop_type value string;

relation cell_value,
  owns cell_row_type,
  owns cell_row_id,
  owns cell_prop_type,
  relates cell_val;
`.trim();

// --- Helpers ---

function escapeString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function formatDatetime(date: Date): string {
  return date.toISOString().slice(0, 19);
}

function parseDatetime(str: string): Date {
  return new Date(str);
}

function valueKindToEntityType(kind: ValueKind): string {
  switch (kind) {
    case "string":
      return "string_value";
    case "integer":
      return "integer_value";
    case "double":
      return "numeric_value";
    case "boolean":
      return "boolean_value";
    case "datetime":
      return "datetime_value";
  }
}

function valueKindToAttr(kind: ValueKind): string {
  switch (kind) {
    case "string":
      return "val_string";
    case "integer":
      return "val_integer";
    case "double":
      return "val_double";
    case "boolean":
      return "val_boolean";
    case "datetime":
      return "val_datetime";
  }
}

function formatValue(value: unknown, kind: ValueKind): string {
  if (kind === "string") return `"${escapeString(String(value))}"`;
  if (kind === "datetime" && value instanceof Date) return formatDatetime(value);
  if (kind === "boolean") return value ? "true" : "false";
  return String(value);
}

async function fetchOptionalAttr(
  db: Database,
  entityType: string,
  keyAttr: string,
  keyValue: string,
  targetAttr: string,
): Promise<string | undefined> {
  try {
    const result = await db.query(
      `match $e isa ${entityType}, has ${keyAttr} "${keyValue}", has ${targetAttr} $val;`,
    );
    if (result.rowCount > 0) {
      return result.rows[0]!.val.asString();
    }
  } catch {
    // Attribute not present
  }
  return undefined;
}

// --- Schema Initialization ---

export async function initializeEditableGraph(db: Database): Promise<void> {
  await db.define(EDITABLE_GRAPH_SCHEMA);
}

export async function isEditableGraphInitialized(db: Database): Promise<boolean> {
  try {
    await db.query(`match $e isa edit_source;`);
    return true;
  } catch (e) {
    const msg = String(e);
    if (msg.includes("edit_source") && (msg.includes("not found") || msg.includes("unknown"))) {
      return false;
    }
    return true;
  }
}

export async function ensureEditableGraphInitialized(db: Database): Promise<void> {
  if (!(await isEditableGraphInitialized(db))) {
    await initializeEditableGraph(db);
  }
}

// --- EditSourceManager ---

export class EditSourceManager {
  constructor(private db: Database) {}

  async create(input: {
    name: string;
    type: EditSourceType;
    description?: string;
    agentId?: string;
  }): Promise<EditSource> {
    const id = crypto.randomUUID();
    const now = new Date();

    let query = `
      insert $s isa edit_source,
        has esrc_id "${id}",
        has esrc_name "${escapeString(input.name)}",
        has esrc_type "${input.type}",
        has esrc_created_at ${formatDatetime(now)}`;

    if (input.description) {
      query += `, has esrc_description "${escapeString(input.description)}"`;
    }
    if (input.agentId) {
      query += `, has esrc_agent_id "${escapeString(input.agentId)}"`;
    }
    query += ";";

    await this.db.execute(query);

    return {
      id,
      name: input.name,
      type: input.type,
      createdAt: now,
      description: input.description,
      agentId: input.agentId,
    };
  }

  async createProposal(input: { name: string; description?: string }): Promise<EditSource> {
    return this.create({ ...input, type: "proposal" });
  }

  async createDraft(input: { name: string; description?: string }): Promise<EditSource> {
    return this.create({ ...input, type: "draft" });
  }

  async createExploration(input: { name: string; agentId?: string }): Promise<EditSource> {
    return this.create({ ...input, type: "exploration" });
  }

  async getById(id: string): Promise<EditSource | null> {
    const result = await this.db.query(`
      match $s isa edit_source,
        has esrc_id "${id}",
        has esrc_name $name,
        has esrc_type $type,
        has esrc_created_at $createdAt;
    `);

    if (result.rowCount === 0) return null;
    const row = result.rows[0]!;

    const description = await fetchOptionalAttr(this.db, "edit_source", "esrc_id", id, "esrc_description");
    const agentId = await fetchOptionalAttr(this.db, "edit_source", "esrc_id", id, "esrc_agent_id");

    return {
      id,
      name: row.name.asString(),
      type: row.type.asString() as EditSourceType,
      createdAt: parseDatetime(row.createdAt.asDateTime()),
      description,
      agentId,
    };
  }

  async list(type?: EditSourceType): Promise<EditSource[]> {
    const typeFilter = type ? `, has esrc_type "${type}"` : "";

    const result = await this.db.query(`
      match $s isa edit_source,
        has esrc_id $id,
        has esrc_name $name,
        has esrc_type $type,
        has esrc_created_at $createdAt${typeFilter};
    `);

    const sources: EditSource[] = [];
    for (const row of result.rows) {
      const id = row.id.asString();
      const description = await fetchOptionalAttr(this.db, "edit_source", "esrc_id", id, "esrc_description");
      const agentId = await fetchOptionalAttr(this.db, "edit_source", "esrc_id", id, "esrc_agent_id");

      sources.push({
        id,
        name: row.name.asString(),
        type: row.type.asString() as EditSourceType,
        createdAt: parseDatetime(row.createdAt.asDateTime()),
        description,
        agentId,
      });
    }

    return sources;
  }
}

// --- EditManager ---

export class EditManager {
  constructor(
    private db: Database,
    private sourceId: string,
  ) {}

  async create(description?: string): Promise<Edit> {
    const id = crypto.randomUUID();
    const now = new Date();

    let insertQuery = `
      insert $e isa edit,
        has edit_id "${id}",
        has edit_timestamp ${formatDatetime(now)}`;

    if (description) {
      insertQuery += `, has edit_description "${escapeString(description)}"`;
    }
    insertQuery += ";";

    await this.db.execute(insertQuery);

    // Link to source
    await this.db.execute(`
      match
        $s isa edit_source, has esrc_id "${this.sourceId}";
        $e isa edit, has edit_id "${id}";
      insert
        (source: $s, edit: $e) isa source_edit;
    `);

    return {
      id,
      sourceId: this.sourceId,
      timestamp: now,
      description,
    };
  }

  async getById(id: string): Promise<Edit | null> {
    const result = await this.db.query(`
      match
        $e isa edit, has edit_id "${id}", has edit_timestamp $ts;
        (source: $s, edit: $e) isa source_edit;
        $s has esrc_id $srcId;
    `);

    if (result.rowCount === 0) return null;
    const row = result.rows[0]!;

    const description = await fetchOptionalAttr(this.db, "edit", "edit_id", id, "edit_description");

    return {
      id,
      sourceId: row.srcId.asString(),
      timestamp: parseDatetime(row.ts.asDateTime()),
      description,
    };
  }

  async list(): Promise<Edit[]> {
    const result = await this.db.query(`
      match
        (source: $s, edit: $e) isa source_edit;
        $s has esrc_id "${this.sourceId}";
        $e has edit_id $id, has edit_timestamp $ts;
    `);

    const edits: Edit[] = [];
    for (const row of result.rows) {
      const id = row.id.asString();
      const description = await fetchOptionalAttr(this.db, "edit", "edit_id", id, "edit_description");

      edits.push({
        id,
        sourceId: this.sourceId,
        timestamp: parseDatetime(row.ts.asDateTime()),
        description,
      });
    }

    return edits;
  }
}

// --- CellValueManager ---

export class CellValueManager {
  constructor(private db: Database) {}

  async setValue(params: {
    editId: string;
    cell: CellRef;
    value: unknown;
    kind: ValueKind;
  }): Promise<EditableValue> {
    const { editId, cell, value, kind } = params;
    const valueId = crypto.randomUUID();
    const now = new Date();
    const entityType = valueKindToEntityType(kind);
    const contentAttr = valueKindToAttr(kind);
    const formattedValue = formatValue(value, kind);

    // Get next sequence number for this cell
    const seq = await this.getNextSeq(cell);

    // Mark any existing values for this cell as superseded
    await this.supersedeExistingValues(cell);

    // Insert the new value entity
    await this.db.execute(`
      insert $v isa ${entityType},
        has val_id "${valueId}",
        has val_effective_from ${formatDatetime(now)},
        has val_superseded false,
        has val_seq ${seq},
        has ${contentAttr} ${formattedValue};
    `);

    // Link value to edit
    await this.db.execute(`
      match
        $e isa edit, has edit_id "${editId}";
        $v isa editable_value, has val_id "${valueId}";
      insert
        (edit: $e, edited_value: $v) isa value_edit;
    `);

    // Create cell_value relation
    await this.db.execute(`
      match
        $v isa editable_value, has val_id "${valueId}";
      insert
        (cell_val: $v) isa cell_value,
          has cell_row_type "${cell.rowType}",
          has cell_row_id "${escapeString(cell.rowId)}",
          has cell_prop_type "${cell.propertyType}";
    `);

    return {
      id: valueId,
      kind,
      content: value,
      effectiveFrom: now,
      superseded: false,
      seq,
    };
  }

  private async getNextSeq(cell: CellRef): Promise<number> {
    try {
      const result = await this.db.query(`
        match
          (cell_val: $v) isa cell_value,
            has cell_row_type "${cell.rowType}",
            has cell_row_id "${escapeString(cell.rowId)}",
            has cell_prop_type "${cell.propertyType}";
          $v has val_seq $seq;
      `);

      if (result.rowCount === 0) return 0;

      const seqs = result.rows.map((r) => r.seq.asInteger());
      return Math.max(...seqs) + 1;
    } catch {
      return 0;
    }
  }

  private async supersedeExistingValues(cell: CellRef): Promise<void> {
    // Find existing non-superseded values for this cell and mark them superseded
    try {
      const existing = await this.db.query(`
        match
          (cell_val: $v) isa cell_value,
            has cell_row_type "${cell.rowType}",
            has cell_row_id "${escapeString(cell.rowId)}",
            has cell_prop_type "${cell.propertyType}";
          $v has val_superseded false, has val_id $vid;
      `);

      for (const row of existing.rows) {
        const vid = row.vid.asString();
        await this.db.execute(`
          match
            $v isa editable_value, has val_id "${vid}", has val_superseded $old;
          delete
            has $old of $v;
          insert
            $v has val_superseded true;
        `);
      }
    } catch {
      // No existing values
    }
  }

  async getCurrentValue(cell: CellRef): Promise<EditableValue | null> {
    const result = await this.db.query(`
      match
        (cell_val: $v) isa cell_value,
          has cell_row_type "${cell.rowType}",
          has cell_row_id "${escapeString(cell.rowId)}",
          has cell_prop_type "${cell.propertyType}";
        $v has val_id $id,
          has val_effective_from $effectiveFrom,
          has val_superseded false,
          has val_seq $seq;
    `);

    if (result.rowCount === 0) return null;
    const row = result.rows[0]!;
    const id = row.id.asString();

    return this.hydrateValue(id, parseDatetime(row.effectiveFrom.asDateTime()), false, row.seq.asInteger());
  }

  async getValueHistory(cell: CellRef): Promise<EditableValue[]> {
    const result = await this.db.query(`
      match
        (cell_val: $v) isa cell_value,
          has cell_row_type "${cell.rowType}",
          has cell_row_id "${escapeString(cell.rowId)}",
          has cell_prop_type "${cell.propertyType}";
        $v has val_id $id,
          has val_effective_from $effectiveFrom,
          has val_superseded $superseded,
          has val_seq $seq;
    `);

    const values: EditableValue[] = [];
    for (const row of result.rows) {
      const val = await this.hydrateValue(
        row.id.asString(),
        parseDatetime(row.effectiveFrom.asDateTime()),
        row.superseded.asBoolean(),
        row.seq.asInteger(),
      );
      if (val) values.push(val);
    }

    // Sort by seq descending (most recent first)
    values.sort((a, b) => b.seq - a.seq);
    return values;
  }

  private async hydrateValue(id: string, effectiveFrom: Date, superseded = false, seq = 0): Promise<EditableValue | null> {
    // Try each value type to find the content
    for (const kind of ["string", "integer", "double", "boolean", "datetime"] as ValueKind[]) {
      const entityType = valueKindToEntityType(kind);
      const contentAttr = valueKindToAttr(kind);

      try {
        const result = await this.db.query(`
          match $v isa ${entityType}, has val_id "${id}", has ${contentAttr} $content;
        `);

        if (result.rowCount > 0) {
          const raw = result.rows[0]!.content;
          let content: unknown;

          switch (kind) {
            case "string":
              content = raw.asString();
              break;
            case "integer":
              content = raw.asInteger();
              break;
            case "double":
              content = raw.asDouble();
              break;
            case "boolean":
              content = raw.asBoolean();
              break;
            case "datetime":
              content = parseDatetime(raw.asDateTime());
              break;
          }

          return { id, kind, content, effectiveFrom, superseded, seq };
        }
      } catch {
        // Not this type, try next
      }
    }

    return null;
  }

  async findValues(params: {
    propertyType?: string;
    filter?: ValueFilter;
    includeSuperseded?: boolean;
  }): Promise<ValueWithProvenance[]> {
    const { propertyType, filter, includeSuperseded } = params;

    // Build the query
    let query = `
      match
        (cell_val: $v) isa cell_value,
          has cell_row_type $rowType,
          has cell_row_id $rowId,
          has cell_prop_type $propType;
        $v has val_id $valId,
          has val_effective_from $effectiveFrom,
          has val_superseded $superseded,
          has val_seq $valSeq;
        (edit: $e, edited_value: $v) isa value_edit;
        $e has edit_id $editId, has edit_timestamp $editTs;
        (source: $s, edit: $e) isa source_edit;
        $s has esrc_id $srcId,
          has esrc_name $srcName,
          has esrc_type $srcType,
          has esrc_created_at $srcCreatedAt;
    `;

    if (propertyType) {
      query = query.replace("has cell_prop_type $propType", `has cell_prop_type "${propertyType}"`);
    }

    if (!includeSuperseded) {
      query = query.replace("has val_superseded $superseded", "has val_superseded false");
    }

    // For numeric filters, we need to query numeric_value specifically
    if (filter && (filter.gt !== undefined || filter.gte !== undefined || filter.lt !== undefined || filter.lte !== undefined)) {
      query += `$v isa numeric_value, has val_double $content;`;

      if (filter.gt !== undefined) query += ` $content > ${filter.gt};`;
      if (filter.gte !== undefined) query += ` $content >= ${filter.gte};`;
      if (filter.lt !== undefined) query += ` $content < ${filter.lt};`;
      if (filter.lte !== undefined) query += ` $content <= ${filter.lte};`;
    }

    const result = await this.db.query(query);
    const results: ValueWithProvenance[] = [];

    for (const row of result.rows) {
      const valId = row.valId.asString();
      const effectiveFrom = parseDatetime(row.effectiveFrom.asDateTime());
      const supersededVal = includeSuperseded ? row.superseded.asBoolean() : false;
      const valSeq = row.valSeq.asInteger();

      const value = await this.hydrateValue(valId, effectiveFrom, supersededVal, valSeq);
      if (!value) continue;

      const editId = row.editId.asString();
      const editDescription = await fetchOptionalAttr(this.db, "edit", "edit_id", editId, "edit_description");

      const srcId = row.srcId.asString();
      const srcDescription = await fetchOptionalAttr(this.db, "edit_source", "esrc_id", srcId, "esrc_description");
      const srcAgentId = await fetchOptionalAttr(this.db, "edit_source", "esrc_id", srcId, "esrc_agent_id");

      results.push({
        value,
        cell: {
          rowType: row.rowType.asString(),
          rowId: row.rowId.asString(),
          propertyType: propertyType ?? row.propType.asString(),
        },
        edit: {
          id: editId,
          sourceId: srcId,
          timestamp: parseDatetime(row.editTs.asDateTime()),
          description: editDescription,
        },
        source: {
          id: srcId,
          name: row.srcName.asString(),
          type: row.srcType.asString() as EditSourceType,
          createdAt: parseDatetime(row.srcCreatedAt.asDateTime()),
          description: srcDescription,
          agentId: srcAgentId,
        },
      });
    }

    return results;
  }
}

// --- EditableGraph (main entry point) ---

export interface EditableGraph {
  sources: EditSourceManager;
  cells: CellValueManager;
  editsFor(sourceId: string): EditManager;
}

export function createEditableGraph(db: Database): EditableGraph {
  return {
    sources: new EditSourceManager(db),
    cells: new CellValueManager(db),
    editsFor: (sourceId: string) => new EditManager(db, sourceId),
  };
}
