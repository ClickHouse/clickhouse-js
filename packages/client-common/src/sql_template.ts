import { TupleParam } from './data_formatter'

/**
 * Represents a SQL template literal with inferred query parameters.
 * This is created by the `sql` tagged template function.
 */
export interface SQLTemplate {
  /** Brand to distinguish SQLTemplate from plain objects */
  readonly _brand: 'SQLTemplate'
  /** The query string with ClickHouse parameter placeholders */
  readonly query: string
  /** The inferred query parameters */
  readonly query_params: Record<string, unknown>
}

/**
 * Marker for SQL identifiers (table names, column names, etc.)
 * Used to distinguish identifiers from regular string values.
 */
export class SQLIdentifier {
  constructor(public readonly name: string) {}
}

/**
 * Helper function to mark a value as an SQL identifier (table/column name).
 * Identifiers use ClickHouse's `{name: Identifier}` type for safe substitution.
 *
 * @example
 * ```typescript
 * const tableName = 'users'
 * const result = await client.query(
 *   sql`SELECT * FROM ${identifier(tableName)}`
 * )
 * ```
 */
export function identifier(name: string): SQLIdentifier {
  return new SQLIdentifier(name)
}

/**
 * Type guard to check if a value is an SQLTemplate.
 */
export function isSQLTemplate(value: unknown): value is SQLTemplate {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_brand' in value &&
    (value as SQLTemplate)._brand === 'SQLTemplate'
  )
}

/**
 * Type guard to check if a value is an SQLIdentifier.
 */
export function isSQLIdentifier(value: unknown): value is SQLIdentifier {
  return value instanceof SQLIdentifier
}

/**
 * Infers the ClickHouse type from a JavaScript value.
 * This is used for automatic type inference in the sql tagged template.
 *
 * @throws {Error} If the type cannot be inferred
 */
export function inferClickHouseType(value: unknown): string {
  if (value === null || value === undefined) {
    // Default to Nullable(String) for null/undefined
    // In practice, this may need explicit type hints for better type safety
    return 'Nullable(String)'
  }

  if (isSQLIdentifier(value)) {
    return 'Identifier'
  }

  if (typeof value === 'string') {
    return 'String'
  }

  if (typeof value === 'boolean') {
    return 'Boolean'
  }

  if (typeof value === 'number') {
    // Detect if it's an integer or float
    // Use Int32 for integers and Float64 for floats by default
    if (Number.isInteger(value)) {
      // Check if it fits in Int32 range
      if (value >= -2147483648 && value <= 2147483647) {
        return 'Int32'
      }
      // For larger integers, use Int64
      return 'Int64'
    }
    return 'Float64'
  }

  if (typeof value === 'bigint') {
    return 'Int64'
  }

  if (value instanceof Date) {
    return 'DateTime'
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      throw new Error(
        'Cannot infer ClickHouse type from empty array. Please provide at least one element or use an explicit type hint.',
      )
    }
    // Infer from the first element
    const elementType = inferClickHouseType(value[0])
    return `Array(${elementType})`
  }

  if (value instanceof TupleParam) {
    if (value.values.length === 0) {
      throw new Error('Cannot infer ClickHouse type from empty tuple.')
    }
    const types = value.values.map((v) => inferClickHouseType(v)).join(', ')
    return `Tuple(${types})`
  }

  if (value instanceof Map) {
    if (value.size === 0) {
      throw new Error(
        'Cannot infer ClickHouse type from empty Map. Please provide at least one entry or use an explicit type hint.',
      )
    }
    // Infer from the first entry
    const [k, v] = value.entries().next().value as [unknown, unknown]
    const keyType = inferClickHouseType(k)
    const valueType = inferClickHouseType(v)
    return `Map(${keyType}, ${valueType})`
  }

  // Check for plain objects (treated as maps with string keys)
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
    if (entries.length === 0) {
      throw new Error(
        'Cannot infer ClickHouse type from empty object. Please provide at least one property or use an explicit type hint.',
      )
    }
    // Infer from the first entry
    const [, v] = entries[0]
    const valueType = inferClickHouseType(v)
    return `Map(String, ${valueType})`
  }

  throw new Error(
    `Cannot infer ClickHouse type for value: ${String(value)} (type: ${typeof value})`,
  )
}

/**
 * Tagged template function for creating SQL queries with automatic parameter binding.
 * All interpolated values are safely parameterized to prevent SQL injection.
 *
 * @example
 * ```typescript
 * import { sql, identifier } from '@clickhouse/client'
 *
 * // Basic usage
 * const userName = 'Alice'
 * const result = await client.query(sql`SELECT * FROM users WHERE name = ${userName}`)
 *
 * // With identifiers
 * const tableName = 'users'
 * const result = await client.query(
 *   sql`SELECT * FROM ${identifier(tableName)} WHERE active = ${true}`
 * )
 *
 * // With arrays
 * const ids = [1, 2, 3]
 * const result = await client.query(sql`SELECT * FROM users WHERE id IN ${ids}`)
 *
 * // Composability
 * const whereClause = sql`status = ${'active'} AND role = ${'admin'}`
 * const result = await client.query(sql`SELECT * FROM users WHERE ${whereClause}`)
 * ```
 */
export function sql(
  strings: TemplateStringsArray,
  ...values: unknown[]
): SQLTemplate {
  let query = ''
  const query_params: Record<string, unknown> = {}
  let paramCounter = 0

  for (let i = 0; i < strings.length; i++) {
    query += strings[i]

    if (i < values.length) {
      const value = values[i]

      // Handle nested SQLTemplate (composability)
      if (isSQLTemplate(value)) {
        // Need to rename parameters in the nested template to avoid conflicts
        const nestedQuery = value.query
        const nestedParams = value.query_params

        // Create a mapping of old param names to new param names
        const paramMapping = new Map<string, string>()
        for (const oldParamName of Object.keys(nestedParams)) {
          const newParamName = `__p${paramCounter++}`
          paramMapping.set(oldParamName, newParamName)
          query_params[newParamName] = nestedParams[oldParamName]
        }

        // Replace parameter names in the nested query
        let renamedQuery = nestedQuery
        for (const [oldName, newName] of paramMapping) {
          // Use a regex to replace {oldName: Type} with {newName: Type}
          const regex = new RegExp(`\\{${oldName}:`, 'g')
          renamedQuery = renamedQuery.replace(regex, `{${newName}:`)
        }

        query += renamedQuery
      } else {
        // Generate a unique parameter name
        const paramName = `__p${paramCounter++}`

        // Infer the ClickHouse type
        let clickhouseType: string
        let actualValue: unknown

        if (isSQLIdentifier(value)) {
          clickhouseType = 'Identifier'
          actualValue = value.name
        } else {
          clickhouseType = inferClickHouseType(value)
          actualValue = value
        }

        // Add the parameter placeholder to the query
        query += `{${paramName}: ${clickhouseType}}`

        // Store the parameter value
        query_params[paramName] = actualValue
      }
    }
  }

  return {
    _brand: 'SQLTemplate',
    query: query.trim(),
    query_params,
  }
}
