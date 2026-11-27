import { Worker } from "worker_threads";

/**
 * Busy-waits for `ms` milliseconds. Meanwhile, no timer, I/O callback or
 * immediate can run on this thread, and Node.js does not read its sockets.
 */
export function blockEventLoop(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    // busy wait
  }
}

export interface WorkerServer {
  port: number;
  stop: () => Promise<void>;
}

/**
 * Runs a test server in a worker thread, so that the server keeps its own
 * event loop and acts on its sockets while the test blocks the main thread.
 * `serverCode` must post the port to `parentPort` when it listens, and close
 * the server and exit when it gets the "close" message.
 */
export async function startServerInWorker(
  serverCode: string,
): Promise<WorkerServer> {
  const worker = new Worker(serverCode, { eval: true });
  let exited = false;
  const exit = new Promise<void>((resolve) => {
    worker.once("exit", () => {
      exited = true;
      resolve();
    });
  });
  const port = await new Promise<number>((resolve, reject) => {
    worker.once("message", (port: number) => resolve(port));
    worker.once("error", reject);
  });
  return {
    port,
    stop: async () => {
      if (!exited) {
        worker.postMessage("close");
      }
      await exit;
    },
  };
}
