import Stream from 'stream'

export interface SelectResult<T> {
  asyncGenerator(): AsyncGenerator<T, void>
  json(): Promise<T[]>
}

export class InsertStream<T> extends Stream.Readable {
  constructor() {
    super({
      objectMode: true,
      read() {
        // Avoid [ERR_METHOD_NOT_IMPLEMENTED]: The _read() method is not implemented
      },
    })
  }
  add(data: T) {
    this.push(data)
  }
  complete(): void {
    this.push(null)
  }
}
