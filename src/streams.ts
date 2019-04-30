/* global ReadableStream TransformStream */

export function transformStream(readable: ReadableStream<Uint8Array>, transformer: Transformer<Uint8Array, Uint8Array>, oncancel?: ReadableStreamErrorCallback): ReadableStream<Uint8Array> {
  try {
    return readable.pipeThrough(new TransformStream(transformer));
  } catch (e) {
    const reader = readable.getReader();
    return new ReadableStream<Uint8Array>({
      start(controller) {
        if (transformer.start) {
          // TODO: Don't use any
          return transformer.start(controller as any);
        }
      },
      async pull(controller) {
        let enqueued = false;
        const wrappedController = {
          enqueue(d: Uint8Array): void {
            enqueued = true;
            controller.enqueue(d);
          }
        };
        while (!enqueued) {
          const data = await reader.read();
          if (data.done) {
            if (transformer.flush) {
              // TODO: Don't use any
              await transformer.flush(controller as any);
            }
            return controller.close();
          }
          // TODO: Don't use any
          // @ts-ignore
          await transformer.transform(data.value, wrappedController as any);
        }
      },
      cancel(reason) {
        readable.cancel(reason);
        if (oncancel) {
          oncancel(reason);
        }
      }
    });
  }
}

class BlobStreamController implements UnderlyingSource<Uint8Array> {
  blob: Blob;
  index: number;
  chunkSize: number;

  constructor(blob: Blob, size: number) {
    this.blob = blob;
    this.index = 0;
    this.chunkSize = size || 1024 * 64;
  }

  pull(controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> {
    return new Promise((resolve, reject) => {
      const bytesLeft = this.blob.size - this.index;
      if (bytesLeft <= 0) {
        controller.close();
        return resolve();
      }
      const size = Math.min(this.chunkSize, bytesLeft);
      const slice = this.blob.slice(this.index, this.index + size);
      const reader = new FileReader();
      reader.onload = () => {
        controller.enqueue(new Uint8Array(reader.result as ArrayBuffer));
        resolve();
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(slice);
      this.index += size;
    });
  }
}

export function blobStream(blob: Blob, size: number): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>(new BlobStreamController(blob, size));
}

class ConcatStreamController implements UnderlyingSource<Uint8Array> {
  streams: ReadableStream<Uint8Array>[];
  index: number;
  reader: ReadableStreamDefaultReader | null;

  constructor(streams: ReadableStream<Uint8Array>[]) {
    this.streams = streams;
    this.index = 0;
    this.reader = null;
    this.nextReader();
  }

  nextReader() {
    const next = this.streams[this.index++];
    this.reader = next && next.getReader();
  }

  async pull(controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> {
    if (!this.reader) {
      return controller.close();
    }
    const data = await this.reader.read();
    if (data.done) {
      this.nextReader();
      return this.pull(controller);
    }
    controller.enqueue(data.value);
  }
}

export function concatStream(streams: ReadableStream<Uint8Array>[]): ReadableStream<Uint8Array> {
  return new ReadableStream(new ConcatStreamController(streams));
}
