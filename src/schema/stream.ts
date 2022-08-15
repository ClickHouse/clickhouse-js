import Stream from 'stream';

export interface SelectStream<T> {
  onData(cb: (data: T) => void): void;
  asArray(): Promise<T[]>;
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
  end(): void {
    this.push(null);
  }
}
