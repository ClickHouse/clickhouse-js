# Minimal ClickHouse Client using Fetch API

This is a minimal implementation of a ClickHouse client using the Fetch API. It demonstrates the core functionality of the ClickHouse JS client without the full complexity of the official library.

## Purpose

This implementation serves as:

- A learning resource to understand how the ClickHouse HTTP interface works
- A simplified reference implementation
- A starting point for custom integrations where the full client library may be too heavy

## Features

The minimal client supports:

- ✅ Query execution with `JSONEachRow` and `JSON` formats
- ✅ Data insertion
- ✅ DDL commands (CREATE, DROP, etc.)
- ✅ Query parameter binding
- ✅ ClickHouse settings
- ✅ Ping/health checks
- ✅ Basic authentication
- ✅ Request timeout handling
- ✅ Error handling

## API Differences from Official Client

While this implementation aims to be similar to the official client, there are some intentional simplifications:

1. **No streaming support** - All responses are loaded into memory
2. **Limited format support** - Primarily `JSONEachRow` and `JSON`
3. **No compression** - Request/response compression not implemented
4. **No connection pooling** - Each request is independent
5. **Simplified error handling** - Basic error messages without detailed error codes
6. **No TypeScript result types** - The official client provides more sophisticated type inference

## Files

- `minimal_fetch_client.ts` - The main client implementation
- `minimal_fetch_basic_query.ts` - Basic SELECT query example
- `minimal_fetch_insert_select.ts` - Table creation, insert, and select example
- `minimal_fetch_ping.ts` - Ping/health check example
- `minimal_fetch_parameter_binding.ts` - Query parameter binding example
- `minimal_fetch_settings.ts` - ClickHouse settings example

## Usage

### Basic Query

```typescript
import { createClient } from './minimal_fetch_client'

const client = createClient()
const result = await client.query({
  query: 'SELECT number FROM system.numbers LIMIT 5',
  format: 'JSONEachRow',
})
console.log(result)
await client.close()
```

### Insert Data

```typescript
import { createClient } from './minimal_fetch_client'

const client = createClient()

await client.command({
  query: `
    CREATE TABLE example
    (id UInt64, name String)
    ENGINE MergeTree()
    ORDER BY (id)
  `,
})

await client.insert({
  table: 'example',
  values: [
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' },
  ],
  format: 'JSONEachRow',
})

await client.close()
```

### Query with Parameters

```typescript
import { createClient } from './minimal_fetch_client'

const client = createClient()
const result = await client.query({
  query:
    'SELECT * FROM system.numbers WHERE number > {min:UInt64} LIMIT {limit:UInt32}',
  query_params: {
    min: 5,
    limit: 3,
  },
})
await client.close()
```

## Running Examples

Note: These examples require a running ClickHouse instance. You can start one using Docker:

```bash
docker compose up -d
```

Then run any example:

```bash
# From the examples directory
npx tsx minimal_fetch_basic_query.ts
npx tsx minimal_fetch_insert_select.ts
npx tsx minimal_fetch_ping.ts
```

## Configuration

The client accepts the following configuration options:

```typescript
interface ClientConfig {
  url?: string // Default: 'http://localhost:8123'
  username?: string // Default: 'default'
  password?: string // Default: '' (can use CLICKHOUSE_PASSWORD env var)
  database?: string // Default: 'default'
  request_timeout?: number // Default: 30000 (ms)
}
```

## Implementation Notes

### Authentication

The client uses HTTP Basic Authentication, encoding credentials in the Authorization header:

```typescript
Authorization: Basic base64(username:password)
```

### Query Format

Queries are sent via POST requests to the ClickHouse HTTP interface:

```
POST /?database=default&param_x=value
Body: SELECT * FROM table FORMAT JSONEachRow
```

### Error Handling

The client provides basic error handling:

- Network errors are propagated as-is
- HTTP errors (4xx, 5xx) are wrapped with the response text
- Timeout errors are specifically handled with AbortController

### Response Parsing

For `JSONEachRow` format, each line of the response is parsed as a separate JSON object.
For `JSON` format, the entire response is parsed and the `data` field is returned.

## Comparison with Official Client

| Feature            | Minimal Client           | Official Client   |
| ------------------ | ------------------------ | ----------------- |
| Size               | ~250 lines               | ~10,000+ lines    |
| Dependencies       | None (uses native fetch) | Multiple packages |
| Streaming          | ❌                       | ✅                |
| Compression        | ❌                       | ✅                |
| Connection Pooling | ❌                       | ✅ (Node.js only) |
| Type Safety        | Basic                    | Advanced          |
| Error Handling     | Basic                    | Comprehensive     |
| Format Support     | Limited                  | All formats       |
| Platform           | Browser + Node.js 18+    | Browser + Node.js |

## When to Use

**Use the minimal client when:**

- Learning how ClickHouse HTTP interface works
- Building a custom lightweight integration
- You only need basic query/insert functionality
- You want to understand the implementation

**Use the official client when:**

- Building production applications
- You need streaming support
- You need compression for large datasets
- You need comprehensive error handling
- You want full TypeScript type safety

## License

This implementation is part of the clickhouse-js repository and follows the same license.
