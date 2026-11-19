import Stream from "stream";
import { constants } from "buffer";
import { isResultChunk } from "../result_chunk";

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
    const parts: string[] = [];
    let length = 0;

    const textDecoder = new TextDecoder();
    for await (const chunk of stream) {
      // The result of query() comes in parts (see ResultChunk).
      const part = isResultChunk(chunk) ? chunk.text() : chunk;
      const text =
        typeof part === "string"
          ? part
          : textDecoder.decode(part, { stream: true });
      length += text.length;
      if (length > MAX_STRING_LENGTH) {
        throw new RangeError("Invalid string length");
      }
      if (text.length > 0) parts.push(text);
    }

    // flush unfinished multi-byte characters
    parts.push(textDecoder.decode());
    return parts.join("");
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

/** Changes object-mode rows into a stream of serialized bytes. */
export function mapStream(
  mapper: (input: unknown) => string,
): Stream.Transform {
  return new Stream.Transform({
    writableObjectMode: true,
    transform(chunk, _encoding, callback) {
      let bytes: Buffer;
      try {
        bytes = Buffer.from(mapper(chunk));
      } catch (err) {
        callback(err as Error);
        return;
      }
      callback(null, bytes);
    },
  });
}

/** Reads a response stream to its end and drops the data. Destroying the
 *  stream of an unfinished result closes its connection instead of giving it
 *  back to the pool. The same function as in `@clickhouse/client`, so that code
 *  can switch to this package by changing only the import.
 *  @deprecated This method is not intended to be used outside of the client implementation anymore. Use `client.command()` instead, which will handle draining the stream internally when needed.
 * */
export async function drainStream(stream: Stream.Readable): Promise<void> {
  return new Promise((resolve, reject) => {
    // If the stream has already emitted an error, we can reject the promise immediately.
    if (stream.errored) {
      // the stream is already errored, no need to attach listeners
      reject(stream.errored);
      return;
    }

    // Avoid a race condition where the stream has already sent the 'end' event before we attach the listener.
    // In this case, we can resolve the promise immediately without attaching any listeners.
    if (stream.readableEnded) {
      // the stream is already ended, no need to attach listeners
      resolve();
      return;
    }

    // If the stream is already closed, we can resolve the promise immediately as well.
    if (stream.closed) {
      // the stream is already closed, no need to attach listeners
      resolve();
      return;
    }

    function dropData() {
      // used only for the methods without expected response; we don't care about the data here
    }

    function onEnd() {
      removeListeners();
      resolve();
    }

    function onError(err: Error) {
      removeListeners();
      reject(err);
    }

    function onClose() {
      removeListeners();
      // The `end` event might not be emitted if the server closes the connection.
      // Making sure to resolve the promise in this case as well.
      resolve();
    }

    function removeListeners() {
      stream.removeListener("data", dropData);
      stream.removeListener("end", onEnd);
      stream.removeListener("error", onError);
      stream.removeListener("close", onClose);
    }

    stream.on("data", dropData);
    stream.on("end", onEnd);
    stream.on("error", onError);
    stream.on("close", onClose);
  });
}
