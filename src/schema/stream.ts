import Stream from 'stream';
import { SelectResult } from './result';

export interface SelectStream<T> {
  onData(cb: (data: T) => void): void;
  asResult(): Promise<SelectResult<T>>;
}

export class InsertStream<T> extends Stream.Readable {
  constructor() {
    super({
      objectMode: true,
      read() {
        // Avoid [ERR_METHOD_NOT_IMPLEMENTED]: The _read() method is not implemented
      },
    });
  }
  add(data: T) {
    this.push(data);
  }
  complete(): void {
    this.push(null);
  }
}
