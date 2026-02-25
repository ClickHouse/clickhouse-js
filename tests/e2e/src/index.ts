const { createClient, version } = require('@clickhouse/client')
console.log(version)
console.log(typeof createClient())
