import {encryptStream, decryptStream}  from '../src/ece';
import * as assert from 'power-assert';

async function getWholeString(readableStream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = readableStream.getReader();
  const decoder = new TextDecoder();
  let text: string = '';
  while(true) {
    const {done, value} = await reader.read();
    if (done) {
      break;
    }
    text += decoder.decode(value);
  }
  return text;
}

function createSimpleReadableStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start: (controller) => {
      // "ABC"
      controller.enqueue(new Uint8Array([65, 66, 67]));
      // "abc"
      controller.enqueue(new Uint8Array([97, 98, 99]));
      controller.close();
    }
  });
}

describe('ece', () => {
  it('should encrypt and decrypt', async () => {
    // Create a simple readable
    const readableStream: ReadableStream<Uint8Array> = createSimpleReadableStream();
    // Generate random key
    const key: Uint8Array = crypto.getRandomValues(new Uint8Array(16));
    // Encrypt
    const encryptedStream: ReadableStream<Uint8Array> = encryptStream(
      readableStream,
      key,
    );
    // Decrypt
    const decryptedStream: ReadableStream<Uint8Array> = decryptStream(
      encryptedStream,
      key
    );
    // Get as a text
    const text = await getWholeString(decryptedStream);
    assert.strictEqual(text, 'ABCabc');
  });
});
