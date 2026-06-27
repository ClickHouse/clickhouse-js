// Test-local helper to fully read a web ReadableStream into a string. Mirrors
// the client's internal `getAsText`, kept here so the integration specs depend
// only on the published package surface (and stay runnable against the built
// `dist`).
export async function getAsText(stream: ReadableStream): Promise<string> {
  const textDecoder = new TextDecoder();
  const reader = stream.getReader();
  let text = "";
  let chunk = await reader.read();
  while (!chunk.done) {
    text += textDecoder.decode(chunk.value, { stream: true });
    chunk = await reader.read();
  }
  // flush any unfinished multi-byte characters
  text += textDecoder.decode();
  return text;
}
