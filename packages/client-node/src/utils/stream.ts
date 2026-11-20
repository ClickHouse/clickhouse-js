import Stream from "stream";
import { constants } from "buffer";

const { MAX_STRING_LENGTH } = constants;

export function isStream(obj: unknown): obj is Stream.Readable {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "pipe" in obj &&
    typeof obj.pipe === "function" &&
    "on" in obj &&
    typeof obj.on === "function"
  );
}

export async function getAsText(stream: Stream.Readable): Promise<string> {
  try {
    let text = "";

    const textDecoder = new TextDecoder();
    for await (const chunk of stream) {
      text += textDecoder.decode(chunk, { stream: true });
    }

    // flush unfinished multi-byte characters
    text += textDecoder.decode();

    return text;
  } catch (err) {
    // V8 (Node.js) throws a RangeError with "Invalid string length" once a
    // string grows past MAX_STRING_LENGTH; JavaScriptCore (Bun) throws a
    // RangeError with "Out of memory" in the same situation.
    if (
      err instanceof RangeError &&
      (err.message.includes("Invalid string length") ||
        err.message.includes("Out of memory"))
    ) {
      throw new Error(
        `The response length exceeds the maximum allowed size of a string: ${MAX_STRING_LENGTH} characters.`,
        { cause: err },
      );
    }
    throw err;
  }
}

/** The stream that `mapStream` returns sends a batch when the batch reaches
 *  this number of UTF-16 characters (not bytes). */
const MAP_STREAM_BATCH_SIZE = 64 * 1024;

/**
 * Maps each object of an object-mode stream to a string.
 *
 * The returned stream sends the strings in batches, not one by one. This is
 * important for an HTTP request body. The request sends each write as a
 * separate chunk, and each chunk adds about 5 bytes of chunk framing. The
 * stream code and the HTTP code also process each chunk separately. When each
 * small row is a chunk, the request body is about 50% larger.
 *
 * The stream sends a batch when the batch reaches {@link MAP_STREAM_BATCH_SIZE}
 * characters. It checks the size after it adds a row, so one large row makes a
 * larger batch. It sends the rows that arrive in the same turn of the event
 * loop as one batch at the end of that turn, so a slow source does not keep its
 * rows in the buffer. It sends the last batch when the stream ends. A slow
 * consumer still stops the source.
 *
 * The stream sends each batch as a Buffer, not as a string, because of a bug in
 * Node.js 24.22.0 and later 24.x releases, and in Node.js 26.9.0 and later 26.x
 * releases (https://github.com/nodejs/node/issues/66781). There,
 * `http.ClientRequest` counts the size of the strings that it collects in
 * bytes, and the socket counts them in characters. With non-ASCII text, the
 * request waits for a 'drain' event that the socket does not send, and the
 * request body stops after about 64 KiB. Node.js fixed the bug in
 * https://github.com/nodejs/node/pull/66782, but Node.js 24.22.3 and 26.13.1
 * do not have the fix.
 */
export function mapStream(
  mapper: (input: unknown) => string,
): Stream.Transform {
  let batch = "";
  let sendScheduled = false;
  return new Stream.Transform({
    objectMode: true,
    // Each object on the readable side is a batch, not a row. Keep at most one
    // batch in the buffer, so that an insert that waits does not hold 16 batches.
    readableHighWaterMark: 1,
    transform(chunk, encoding, callback) {
      try {
        batch += mapper(chunk);
      } catch (err) {
        // For example, JSON.stringify of an object with a circular reference.
        // Fail the stream instead of throwing from the callback.
        batch = "";
        // A custom `json.stringify` can throw a value that is not an Error.
        // A falsy value (undefined, null) would make the callback succeed,
        // and the rows of the batch would be lost. Always give an Error.
        return callback(
          err instanceof Error
            ? err
            : new Error(`Cannot encode a row: ${String(err)}`, { cause: err }),
        );
      }
      // The stream stops its source when the consumer is slow. It does this
      // only for data that it sends from this callback. For this reason, send
      // the batch from here when the batch is full or the output buffer is full.
      if (
        batch.length >= MAP_STREAM_BATCH_SIZE ||
        this.readableLength >= this.readableHighWaterMark
      ) {
        const readyBatch = batch;
        batch = "";
        return callback(
          null,
          readyBatch.length > 0 ? Buffer.from(readyBatch) : undefined,
        );
      }
      if (!sendScheduled) {
        // The server can time out while it waits for the request body.
        // For this reason, the rows of a slow source must not stay in the
        // buffer. Send them at the end of this turn of the event loop.
        sendScheduled = true;
        setImmediate(() => {
          sendScheduled = false;
          if (batch.length > 0 && !this.destroyed) {
            const partialBatch = batch;
            batch = "";
            this.push(Buffer.from(partialBatch));
          }
        });
      }
      callback();
    },
    flush(callback) {
      const lastBatch = batch;
      batch = "";
      callback(null, lastBatch.length > 0 ? Buffer.from(lastBatch) : undefined);
    },
  });
}
