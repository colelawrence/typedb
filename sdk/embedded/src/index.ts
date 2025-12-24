/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * @typedb/embedded - TypeDB Embedded Database for JavaScript/TypeScript
 *
 * An in-memory TypeDB database that runs entirely in WebAssembly.
 *
 * @example
 * ```typescript
 * import { Database } from '@typedb/embedded';
 *
 * const db = await Database.open('mydb');
 *
 * // Define schema
 * await db.define(`
 *   define
 *   attribute name value string;
 *   entity person owns name;
 * `);
 *
 * // Insert data
 * await db.execute('insert $p isa person, has name "Alice";');
 *
 * // Query data
 * const result = await db.query('match $p isa person, has name $n;');
 * for (const row of result.rows) {
 *   console.log(row.n.asString()); // "Alice"
 * }
 * ```
 *
 * @packageDocumentation
 */

// Core
export { Database } from './database.js';
export { Value } from './value.js';
export { ReadTransaction, SchemaTransaction } from './transaction.js';

// Template literals for safe query construction
export { typeql, TypeQL } from './template.js';

// Result types
export type { Row, QueryResult } from './result.js';

// Error types
export {
  TypeDBError,
  ParseError,
  SchemaError,
  DataError,
  TransactionError,
  InternalError,
} from './error.js';

// Storage (persistence)
export { IndexedDBStorage } from './storage.js';
export type {
  StorageAdapter,
  StorageOptions,
  PersistencePolicy,
} from './storage.js';

// Advanced: WASM utilities
export { initWasm, initWasmWithBytes, isWasmReady } from './wasm.js';

// Backend selection (for choosing Node-API vs WASM)
export {
  getBackend,
  getBackendType,
  getBackendMode,
  useBackend,
  resetBackend,
  isBackendAvailable,
} from './backend/index.js';
export type { Backend, BackendType, BackendMode } from './backend/index.js';

// Timing/Benchmarking types (for performance analysis)
export {
  createTimingBreakdown,
  createDbCreationTimingBreakdown,
} from './timing.js';
export type {
  TimingBreakdown,
  BenchmarkSample,
  MemorySnapshot,
  TimingStats,
  TimingBreakdownStats,
  BenchmarkReport,
  WasmTimingBreakdown,
  WasmDatabaseCreationTiming,
} from './timing.js';
export type {
  CoreProfileSnapshot,
  QueryProfileSnapshot,
  CompileProfileSnapshot,
  StageProfileSnapshot,
  StepProfileSnapshot,
  TransactionProfileSnapshot,
  CommitProfileSnapshot,
  StorageCountersSnapshot,
} from './wasm-types.js';

// Meta-Graph: Dynamic schema management (TanStack Table-style API)
export {
  createMetaGraph,
  columnDef,
  prop,
  collectionToTypeQL,
  relationToTypeQL,
} from './meta-graph.js';
export type {
  ScalarKind,
  ColumnDef,
  ColumnsShape,
  Cardinality,
  RoleDef,
  CollectionDef,
  RelationDef,
  MetaGraphDef,
  MetaGraphInstance,
  CollectionInstance,
  RelationInstance,
  Filter,
  FiltersFor,
  FilterValue,
  RelationFilter,
  QueryState,
  FieldUISchema,
  RelationUISchema,
  CollectionUISchema,
} from './meta-graph.js';

// MetaGraph Schema (simplified view of TypeDB schema for MetaGraph use cases)
export {
  buildMetaGraphSchema,
  projectMetaGraphSchema,
  introspectMetaGraphSchema,
  resolveMetaGraphSchema,
  saveMetaGraphSchema,
  loadMetaGraphSchema,
  generateMetaGraphSchemaTypeQL,
} from './schema-introspection.js';
export type {
  MetaGraphSchema,
  MetaGraphEntitySchema,
  MetaGraphRelationSchema,
  MetaGraphRoleSchema,
  MetaGraphAttributeSchema,
  ProjectMetaGraphSchemaOptions,
  IntrospectMetaGraphSchemaOptions,
  ResolveMetaGraphSchemaOptions,
} from './schema-introspection.js';

// Native Schema Introspection (from Rust core via WASM)
export type {
  SchemaSummary,
  EntityTypeSchema,
  RelationTypeSchema,
  AttributeTypeSchema,
  RoleTypeSchema,
  OwnsSchema,
  PlaysSchema,
  RelatesSchema,
  ValueType,
} from './schema-types.js';

// Dynamic Schema: Runtime collection/property creation (Notion/Airtable-style)
export {
  CustomCollectionManager,
  CustomPropertyManager,
  initializeDynamicSchema,
  isDynamicSchemaInitialized,
  ensureDynamicSchemaInitialized,
  DYNAMIC_SCHEMA_DEFINITION,
} from './dynamic-schema.js';
export type {
  ScalarKind as DynamicScalarKind,
  CustomCollectionDef,
  CustomPropertyDef,
} from './dynamic-schema.js';

// Property Resolver: Unified static + dynamic property resolution
export {
  PropertyResolver,
  resolveCollection,
  listAllCollections,
} from './property-resolver.js';
export type {
  PropertySource,
  ResolvedProperty,
  ResolvedCollection,
  StaticPropertyDef,
} from './property-resolver.js';

// Editable Graph: Values as first-class entities with provenance
export {
  createEditableGraph,
  initializeEditableGraph,
  isEditableGraphInitialized,
  ensureEditableGraphInitialized,
  EditSourceManager,
  EditManager,
  CellValueManager,
  EDITABLE_GRAPH_SCHEMA,
} from './editable-graph.js';
export type {
  EditSourceType,
  ValueKind,
  EditSource,
  Edit,
  CellRef,
  EditableValue,
  ValueWithProvenance,
  ValueFilter,
  EditableGraph,
} from './editable-graph.js';

// Record Graph: Records, lists, properties, and assignments with provenance
export {
  createRecordGraph,
  initializeRecordGraph,
  isRecordGraphInitialized,
  RecordManager,
  ListManager,
  EditSourceManager as RecordEditSourceManager,
  EditManager as RecordEditManager,
  AssignmentManager,
  RECORD_GRAPH_SCHEMA,
} from './record-graph.js';
export type {
  PropertyKind,
  EditSourceType as RecordEditSourceType,
  Record,
  List,
  Property,
  PropertyAssignment,
  EditSource as RecordEditSource,
  Edit as RecordEdit,
  AssignmentWithProvenance,
  ValueFilter as RecordValueFilter,
  RecordGraph,
} from './record-graph.js';
