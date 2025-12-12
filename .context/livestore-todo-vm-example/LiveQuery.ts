import type { LiveQueryDef as LiveQueryDefType, Queryable as LiveQueryType } from "@livestore/livestore";

export type Queryable<T> = LiveQueryType<T> | LiveQueryDefType<T, "def">;
