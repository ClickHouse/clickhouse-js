import { createClient } from '@clickhouse/client' // or '@clickhouse/client-web'

// URL configuration reference with all possible values.
//
// The client expects `url` as a string or as a URL object (https://developer.mozilla.org/en-US/docs/Web/API/URL).
// Allowed string format: `http[s]://[username:password@]hostname:port[/database][?param1=value1&param2=value2]`.
// Sample URL string: https://bob:secret@my.host:8124/analytics?application=my_analytics_app&request_timeout=60000
// As for [?param1=value1&param2=value2] URL part, see all possible parameters below.
//
// +----------------------------------------------------------------------------------------------------------+
// |         Important: URL parameters will _always_ override the rest of the configuration object.           |
// |   If a value from the configuration object is overridden by a URL parameter, a warning will be logged.   |
// +----------------------------------------------------------------------------------------------------------+
void (async () => {
  const url =
    // basic auth (username:password) + database will be extracted from the URL
    'https://bob:secret@my.host:8124/analytics?' +
    [
      // arbitrary string values
      'application=my_analytics_app',
      'session_id=random_session_id',
      // a numeric value
      'request_timeout=60000',
      // a numeric value; max_open_connections is expected to be at least 1 when set explicitly.
      'max_open_connections=10',
      // boolean values can be set as 1/0 or true/false
      'readonly=false',
      // sets compression.request = true
      'compression_request=1',
      // sets compression.response = false
      'compression_response=false',
      // sets log.level = 'TRACE';
      // allowed values: TRACE, DEBUG, INFO, WARN, ERROR, OFF.
      'log_level=TRACE',
      // sets keep_alive.enabled = false
      'keep_alive_enabled=false',
      // all values prefixed with clickhouse_setting_ will be added to clickhouse_settings
      // this will set clickhouse_settings.async_insert = 1
      'clickhouse_setting_async_insert=1',
      // ch_ is a shorthand for clickhouse_setting_* parameters; works similarly.
      // this will set clickhouse_settings.wait_for_async_insert = 0
      'ch_wait_for_async_insert=0',
      // adds a custom HTTP header 'X-CLICKHOUSE-AUTH' with 'secret_header' value to client requests
      // arbitrary string value
      'http_header_X-CLICKHOUSE-AUTH=secret_header',
    ].join('&')
  /*
    The URL above is equivalent to the following configuration object:
    {
      url: 'https://my.host:8124',
      username: 'bob',
      password: 'secret',
      database: 'analytics',
      readonly: false,
      application: 'my_analytics_app',
      session_id: 'random_session_id',
      request_timeout: 60_000,
      max_open_connections: 10,
      compression: {
        request: true,
        response: false,
      },
      log_level: 'TRACE',
      keep_alive: {
        enabled: false,
      },
      clickhouse_settings: {
        async_insert: 1,
        wait_for_async_insert: 0,
      },
      http_headers: {
        'X-CLICKHOUSE-AUTH': 'secret_header',
      },
    }
   */
  const client = createClient({
    url,
  })
  // your queries will go here...
  await client.close()
})()
