import type { Queryable } from "@livestore/livestore";
import { useQuery } from "@livestore/react";
/**
 * @example
 * ```tsx
 * // Render as text
 * <Queryable query={displayName$} />
 * ```
 * @param props.query - The Queryable to subscribe to.
 * @returns The rendered value.
 */
export function Queryable<T extends React.ReactNode>(props: {
  query: Queryable<T>;
  children?: (value: T) => React.ReactNode;
}): React.ReactNode;
/**
 * Renders the value of a Queryable using a render function.
 * This function can use hooks like useMemo etc within
 * @example
 * ```tsx
 * <Queryable query={isEnabled$}>
 *   {(value) => <div $>{value ? "Enabled" : "Disabled"}</div>}
 * </Queryable>
 * <Queryable query={isEnabled$}>
 *   {(value) => {
 *     // Use hooks for whatever you need to avoid creating new component functions
 *     const memoizedValue = useMemo(() => value, [value]);
 *     return <div $>{memoizedValue ? "Enabled" : "Disabled"}</div>;
 *   }}
 * }}
 * </Queryable>
 * ```
 * @param props.query - The Queryable to subscribe to.
 * @param props.children - The function to render the value.
 * @returns The rendered value.
 */
export function Queryable<T>(props: {
  query: Queryable<T>;
  children: (value: T) => React.ReactNode;
}): React.ReactNode;
export function Queryable(props: {
  query: Queryable<any>;
  children?: (value: any) => React.ReactNode;
}) {
  const value = useQuery(props.query as any);
  return <>{typeof props.children === "function" ? props.children(value) : (value as any)}</>;
}
