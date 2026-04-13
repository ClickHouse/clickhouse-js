# TLS / Certificate Errors

> **Requires:** `>= 0.0.8` (basic and mutual TLS support added in 0.0.8). For custom HTTP agent with TLS, see `>= 1.2.0` (`http_agent` option); note that when using a custom agent, the `tls` config option is ignored.

## Basic TLS (CA certificate only)

```js
import fs from 'fs'
import { createClient } from '@clickhouse/client'

const client = createClient({
  url: 'https://<hostname>:<port>',
  username: '<user>',
  password: '<pass>',
  tls: {
    ca_cert: fs.readFileSync('certs/CA.pem'),
  },
})
```

## Mutual TLS (client certificate + key)

```js
import fs from 'fs'
import { createClient } from '@clickhouse/client'

const client = createClient({
  url: 'https://<hostname>:<port>',
  username: '<user>',
  tls: {
    ca_cert: fs.readFileSync('certs/CA.pem'),
    cert: fs.readFileSync('certs/client.crt'),
    key: fs.readFileSync('certs/client.key'),
  },
})
```

> **Tip (`>= 1.2.0`):** If you need a custom HTTP(S) agent, use the `http_agent` option. Only set `set_basic_auth_header: false` if you must avoid sending the basic-auth `Authorization` header (for example, due to a header conflict); in that case, provide alternative auth headers such as `X-ClickHouse-User` / `X-ClickHouse-Key` via `http_headers`.

## Common TLS errors

### `UNABLE_TO_VERIFY_LEAF_SIGNATURE` / `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`

The server's certificate was signed by a CA that Node.js doesn't trust. Pass the CA cert explicitly:

```js
tls: {
  ca_cert: fs.readFileSync('certs/CA.pem'),
}
```

If you're using ClickHouse Cloud, the CA is a well-known public CA and this error usually means the system CA bundle is outdated or the URL is wrong.

### `self signed certificate` / `self signed certificate in certificate chain`

The server uses a self-signed cert. Options in order of preference:

1. Pass the self-signed cert as the CA:
   ```js
   tls: { ca_cert: fs.readFileSync('certs/server.crt') }
   ```

2. For development only — disable verification via a custom agent (`>= 1.2.0`):
   ```js
   import https from 'https'
   import { createClient } from '@clickhouse/client'

   const client = createClient({
     url: 'https://<hostname>:<port>',
     http_agent: new https.Agent({ rejectUnauthorized: false }),
   })
   ```

   > ⚠️ Never use `rejectUnauthorized: false` in production — it disables all certificate verification.

### `ERR_SSL_WRONG_VERSION_NUMBER` / `ECONNREFUSED` on HTTPS URL

The client is connecting with HTTPS but the server is listening on plain HTTP. Change the URL scheme to `http://` or enable TLS on the ClickHouse server.
