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

/**
 * Maps each object of an object-mode stream to a string, and sends the
 * string as a Buffer.
 *
 * The stream sends Buffers, not strings, because of a bug in Node.js 24.22.0
 * and later 24.x releases, and in Node.js 26.9.0 and later 26.x releases
 * (https://github.com/nodejs/node/issues/66781). There, `http.ClientRequest`
 * counts the size of the strings that it collects in bytes, and the socket
 * counts them in characters. With non-ASCII text, the request waits for a
 * 'drain' event that the socket does not send, and the request body stops
 * after about 64 KiB. Node.js fixed the bug in
 * https://github.com/nodejs/node/pull/66782, but Node.js 24.22.3 and 26.13.1
 * do not have the fix.
 */
export function mapStream(
  mapper: (input: unknown) => string,
): Stream.Transform {
  return new Stream.Transform({
    objectMode: true,
    transform(chunk, encoding, callback) {
      callback(null, Buffer.from(mapper(chunk)));
    },
  });
}
