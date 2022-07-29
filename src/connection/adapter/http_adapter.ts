import Stream from 'stream';
import Http from 'http';
import { parseError } from '../../error/parse_error';

import type {
  Connection,
  ConnectionParams,
  BaseParams,
  InsertParams
} from '../connection';
import { toSearchParams } from './http_search_params';
import { isStream, getAsText } from '../../utils';

interface RequestParams {
  method: 'GET' | 'POST';
  path: string;
  headers?: Record<string, string>;
  body?: string | Stream.Readable;
}

function isSuccessfulResponse(statusCode?: number): boolean {
  return Boolean(statusCode && 200 <= statusCode && statusCode < 300);
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

  private buildDefaultHeaders(username: string, password: string): Http.OutgoingHttpHeaders {
      return {
        'Authorization': `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
      }
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

      function onError (err: Error): void {
        removeRequestListeners()
        reject(err)
      }

      function onClose() {
        removeRequestListeners();
      }

      async function onResponse(response: Http.IncomingMessage): Promise<void> {
        removeRequestListeners();

        if(isSuccessfulResponse(response.statusCode)) {
          return resolve(response)
        } else {
          reject(parseError(await getAsText(response)));
        }
      }

      function removeRequestListeners() {
        request.removeListener('response', onResponse);
        request.removeListener('error', onError);
        request.removeListener('close', onClose);
      }

      request.on('response', onResponse);
      // TODO check whether it's closed automatically
      // request.on('timeout', onTimeout)
      request.on('error', onError);
      request.on('close', onClose);

      if (isStream(params.body)) {
        Stream.pipeline(params.body, request, (err) => {
          if (err != null) {
            removeRequestListeners();
            reject(err);
          }
        })
      } else {
        request.end(params.body)
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
    const searchParams = toSearchParams(params.clickhouse_settings, params.query_params);

    const result = await this.request({
      method: 'POST',
      path: '/?' + searchParams?.toString(),
      body: params.query
    });
    return result;
  }

  async command(params: BaseParams): Promise<void> {
    const searchParams = toSearchParams(params.clickhouse_settings, params.query_params);
    await this.request({
      method: 'POST',
      path: '/?' + searchParams?.toString(),
      body: params.query,
    });

    // return await getAsText(result);
  }

  async insert(params: InsertParams): Promise<void> {
    const searchParams = toSearchParams(params.clickhouse_settings, params.query_params, params.query);
    await this.request({
      method: 'POST',
      path: '/?' + searchParams?.toString(),
      body: params.values
    });
  }

  async close(): Promise<void> {
    if (this.agent !== undefined && this.agent.destroy !== undefined) {
      this.agent.destroy()
    }
  }
}
