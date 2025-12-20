/* TypeDB Embedded Node-API Bindings */

export interface QueryResult {
  success: boolean;
  columns: string[];
  rows: Array<{
    values: Array<{
      variable: string;
      value: NodeValue;
    }>;
  }>;
  rowCount: number;
  error?: NodeError;
}

export interface OperationResult {
  success: boolean;
  message: string;
  rowCount?: number;
  error?: NodeError;
}

export interface SchemaResult {
  success: boolean;
  schema?: SchemaSummary;
  error?: NodeError;
}

export interface SchemaSummary {
  entityTypes: EntityTypeSchema[];
  relationTypes: RelationTypeSchema[];
  attributeTypes: AttributeTypeSchema[];
  roleTypes: RoleTypeSchema[];
}

export interface EntityTypeSchema {
  label: string;
  isAbstract: boolean;
  supertype?: string;
  doc?: string;
  owns: OwnsSchema[];
  plays: PlaysSchema[];
}

export interface RelationTypeSchema {
  label: string;
  isAbstract: boolean;
  supertype?: string;
  doc?: string;
  cascade: boolean;
  relates: RelatesSchema[];
  owns: OwnsSchema[];
  plays: PlaysSchema[];
}

export interface AttributeTypeSchema {
  label: string;
  isAbstract: boolean;
  supertype?: string;
  doc?: string;
  valueType?: string;
  isIndependent: boolean;
  regex?: string;
  range?: RangeConstraint;
  values?: ValueConstraint[];
}

export interface RoleTypeSchema {
  label: string;
  relationType: string;
  supertype?: string;
  isAbstract: boolean;
  doc?: string;
  ordering: string;
}

export interface OwnsSchema {
  attribute: string;
  ordering: string;
  isKey: boolean;
  isUnique: boolean;
  isDistinct: boolean;
  cardinality: CardinalityConstraint;
  regex?: string;
  range?: RangeConstraint;
  values?: ValueConstraint[];
}

export interface PlaysSchema {
  role: string;
  cardinality: CardinalityConstraint;
}

export interface RelatesSchema {
  role: string;
  isAbstract: boolean;
  isDistinct: boolean;
  ordering: string;
  cardinality: CardinalityConstraint;
  specializes?: string;
}

export interface CardinalityConstraint {
  min: number;
  max?: number;
}

export interface RangeConstraint {
  start?: ValueConstraint;
  end?: ValueConstraint;
}

export interface ValueConstraint {
  type: string;
  value: string;
}

export type NodeValue =
  | { kind: 'entity'; typeName: string; iid: string }
  | { kind: 'relation'; typeName: string; iid: string }
  | { kind: 'attribute'; typeName: string; value: NodeAttributeValue }
  | { kind: 'type'; category: string; label: string }
  | { kind: 'value'; value: NodeAttributeValue }
  | { kind: 'thingList'; items: NodeValue[] }
  | { kind: 'valueList'; items: NodeAttributeValue[] }
  | { kind: 'none' };

export type NodeAttributeValue =
  | { type: 'string'; value: string }
  | { type: 'integer'; value: number }
  | { type: 'double'; value: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'date'; value: string }
  | { type: 'dateTime'; value: string }
  | { type: 'dateTimeTz'; value: string }
  | { type: 'duration'; value: string }
  | { type: 'decimal'; value: string }
  | { type: 'struct'; value: string };

export interface NodeError {
  kind: 'parseError' | 'schemaError' | 'typeError' | 'dataError' | 'transactionError' | 'internalError';
  message: string;
  location?: {
    line: number;
    column: number;
    snippet?: string;
  };
  hint?: string;
}

export interface TimingBreakdown {
  parseUs: number;
  compileUs: number;
  executeUs: number;
  serializeUs: number;
  nativeTotalUs: number;
}

export interface TimedResult<T> {
  result: T;
  timing: TimingBreakdown;
  profileId?: number;
}

export interface DatabaseCreationTiming {
  createUs: number;
  totalUs: number;
}

export interface NewTimedResult {
  name: string;
  timing: DatabaseCreationTiming;
}

/** A TypeDB database instance */
export class Database {
  constructor(name: string);

  /** Get the database name */
  readonly name: string;

  /** Open a read transaction */
  transactionRead(): TransactionRead;

  /** Open a write transaction */
  transactionWrite(): TransactionWrite;

  /** Open a schema transaction */
  transactionSchema(): TransactionSchema;

  /** Export the database as a binary snapshot */
  exportSnapshot(): Buffer;

  /** Import a binary snapshot, replacing all data in the database */
  importSnapshot(snapshot: Buffer): void;

  /**
   * Create a new database with timing information.
   * Note: This is a static method that returns timing info.
   * To get the Database instance, call `new Database(name)` separately.
   */
  static newTimed(name: string): NewTimedResult;
}

/** A read-only transaction */
export class TransactionRead {
  /** Execute a read query and return results */
  query(query: string): QueryResult;

  /** Execute a read query with timing breakdown */
  queryTimed(query: string): TimedResult<QueryResult>;

  /** Get the complete schema of the database */
  schema(): SchemaResult;

  /** Explicitly close the transaction */
  close(): void;
}

/** A write transaction for data modifications */
export class TransactionWrite {
  /** Execute a write query (insert, delete, update) */
  execute(query: string): OperationResult;

  /** Execute a write query with timing breakdown */
  executeTimed(query: string): TimedResult<OperationResult>;
}

/** A schema transaction for schema modifications */
export class TransactionSchema {
  /** Execute a schema query (define, undefine, redefine) */
  execute(query: string): OperationResult;

  /** Execute a schema query with timing breakdown */
  executeTimed(query: string): TimedResult<OperationResult>;

  /** Commit the schema changes */
  commit(): OperationResult;

  /** Commit the schema changes with timing breakdown */
  commitTimed(): TimedResult<OperationResult>;

  /** Rollback the schema changes */
  rollback(): void;
}

/** Enable or disable profiling globally */
export function enableProfiling(enabled: boolean): void;

/**
 * Retrieve and consume a stored profile by ID.
 * Note: JS numbers are f64, so profile IDs above 2^53 may lose precision.
 */
export function takeProfile(profileId: number): unknown | null;
