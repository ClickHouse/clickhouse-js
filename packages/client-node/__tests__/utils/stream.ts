import Stream from "stream";

export function makeRawStream() {
  return new Stream.Readable({
    objectMode: false,
    read() {
      /* stub */
    },
  });
}

export function makeObjectStream() {
  return new Stream.Readable({
    objectMode: true,
    read() {
      /* stub */
    },
  });
}

// Test-local helper to fully read a stream into a string. Mirrors the client's
// internal `getAsText`, kept here so the integration specs depend only on the
// published package surface (and stay runnable against the built `dist`).
export async function getAsText(stream: Stream.Readable): Promise<string> {
  let text = "";
  const textDecoder = new TextDecoder();
  for await (const chunk of stream) {
    text += textDecoder.decode(chunk, { stream: true });
  }
  // flush any unfinished multi-byte characters
  text += textDecoder.decode();
  return text;
}
