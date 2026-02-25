const { createClient } = require('@clickhouse/client')
const { version } = require('@clickhouse/client/version')
console.log(version)
console.log(typeof createClient())
