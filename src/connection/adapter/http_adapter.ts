import Stream from 'stream';
import Http from 'http';
import { parseError } from '../../error/parse_error';

import type {
  Connection,
  ConnectionParams,
  BaseParams,
  InsertParams,
} from '../connection';
import { toSearchParams } from './http_search_params';
import { isStream, getAsText } from '../../utils';

interface RequestParams {
  method: 'GET' | 'POST';
  path: string;
  headers?: Record<string, string>;
  body?: string | Stream.Readable;
  abort_signal?: AbortSignal;
}

function isSuccessfulResponse(statusCode?: number): boolean {
  return Boolean(statusCode && 200 <= statusCode && statusCode < 300);
}

function isEventTarget(signal: any): signal is EventTarget {
  return 'removeEventListener' in signal;
}
export class HttpAdapter implements Connection {
  private readonly agent: Http.Agent;
  private readonly url: URL;
  private readonly headers: Http.OutgoingHttpHeaders;
  constructor(private readonly config: ConnectionParams) {
    this.url = new URL(this.config.host);
    this.agent = new Http.Agent({
      keepAlive: true,
      timeout: config.request_timeout,
    });
    this.headers = this.buildDefaultHeaders(config.username, config.password);
  }

  private buildDefaultHeaders(
    username: string,
    password: string
  ): Http.OutgoingHttpHeaders {
    return {
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString(
        'base64'
      )}`,
    };
  }

  private async request(params: RequestParams): Promise<Stream.Readable> {
    return new Promise((resolve, reject) => {
      const request = Http.request({
        protocol: this.url.protocol,
        hostname: this.url.hostname,
        port: this.url.port,
        path: params.path,
        method: params.method,
        agent: this.agent,
        headers: this.headers,
      });
      function onError(err: Error): void {
        removeRequestListeners();
        reject(err);
      }

      async function onResponse(response: Http.IncomingMessage): Promise<void> {
        if (isSuccessfulResponse(response.statusCode)) {
          return resolve(response);
        } else {
          reject(parseError(await getAsText(response)));
        }
      }

      function onTimeout(): void {
        removeRequestListeners();
        request.once('error', function () {
          /**
           * catch "Error: ECONNRESET" error which shouldn't be reported to users.
           * see the full sequence of events https://nodejs.org/api/http.html#httprequesturl-options-callback
           * */
        });
        request.destroy();
        reject(new Error('Timeout error'));
      }

      function onAbortSignal(): void {
        // instead of deprecated request.abort()
        request.destroy(new Error('The request was aborted.'));
      }

      function onAbort(): void {
        // Prefer 'abort' event since it always triggered unlike 'error' and 'close'
        // * see the full sequence of events https://nodejs.org/api/http.html#httprequesturl-options-callback
        removeRequestListeners();
        request.once('error', function () {
          /**
           * catch "Error: ECONNRESET" error which shouldn't be reported to users.
           * see the full sequence of events https://nodejs.org/api/http.html#httprequesturl-options-callback
           * */
        });
        reject(new Error('The request was aborted.'));
      }

      function onClose(): void {
        // Adapter uses 'close' event to cleanup listeners after the successful response.
        // It's necessary in order to handle 'abort' and 'timeout' events while response is streamed.
        // setImmediate is a workaround. If a request cancelled before sent, the 'abort' happens after 'close'.
        // Which contradicts the docs https://nodejs.org/docs/latest-v14.x/api/http.html#http_http_request_url_options_callback
        setImmediate(removeRequestListeners);
      }

      function removeRequestListeners(): void {
        request.removeListener('response', onResponse);
        request.removeListener('error', onError);
        request.removeListener('timeout', onTimeout);
        request.removeListener('abort', onAbort);
        request.removeListener('close', onClose);
        if (params.abort_signal !== undefined) {
          if (isEventTarget(params.abort_signal)) {
            params.abort_signal.removeEventListener('abort', onAbortSignal);
          } else {
            // @ts-expect-error if it's EventEmitter
            params.abort_signal.removeListener('abort', onAbortSignal);
          }
        }
      }

      if (params.abort_signal) {
        // We should use signal API when nodejs v14 is not supported anymore.
        // However, it seems that Http.request doesn't abort after 'response' event.
        // Requires an additional investigation
        // https://nodejs.org/api/globals.html#class-abortsignal
        params.abort_signal.addEventListener('abort', onAbortSignal, {
          once: true,
        });
      }

      request.on('response', onResponse);
      request.on('timeout', onTimeout);
      request.on('error', onError);
      request.on('abort', onAbort);
      request.on('close', onClose);

      if (isStream(params.body)) {
        Stream.pipeline(params.body, request, (err) => {
          if (err) {
            removeRequestListeners();
            reject(err);
          }
        });
      } else {
        request.end(params.body);
      }
    });
  }

  async ping(): Promise<boolean> {
    // TODO add status code check
    const response = await this.request({
      method: 'GET',
      path: '/ping',
    });
    response.destroy();
    return true;
  }

  async select(params: BaseParams): Promise<Stream.Readable> {
    // TODO: add retry
    const searchParams = toSearchParams(
      params.clickhouse_settings,
      params.query_params
    );

    const result = await this.request({
      method: 'POST',
      path: '/?' + searchParams?.toString(),
      body: params.query,
      abort_signal: params.abort_signal,
    });
    return result;
  }

  async command(params: BaseParams): Promise<void> {
    const searchParams = toSearchParams(
      params.clickhouse_settings,
      params.query_params
    );
    await this.request({
      method: 'POST',
      path: '/?' + searchParams?.toString(),
      body: params.query,
      abort_signal: params.abort_signal,
    });

    // return await getAsText(result);
  }

  async insert(params: InsertParams): Promise<void> {
    const searchParams = toSearchParams(
      params.clickhouse_settings,
      params.query_params,
      params.query
    );
    await this.request({
      method: 'POST',
      path: '/?' + searchParams?.toString(),
      body: params.values,
      abort_signal: params.abort_signal,
    });
  }

  async close(): Promise<void> {
    if (this.agent !== undefined && this.agent.destroy !== undefined) {
      this.agent.destroy();
    }
  }
}
