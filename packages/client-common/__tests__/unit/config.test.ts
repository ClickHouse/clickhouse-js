import { describe, it, expect } from 'vitest'
import type {
  BaseClickHouseClientConfigOptions,
  HandleImplSpecificURLParams,
} from '../../src/index'
import {
  ClickHouseLogLevel,
  getConnectionParams,
  LogWriter,
  numberConfigURLValue,
} from '../../src/index'
import { TestLogger } from '../utils/test_logger'
import type { BaseClickHouseClientConfigOptionsWithURL } from '../../src/config'
import {
  booleanConfigURLValue,
  createUrl,
  enumConfigURLValue,
  loadConfigOptionsFromURL,
  mergeConfigs,
  prepareConfigWithURL,
} from '../../src/config'

describe('config', () => {
  const logger = new TestLogger()

  describe('prepareConfigWithURL', () => {
    const defaultConfig: BaseClickHouseClientConfigOptionsWithURL = {
      url: new URL('http://localhost:8123/'),
    }

    it('should get all defaults with no extra configuration', async () => {
      const res = prepareConfigWithURL({}, logger, null)
      expect(res).toEqual(defaultConfig)
    })

    it('should fall back to default HTTP/HTTPS port numbers', async () => {
      expect(
        prepareConfigWithURL({ url: 'http://localhost:80' }, logger, null),
      ).toEqual({
        url: new URL('http://localhost/'), // default HTTP port 80 is omitted
      })
      expect(
        prepareConfigWithURL({ url: 'https://localhost:443' }, logger, null),
      ).toEqual({
        url: new URL('https://localhost/'), // default HTTPS port 443 is omitted
      })
    })

    it('should use non-default HTTP/HTTPS port numbers', async () => {
      const sampleValidPorts = ['1', '65535', '8123', '8080', '8443']
      for (const protocol of ['http', 'https']) {
        for (const port of sampleValidPorts) {
          expect(
            prepareConfigWithURL(
              { url: `${protocol}://localhost:${port}` },
              logger,
              null,
            ),
            `${protocol} with valid port ${port} should not throw`,
          ).toEqual({
            url: new URL(`${protocol}://localhost:${port}/`),
          })
        }
      }
    })

    it('should throw when the HTTP/HTTPS port is not valid', async () => {
      const invalidPorts = ['foo', '65536', '-1']
      for (const protocol of ['http', 'https']) {
        for (const port of invalidPorts) {
          expect(
            () =>
              prepareConfigWithURL(
                { url: `${protocol}://localhost:${port}` },
                logger,
                null,
              ),
            `${protocol} with invalid port ${port} is expected to throw`,
          ).toThrow(
            expect.objectContaining({
              message: expect.stringContaining('ClickHouse URL is malformed'),
            }),
          )
        }
      }
    })

    it('should set everything, overriding the defaults', async () => {
      const res = prepareConfigWithURL(
        {
          url: 'https://my.host:8443',
          pathname: '/my_proxy',
          request_timeout: 42_000,
          max_open_connections: 144,
          username: 'bob',
          password: 'secret',
          database: 'analytics',
          http_headers: {
            'X-CLICKHOUSE-AUTH': 'secret_header',
          },
          keep_alive: { enabled: false },
          application: 'my_app',
          // override the default HTTP settings + extra CH settings
          clickhouse_settings: {
            http_headers_progress_interval_ms: '55000',
            send_progress_in_http_headers: 0,
            async_insert: 1,
          },
          // by default both are disabled
          compression: {
            request: true,
            response: true,
          },
        },
        logger,
        null,
      )
      expect(res).toEqual({
        url: new URL('https://my.host:8443/my_proxy'),
        pathname: '/my_proxy',
        request_timeout: 42_000,
        max_open_connections: 144,
        username: 'bob',
        password: 'secret',
        database: 'analytics',
        http_headers: {
          'X-CLICKHOUSE-AUTH': 'secret_header',
        },
        keep_alive: { enabled: false },
        application: 'my_app',
        clickhouse_settings: {
          http_headers_progress_interval_ms: '55000',
          send_progress_in_http_headers: 0,
          async_insert: 1,
        },
        compression: {
          request: true,
          response: true,
        },
      })
    })

    it('should be able to use the deprecated host parameter', async () => {
      const deprecated: BaseClickHouseClientConfigOptions = {
        host: 'https://my.host:8443',
      }
      const res = prepareConfigWithURL(deprecated, logger, null)
      expect(res).toEqual({
        ...defaultConfig,
        url: new URL('https://my.host:8443/'),
      })
      expect(deprecated).toEqual({
        host: 'https://my.host:8443',
      }) // should not be modified
    })

    it('should be able to use the deprecated additional_headers parameter', async () => {
      const deprecated: BaseClickHouseClientConfigOptions = {
        additional_headers: {
          'X-CLICKHOUSE-AUTH': 'secret_header',
        },
      }
      const res = prepareConfigWithURL(deprecated, logger, null)
      expect(res).toEqual({
        ...defaultConfig,
        http_headers: {
          'X-CLICKHOUSE-AUTH': 'secret_header',
        },
      })
      expect(deprecated).toEqual({
        additional_headers: {
          'X-CLICKHOUSE-AUTH': 'secret_header',
        },
      }) // should not be modified
    })

    // tested more thoroughly in the loadConfigOptionsFromURL section;
    // this is just a validation that everything works together
    it('should use settings from the URL', async () => {
      const res = prepareConfigWithURL(
        {
          url:
            'https://bob:secret@my.host:8443/analytics?' +
            ['application=my_app', 'impl_specific_setting=42'].join('&'),
        },
        logger,
        (config) => {
          return {
            config: {
              ...config,
              impl_specific_setting: 42,
            },
            handled_params: new Set(['impl_specific_setting']),
            unknown_params: new Set(),
          }
        },
      )
      expect(res).toEqual({
        ...defaultConfig,
        url: new URL('https://my.host:8443/'),
        username: 'bob',
        password: 'secret',
        database: 'analytics',
        application: 'my_app',
        impl_specific_setting: 42,
      } as unknown as BaseClickHouseClientConfigOptionsWithURL)
    })

    describe('Pathname', () => {
      it('should correctly load pathname + database from the URL', async () => {
        const pathNames = [
          'my_proxy',
          'my_proxy/ch',
          'my_proxy/',
          'my_proxy/ch/',
        ]
        pathNames.forEach((pathname) => {
          const url = new URL(
            'http://my_host:8124/my_db?' +
              [
                'application=my_app',
                `pathname=${pathname}`,
                'request_timeout=42000',
                'max_open_connections=2',
              ].join('&'),
          )
          const res = prepareConfigWithURL({ url }, logger, null)
          expect(res, `With pathname (no trailing slash) ${pathname}`).toEqual({
            ...defaultConfig,
            pathname,
            url: new URL(`http://my_host:8124/${pathname}`),
            application: 'my_app',
            database: 'my_db',
            request_timeout: 42000,
            max_open_connections: 2,
          } as unknown as BaseClickHouseClientConfigOptionsWithURL)
        })
      })

      it('should correctly load pathname + database from the URL (leading slash)', async () => {
        const leadingSlashPathNames = [
          '/my_proxy',
          '/my_proxy/ch',
          '/my_proxy/',
          '/my_proxy/ch/',
        ]
        leadingSlashPathNames.forEach((pathname) => {
          const url = new URL(
            'http://my_host:8124/my_db?' +
              [
                'application=my_app',
                `pathname=${pathname}`,
                'request_timeout=42000',
                'max_open_connections=2',
              ].join('&'),
          )
          const res = prepareConfigWithURL({ url }, logger, null)
          expect(res, `With pathname (leading slash only) ${pathname}`).toEqual(
            {
              ...defaultConfig,
              pathname,
              url: new URL('http://my_host:8124' + pathname),
              application: 'my_app',
              database: 'my_db',
              request_timeout: 42000,
              max_open_connections: 2,
            } as unknown as BaseClickHouseClientConfigOptionsWithURL,
          )
        })
      })

      it('should correctly process pathname with the default db', async () => {
        const url = new URL(
          'http://my_host:8124?' +
            [
              'application=my_app',
              `pathname=my_proxy`,
              'request_timeout=42000',
              'max_open_connections=2',
            ].join('&'),
        )
        const res = prepareConfigWithURL({ url }, logger, null)
        expect(res).toEqual({
          ...defaultConfig,
          url: new URL(`http://my_host:8124/my_proxy`),
          application: 'my_app',
          pathname: 'my_proxy',
          // no `database` key
          request_timeout: 42000,
          max_open_connections: 2,
        } as unknown as BaseClickHouseClientConfigOptionsWithURL)
      })
    })

    describe('Credentials vs JWT auth parsing', () => {
      it('should correctly get JWT access_token from the URL', async () => {
        const url = new URL(
          'https://my.host:8443/analytics?' +
            ['application=my_app', 'access_token=jwt_secret'].join('&'),
        )
        const res = prepareConfigWithURL({ url }, logger, null)
        expect(res).toEqual({
          ...defaultConfig,
          url: new URL('https://my.host:8443'),
          database: 'analytics',
          application: 'my_app',
          access_token: 'jwt_secret',
        } as unknown as BaseClickHouseClientConfigOptionsWithURL)
      })

      // this will throw later during the config validation anyway
      it('should correctly override credentials auth with JWT if both are present', async () => {
        const url = new URL(
          'https://bob:secret@my.host:8443/analytics?' +
            ['application=my_app', 'access_token=jwt_secret'].join('&'),
        )
        const res = prepareConfigWithURL({ url }, logger, null)
        expect(res).toEqual({
          ...defaultConfig,
          url: new URL('https://my.host:8443'),
          database: 'analytics',
          application: 'my_app',
          username: 'bob',
          password: 'secret',
          access_token: 'jwt_secret',
        } as unknown as BaseClickHouseClientConfigOptionsWithURL)
      })
    })

    // more detailed tests are in the createUrl section
    it('should throw when the URL is not valid', async () => {
      expect(() => prepareConfigWithURL({ url: 'foo' }, logger, null)).toThrow(
        expect.objectContaining({
          message: expect.stringContaining('ClickHouse URL is malformed.'),
        }),
      )
    })
  })

  describe('getConnectionParams', () => {
    const authErrorMatcher = expect.objectContaining({
      message: expect.stringContaining(
        'Please use only one authentication method',
      ),
    })

    it('should return the default connection params', async () => {
      const res = getConnectionParams(
        {
          url: new URL('https://my.host:8443/'),
        },
        logger,
      )
      expect(res).toEqual({
        url: new URL('https://my.host:8443/'),
        request_timeout: 30_000,
        max_open_connections: 10,
        compression: {
          decompress_response: false,
          compress_request: false,
        },
        auth: {
          username: 'default',
          password: '',
          type: 'Credentials',
        },
        database: 'default',
        clickhouse_settings: {},
        log_writer: expect.any(LogWriter),
        log_level: ClickHouseLogLevel.OFF,
        unsafeLogUnredactedQueries: false,
        keep_alive: { enabled: true },
        application_id: undefined,
        http_headers: {},
        json: {
          parse: JSON.parse,
          stringify: JSON.stringify,
        },
      })
    })

    it('should set connection params from the config', async () => {
      const res = getConnectionParams(
        {
          url: new URL('https://my.host:8443/'),
          request_timeout: 42_000,
          max_open_connections: 144,
          compression: {
            request: true,
            response: false,
          },
          username: 'bob',
          password: 'secret',
          database: 'analytics',
          clickhouse_settings: {
            async_insert: 1,
          },
          http_headers: {
            'X-CLICKHOUSE-AUTH': 'secret_header',
          },
          keep_alive: { enabled: false },
          application: 'my_app',
        },
        logger,
      )
      expect(res).toEqual({
        url: new URL('https://my.host:8443/'),
        request_timeout: 42_000,
        max_open_connections: 144,
        compression: {
          compress_request: true,
          decompress_response: false,
        },
        auth: {
          username: 'bob',
          password: 'secret',
          type: 'Credentials',
        },
        database: 'analytics',
        clickhouse_settings: {
          async_insert: 1,
        },
        http_headers: {
          'X-CLICKHOUSE-AUTH': 'secret_header',
        },
        log_writer: expect.any(LogWriter),
        log_level: ClickHouseLogLevel.OFF,
        unsafeLogUnredactedQueries: false,
        keep_alive: { enabled: false },
        application_id: 'my_app',
        json: {
          parse: JSON.parse,
          stringify: JSON.stringify,
        },
      })
    })

    it('should throw if both JWT and username are set', async () => {
      expect(() =>
        getConnectionParams(
          {
            url: new URL('https://my.host:8443/'),
            username: 'bob',
            access_token: 'jwt',
          },
          logger,
        ),
      ).toThrow(authErrorMatcher)
    })

    it('should throw if both JWT and password are set', async () => {
      expect(() =>
        getConnectionParams(
          {
            url: new URL('https://my.host:8443/'),
            password: 'secret',
            access_token: 'jwt',
          },
          logger,
        ),
      ).toThrow(authErrorMatcher)
    })

    it('should throw if JWT, username, and password are all set', async () => {
      expect(() =>
        getConnectionParams(
          {
            url: new URL('https://my.host:8443/'),
            username: 'bob',
            password: 'secret',
            access_token: 'jwt',
          },
          logger,
        ),
      ).toThrow(authErrorMatcher)
    })

    it('should not throw if only JWT auth is set', async () => {
      expect(
        getConnectionParams(
          {
            url: new URL('https://my.host:8443/'),
            access_token: 'secret-token',
          },
          logger,
        ),
      ).toEqual({
        url: new URL('https://my.host:8443/'),
        request_timeout: 30_000,
        max_open_connections: 10,
        compression: {
          decompress_response: false,
          compress_request: false,
        },
        auth: {
          access_token: 'secret-token',
          type: 'JWT',
        },
        database: 'default',
        clickhouse_settings: {},
        log_writer: expect.any(LogWriter),
        log_level: ClickHouseLogLevel.OFF,
        unsafeLogUnredactedQueries: false,
        keep_alive: { enabled: true },
        application_id: undefined,
        http_headers: {},
        json: {
          parse: JSON.parse,
          stringify: JSON.stringify,
        },
      })
    })
  })

  describe('mergeConfigs', () => {
    it('should merge two empty configs', async () => {
      expect(mergeConfigs({}, {}, logger)).toEqual({})
    })

    it('should leave the base config as-is when there is nothing from the URL', async () => {
      const base: BaseClickHouseClientConfigOptions = {
        url: 'http://localhost:8123',
        username: 'bob',
        password: 'secret',
      }
      expect(mergeConfigs(base, {}, logger)).toEqual(base)
    })

    it('should take URL values first, then base config for the rest', async () => {
      const base: BaseClickHouseClientConfigOptions = {
        url: 'https://my.host:8124',
        username: 'bob',
        password: 'secret',
      }
      const fromURL: BaseClickHouseClientConfigOptions = {
        password: 'secret_from_url!',
      }
      const res = mergeConfigs(base, fromURL, logger)
      expect(res).toEqual({
        url: 'https://my.host:8124',
        username: 'bob',
        password: 'secret_from_url!',
      })
    })

    it('should just merge non-conflicting values', async () => {
      const base: BaseClickHouseClientConfigOptions = {
        url: 'https://my.host:8124',
      }
      const fromURL: BaseClickHouseClientConfigOptions = {
        username: 'bob',
        password: 'secret',
      }
      const res = mergeConfigs(base, fromURL, logger)
      expect(res).toEqual({
        url: 'https://my.host:8124',
        username: 'bob',
        password: 'secret',
      })
    })

    // realistically, we will always have at least URL in the base config
    it('should only take the URL values when there is nothing in the base config', async () => {
      const fromURL: BaseClickHouseClientConfigOptions = {
        url: 'https://my.host:8443',
        username: 'bob',
        password: 'secret',
      }
      const res = mergeConfigs({}, fromURL, logger)
      expect(res).toEqual({
        url: 'https://my.host:8443',
        username: 'bob',
        password: 'secret',
      })
    })

    it('should correctly work with nested levels when there are no defaults', async () => {
      const base: BaseClickHouseClientConfigOptions = {
        url: 'https://my.host:8124',
        application: 'my_app',
        // does not have clickhouse_settings
      }
      const fromURL: BaseClickHouseClientConfigOptions = {
        clickhouse_settings: {
          wait_for_async_insert: 0,
        },
      }
      const res = mergeConfigs(base, fromURL, logger)
      expect(res).toEqual({
        url: 'https://my.host:8124',
        application: 'my_app',
        clickhouse_settings: {
          wait_for_async_insert: 0,
        },
      })
    })

    it('should deep merge two configs', async () => {
      const base: BaseClickHouseClientConfigOptions = {
        url: 'https://my.host:8124',
        application: 'my_app',
        compression: {
          response: false,
        },
        clickhouse_settings: {
          async_insert: 1,
        },
      }
      const fromURL: BaseClickHouseClientConfigOptions = {
        pathname: '/my_proxy',
        clickhouse_settings: {
          wait_for_async_insert: 0,
        },
      }
      const res = mergeConfigs(base, fromURL, logger)
      expect(res).toEqual({
        url: 'https://my.host:8124',
        application: 'my_app',
        pathname: '/my_proxy',
        compression: {
          response: false,
        },
        clickhouse_settings: {
          async_insert: 1,
          wait_for_async_insert: 0,
        },
      })
    })

    it('should deep merge more than two levels', async () => {
      // Currently, we don't have this. Future-proofing.
      type TestOptions = BaseClickHouseClientConfigOptions & {
        very: {
          deeply: {
            nested_setting: string
            nested: {
              setting: number
            }
            this_is_not_overridden?: number[]
          }
        }
      }
      const base: TestOptions = {
        url: 'https://my.host:8124',
        clickhouse_settings: {
          async_insert: 1,
        },
        very: {
          deeply: {
            nested_setting: 'foo',
            nested: {
              setting: 42,
            },
            this_is_not_overridden: [1, 2, 3],
          },
        },
      }
      const fromURL: TestOptions = {
        clickhouse_settings: {
          wait_for_async_insert: 0,
        },
        very: {
          deeply: {
            nested_setting: 'bar',
            nested: {
              setting: 144,
            },
          },
        },
      }

      const res = mergeConfigs(base, fromURL, logger)
      expect(res as TestOptions).toEqual({
        url: 'https://my.host:8124',
        clickhouse_settings: {
          async_insert: 1,
          wait_for_async_insert: 0,
        },
        very: {
          deeply: {
            nested_setting: 'bar',
            nested: {
              setting: 144,
            },
            this_is_not_overridden: [1, 2, 3],
          },
        },
      })
    })

    it('should deep merge two configs with nested overrides', async () => {
      const base: BaseClickHouseClientConfigOptions = {
        url: 'https://my.host:8124',
        compression: {
          request: true,
          response: false,
        },
        clickhouse_settings: {
          async_insert: 1,
        },
      }
      const fromURL: BaseClickHouseClientConfigOptions = {
        compression: {
          request: false,
          response: true,
        },
        clickhouse_settings: {
          async_insert: 0,
          wait_for_async_insert: 0,
        },
      }
      const res = mergeConfigs(base, fromURL, logger)
      expect(res).toEqual({
        url: 'https://my.host:8124',
        compression: {
          request: false,
          response: true,
        },
        clickhouse_settings: {
          async_insert: 0,
          wait_for_async_insert: 0,
        },
      })
    })
  })

  describe('createUrl', () => {
    it('should create valid URLs', async () => {
      expect(createUrl(undefined)).toEqual(new URL('http://localhost:8123/'))
      expect(createUrl('http://localhost:8123')).toEqual(
        new URL('http://localhost:8123/'),
      )
      expect(createUrl('https://bob:secret@my.host:8124')).toEqual(
        new URL('https://bob:secret@my.host:8124/'),
      )
    })

    it('should fail when the provided URL is not valid', async () => {
      expect(() => createUrl('foo')).toThrow(
        expect.objectContaining({
          message: expect.stringContaining('ClickHouse URL is malformed.'),
        }),
      )
      expect(() => createUrl('http://localhost:foo')).toThrow(
        expect.objectContaining({
          message: expect.stringContaining('ClickHouse URL is malformed.'),
        }),
      )
      expect(() => createUrl('tcp://localhost:8443')).toThrowError(
        'ClickHouse URL protocol must be either http or https. Got: tcp:',
      )
    })
  })

  describe('loadConfigOptionsFromURL', () => {
    it('should load all possible config options from the URL params', async () => {
      const url = new URL(
        'https://bob:secret@my.host:8124/analytics?' +
          [
            'application=my_app',
            'pathname=/my_proxy',
            'session_id=sticky',
            'request_timeout=42',
            'max_open_connections=144',
            'compression_request=1',
            'compression_response=false',
            'log_level=TRACE',
            'keep_alive_enabled=false',
            'clickhouse_setting_async_insert=1',
            'ch_wait_for_async_insert=0',
            'http_header_X-CLICKHOUSE-AUTH=secret_header',
          ].join('&'),
      )
      const res = loadConfigOptionsFromURL(url, null)
      expect(res[0].toString()).toEqual('https://my.host:8124/') // pathname will be attached later.
      expect(res[1]).toEqual({
        username: 'bob',
        password: 'secret',
        database: 'analytics',
        application: 'my_app',
        pathname: '/my_proxy',
        session_id: 'sticky',
        request_timeout: 42,
        max_open_connections: 144,
        compression: {
          request: true,
          response: false,
        },
        log: { level: ClickHouseLogLevel.TRACE },
        keep_alive: { enabled: false },
        clickhouse_settings: {
          // type (string vs number) does not really matter here, as it will be serialized anyway
          // it is only important that the value itself is correct.
          async_insert: '1',
          wait_for_async_insert: '0',
        } as Record<string, string>,
        http_headers: {
          'X-CLICKHOUSE-AUTH': 'secret_header',
        },
      })
    })

    it('should load only auth from the URL, the rest of the config is unset', async () => {
      const url = new URL('http://bob:secret@localhost:8124/analytics')
      const res = loadConfigOptionsFromURL(url, null)
      expect(res[0].toString()).toEqual('http://localhost:8124/')
      expect(res[1]).toEqual({
        username: 'bob',
        password: 'secret',
        database: 'analytics',
      })
    })

    it('should load only the settings from the URL, without auth', async () => {
      const url = new URL(
        'http://localhost:8124/?' +
          [
            'application=my_app',
            'request_timeout=42000',
            'max_open_connections=2',
          ].join('&'),
      )
      const res = loadConfigOptionsFromURL(url, null)
      expect(res[0].toString()).toEqual('http://localhost:8124/')
      expect(res[1]).toEqual({
        application: 'my_app',
        request_timeout: 42000,
        max_open_connections: 2,
      })
    })

    it('should not parse anything into the config when the URL params are empty', async () => {
      const url = new URL('http://localhost:8124')
      const res = loadConfigOptionsFromURL(url, null)
      expect(res[0].toString()).toEqual('http://localhost:8124/')
      expect(res[1]).toEqual({})
    })

    // this lack of validation is a subject to change;
    // however, it might be not feasible to define and validate every setting defined in the client
    it('should not fail if there is an arbitrary clickhouse_setting provided (not yet typed in the client)', async () => {
      const url = new URL('http://localhost:8125/?ch_this_is_a_new_one=1')
      const res = loadConfigOptionsFromURL(url, null)
      expect(res[0].toString()).toEqual('http://localhost:8125/')
      expect(res[1]).toEqual({
        clickhouse_settings: {
          this_is_a_new_one: '1',
        },
      })
    })

    it('should fail if there is an unknown setting and the extra URL params handler is not provided', async () => {
      const url1 = new URL('http://localhost:8124/?this_was_unexpected=1')
      expect(() => loadConfigOptionsFromURL(url1, null)).toThrowError(
        'Unknown URL parameters: this_was_unexpected',
      )
      const url2 = new URL('http://localhost:8124/?url=this_is_not_allowed')
      expect(() => loadConfigOptionsFromURL(url2, null)).toThrowError(
        'Unknown URL parameters: url',
      )
    })

    it('should not fail if an unknown default setting is handled by the extra URL params handler', async () => {
      const url = new URL('http://localhost:8124/?impl_specific_setting=42')
      const handler: HandleImplSpecificURLParams = (config) => {
        return {
          config: {
            ...config,
            impl_specific_setting: 42,
          },
          handled_params: new Set(['impl_specific_setting']),
          unknown_params: new Set(),
        }
      }
      const res = loadConfigOptionsFromURL(url, handler)
      expect(res[0].toString()).toEqual('http://localhost:8124/')
      expect(res[1]).toEqual({
        impl_specific_setting: 42,
      } as unknown as BaseClickHouseClientConfigOptions)
    })

    it('should fail if the parameter is still unknown after calling the extra URL params handler', async () => {
      const url = new URL('http://localhost:8124/?impl_specific_setting=42')
      const handler: HandleImplSpecificURLParams = (config) => {
        return {
          config,
          handled_params: new Set(),
          unknown_params: new Set(['impl_specific_setting']),
        }
      }
      expect(() => loadConfigOptionsFromURL(url, handler)).toThrowError(
        'Unknown URL parameters: impl_specific_setting',
      )
    })

    it('should fail if only some parameters were handled by the extra URL params handler', async () => {
      const url = new URL(
        'http://localhost:8124/?impl_specific_setting=42&whatever=1',
      )
      const handler: HandleImplSpecificURLParams = (config) => {
        return {
          config: {
            ...config,
            impl_specific_setting: 42,
          },
          handled_params: new Set(['impl_specific_setting']),
          unknown_params: new Set(['whatever']),
        }
      }
      expect(() => loadConfigOptionsFromURL(url, handler)).toThrowError(
        'Unknown URL parameters: whatever',
      )
    })

    it('should not fail when some of the settings were parsed in common and some in the extra URL params handler', async () => {
      const url = new URL(
        'https://bob:secret@my.host:8124/analytics?' +
          [
            'application=my_app',
            'session_id=sticky',
            'request_timeout=42',
            'max_open_connections=144',
            'compression_request=1',
            'compression_response=true',
            'log_level=TRACE',
            'keep_alive_enabled=false',
            'clickhouse_setting_async_insert=1',
            'ch_wait_for_async_insert=0',
            'http_header_X-CLICKHOUSE-AUTH=secret_header',
            'impl_specific_setting=qaz',
            'another_impl_specific_setting=qux',
          ].join('&'),
      )
      const handler: HandleImplSpecificURLParams = (config) => {
        return {
          config: {
            ...config,
            impl_specific_setting: 'qaz',
            another_impl_specific_setting: 'qux',
          },
          handled_params: new Set([
            'impl_specific_setting',
            'another_impl_specific_setting',
          ]),
          unknown_params: new Set(),
        }
      }
      const res = loadConfigOptionsFromURL(url, handler)
      expect(res[0].toString()).toEqual('https://my.host:8124/')
      expect(res[1]).toEqual({
        username: 'bob',
        password: 'secret',
        database: 'analytics',
        application: 'my_app',
        session_id: 'sticky',
        request_timeout: 42,
        max_open_connections: 144,
        compression: {
          request: true,
          response: true,
        },
        log: { level: ClickHouseLogLevel.TRACE },
        keep_alive: { enabled: false },
        clickhouse_settings: {
          async_insert: '1',
          wait_for_async_insert: '0',
        } as Record<string, string>,
        http_headers: {
          'X-CLICKHOUSE-AUTH': 'secret_header',
        },
        impl_specific_setting: 'qaz',
        another_impl_specific_setting: 'qux',
      } as unknown as BaseClickHouseClientConfigOptions)
    })

    // URL params that were handled by common are removed from the URL passed down to the extra handler by design
    it('should not override common config with the extra URL params handler', async () => {
      const url = new URL(
        'https://bob:secret@my.host:8124/analytics?' +
          [
            'application=my_app',
            'session_id=sticky',
            'request_timeout=42',
          ].join('&'),
      )
      const handler: HandleImplSpecificURLParams = (config, url) => {
        // should fail the assertion if not empty
        if (url.searchParams.size > 0) {
          throw new Error(
            `Unexpected URL params: ${url.searchParams.toString()}`,
          )
        }
        return {
          config,
          handled_params: new Set(),
          unknown_params: new Set(),
        }
      }
      const res = loadConfigOptionsFromURL(url, handler)
      expect(res[0].toString()).toEqual('https://my.host:8124/')
      expect(res[1]).toEqual({
        username: 'bob',
        password: 'secret',
        database: 'analytics',
        application: 'my_app',
        session_id: 'sticky',
        request_timeout: 42,
      })
    })
  })

  describe('ConfigURLValues', () => {
    const key = 'foo'

    it('should be parsed with booleanConfigURLValue', async () => {
      const args: [string, boolean][] = [
        ['true', true],
        [' true ', true],
        ['false', false],
        [' false ', false],
        ['1', true],
        [' 1 ', true],
        ['0', false],
        [' 0 ', false],
      ]
      args.forEach(([value, expected]) => {
        expect(
          booleanConfigURLValue({ key, value }),
          `Expected value "${value}" to be ${expected}`,
        ).toEqual(expected)
      })
      expect(() => booleanConfigURLValue({ key, value: 'bar' })).toThrowError(
        `"foo" has invalid boolean value: bar. Expected one of: 0, 1, true, false.`,
      )
    })

    it('should be parsed with numberConfigURLValue', async () => {
      const args: [string, number][] = [
        ['0', 0],
        [' 0 ', 0],
        ['1', 1],
        [' 1 ', 1],
        ['-1', -1],
        [' -1 ', -1],
        ['1.5', 1.5],
        [' 1.5 ', 1.5],
      ]
      args.forEach(([value, expected]) => {
        expect(
          numberConfigURLValue({ key, value }),
          `Expected value "${value}" to be ${expected}`,
        ).toEqual(expected)
      })
      expect(() => numberConfigURLValue({ key, value: 'bar' })).toThrowError(
        `"foo" has invalid numeric value: bar`,
      )
    })

    it('should be parsed with numberConfigURLValue (min constraint)', async () => {
      expect(numberConfigURLValue({ key, value: '2', min: 1 })).toEqual(2)
      expect(numberConfigURLValue({ key, value: '2', min: 2 })).toEqual(2)
      expect(() =>
        numberConfigURLValue({ key, value: '2', min: 3 }),
      ).toThrowError(`"foo" value 2 is less than min allowed 3`)
    })

    it('should be parsed with numberConfigURLValue (max constraint)', async () => {
      expect(numberConfigURLValue({ key, value: '2', max: 2 })).toEqual(2)
      expect(numberConfigURLValue({ key, value: '2', max: 3 })).toEqual(2)
      expect(() =>
        numberConfigURLValue({ key, value: '4', max: 3 }),
      ).toThrowError(`"foo" value 4 is greater than max allowed 3`)
    })

    it('should be parsed with numberConfigURLValue (both min/max constraints)', async () => {
      const r1 = numberConfigURLValue({ key, value: '1', min: 1, max: 2 })
      expect(r1).toEqual(1)
      const r2 = numberConfigURLValue({ key, value: '2', min: 2, max: 2 })
      expect(r2).toEqual(2)
      expect(() =>
        numberConfigURLValue({ key, value: '2', min: 3, max: 4 }),
      ).toThrowError(`"foo" value 2 is less than min allowed 3`)
      expect(() =>
        numberConfigURLValue({ key, value: '5', min: 3, max: 4 }),
      ).toThrowError(`"foo" value 5 is greater than max allowed 4`)
    })

    it('should be parsed with enumConfigURLValue', async () => {
      const args: [string, ClickHouseLogLevel][] = [
        ['TRACE', ClickHouseLogLevel.TRACE],
        [' TRACE ', ClickHouseLogLevel.TRACE],
        ['DEBUG', ClickHouseLogLevel.DEBUG],
        [' DEBUG ', ClickHouseLogLevel.DEBUG],
        ['INFO', ClickHouseLogLevel.INFO],
        [' INFO ', ClickHouseLogLevel.INFO],
        ['WARN', ClickHouseLogLevel.WARN],
        [' WARN ', ClickHouseLogLevel.WARN],
        ['ERROR', ClickHouseLogLevel.ERROR],
        [' ERROR ', ClickHouseLogLevel.ERROR],
        ['OFF', ClickHouseLogLevel.OFF],
        [' OFF ', ClickHouseLogLevel.OFF],
      ]
      args.forEach(([value, expected]) => {
        expect(
          enumConfigURLValue({
            key,
            value,
            enumObject: ClickHouseLogLevel,
          }),
          `Expected log level for value "${value}" is ${expected}`,
        ).toEqual(expected)
      })
      expect(() =>
        enumConfigURLValue({
          key,
          value: 'bar',
          enumObject: ClickHouseLogLevel,
        }),
      ).toThrowError(
        `"foo" has invalid value: bar. Expected one of: TRACE, DEBUG, INFO, WARN, ERROR, OFF.`,
      )
    })
  })
})
