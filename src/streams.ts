/* global ReadableStream TransformStream */

export function transformStream(readable: ReadableStream<Uint8Array>, transformer: Transformer<Uint8Array, Uint8Array>, oncancel?: (reason?: any) => Promise<void>): ReadableStream<Uint8Array> {
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
