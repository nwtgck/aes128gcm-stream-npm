import 'buffer';
import { transformStream } from './streams';

const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 16;
const MODE_ENCRYPT = 'encrypt';
const MODE_DECRYPT = 'decrypt';
export const ECE_RECORD_SIZE = 1024 * 64;

const encoder = new TextEncoder();

function generateSalt(len: number): ArrayBuffer {
  const randSalt = new Uint8Array(len);
  crypto.getRandomValues(randSalt);
  return randSalt.buffer;
}

type Header = {
  salt: ArrayBuffer,
  rs: number,
  length: number
};

class ECETransformer implements Transformer<Uint8Array, Uint8Array> {
  mode: 'encrypt' | 'decrypt';
  prevChunk: Buffer;
  seq: number;
  firstchunk: boolean;
  rs: number;
  ikm: ArrayBuffer;
  salt?: ArrayBuffer;
  nonceBase: Buffer;
  key: CryptoKey;

  constructor(mode: 'encrypt' | 'decrypt', ikm: Uint8Array, rs: number, salt?: ArrayBuffer) {
    this.mode = mode;
    this.prevChunk;
    this.seq = 0;
    this.firstchunk = true;
    this.rs = rs;
    this.ikm = ikm.buffer;
    this.salt = salt;
  }

  async generateKey(): Promise<CryptoKey> {
    const inputKey = await crypto.subtle.importKey(
      'raw',
      this.ikm,
      'HKDF',
      false,
      ['deriveKey']
    );

    return crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        salt: this.salt,
        info: encoder.encode('Content-Encoding: aes128gcm\0'),
        hash: 'SHA-256'
      } as any, // TODO: Don't use any
      inputKey,
      {
        name: 'AES-GCM',
        length: 128
      },
      true, // Edge polyfill requires key to be extractable to encrypt :/
      ['encrypt', 'decrypt']
    );
  }

  async generateNonceBase(): Promise<Buffer> {
    const inputKey = await crypto.subtle.importKey(
      'raw',
      this.ikm,
      'HKDF',
      false,
      ['deriveKey']
    );

    const base = await crypto.subtle.exportKey(
      'raw',
      await crypto.subtle.deriveKey(
        {
          name: 'HKDF',
          salt: this.salt,
          info: encoder.encode('Content-Encoding: nonce\0'),
          hash: 'SHA-256'
        } as any,  // TODO: Don't use any
        inputKey,
        {
          name: 'AES-GCM',
          length: 128
        },
        true,
        ['encrypt', 'decrypt']
      )
    );

    return Buffer.from(base.slice(0, NONCE_LENGTH));
  }

  generateNonce(seq: number): Buffer {
    if (seq > 0xffffffff) {
      throw new Error('record sequence number exceeds limit');
    }
    const nonce = Buffer.from(this.nonceBase);
    const m = nonce.readUIntBE(nonce.length - 4, 4);
    const xor = (m ^ seq) >>> 0; //forces unsigned int xor
    nonce.writeUIntBE(xor, nonce.length - 4, 4);

    return nonce;
  }

  pad(data: Uint8Array, isLast: boolean): Buffer {
    const len = data.length;
    if (len + TAG_LENGTH >= this.rs) {
      throw new Error('data too large for record size');
    }

    if (isLast) {
      const padding = Buffer.alloc(1);
      padding.writeUInt8(2, 0);
      return Buffer.concat([data, padding]);
    } else {
      const padding = Buffer.alloc(this.rs - len - TAG_LENGTH);
      padding.fill(0);
      padding.writeUInt8(1, 0);
      return Buffer.concat([data, padding]);
    }
  }

  unpad(data: Uint8Array, isLast: boolean): Uint8Array {
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i]) {
        if (isLast) {
          if (data[i] !== 2) {
            throw new Error('delimiter of final record is not 2');
          }
        } else {
          if (data[i] !== 1) {
            throw new Error('delimiter of not final record is not 1');
          }
        }
        return data.slice(0, i);
      }
    }
    throw new Error('no delimiter found');
  }

  createHeader(): Buffer {
    if (this.salt === undefined) throw new Error('salt is undefined');
    const nums = Buffer.alloc(5);
    nums.writeUIntBE(this.rs, 0, 4);
    nums.writeUIntBE(0, 4, 1);
    return Buffer.concat([Buffer.from(this.salt), nums]);
  }

  readHeader(buffer: Buffer): Header {
    if (buffer.length < 21) {
      throw new Error('chunk too small for reading header');
    }
    const header: Header = {} as Header;
    header.salt = buffer.buffer.slice(0, KEY_LENGTH);
    header.rs = buffer.readUIntBE(KEY_LENGTH, 4);
    const idlen = buffer.readUInt8(KEY_LENGTH + 4);
    header.length = idlen + KEY_LENGTH + 5;
    return header;
  }

  async encryptRecord(buffer: Buffer, seq: number, isLast: boolean): Promise<Buffer> {
    const nonce = this.generateNonce(seq);
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      this.key,
      this.pad(buffer, isLast)
    );
    return Buffer.from(encrypted);
  }

  async decryptRecord(buffer: Buffer, seq: number, isLast: boolean): Promise<Uint8Array> {
    const nonce = this.generateNonce(seq);
    const data = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: nonce,
        tagLength: 128
      },
      this.key,
      buffer
    );

    return this.unpad(Buffer.from(data), isLast);
  }

  async start(controller: TransformStreamDefaultController<Uint8Array>) {
    if (this.mode === MODE_ENCRYPT) {
      this.key = await this.generateKey();
      this.nonceBase = await this.generateNonceBase();
      controller.enqueue(this.createHeader());
    } else if (this.mode !== MODE_DECRYPT) {
      throw new Error('mode must be either encrypt or decrypt');
    }
  }

  async transformPrevChunk(isLast: boolean, controller: TransformStreamDefaultController<Uint8Array>) {
    if (this.mode === MODE_ENCRYPT) {
      controller.enqueue(
        await this.encryptRecord(this.prevChunk, this.seq, isLast)
      );
      this.seq++;
    } else {
      if (this.seq === 0) {
        //the first chunk during decryption contains only the header
        const header = this.readHeader(this.prevChunk);
        this.salt = header.salt;
        this.rs = header.rs;
        this.key = await this.generateKey();
        this.nonceBase = await this.generateNonceBase();
      } else {
        controller.enqueue(
          await this.decryptRecord(this.prevChunk, this.seq - 1, isLast)
        );
      }
      this.seq++;
    }
  }

  async transform(chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>) {
    if (!this.firstchunk) {
      await this.transformPrevChunk(false, controller);
    }
    this.firstchunk = false;
    this.prevChunk = Buffer.from(chunk.buffer);
  }

  async flush(controller: TransformStreamDefaultController<Uint8Array>) {
    //console.log('ece stream ends')
    if (this.prevChunk) {
      await this.transformPrevChunk(true, controller);
    }
  }
}

class StreamSlicer implements Transformer<Uint8Array, Uint8Array>{
  rs: number;
  mode: 'encrypt' | 'decrypt';
  chunkSize: number;
  partialChunk: Uint8Array;
  offset: number;

  constructor(rs: number, mode: 'encrypt' | 'decrypt') {
    this.mode = mode;
    this.rs = rs;
    this.chunkSize = mode === MODE_ENCRYPT ? rs - 17 : 21;
    this.partialChunk = new Uint8Array(this.chunkSize); //where partial chunks are saved
    this.offset = 0;
  }

  send(buf: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>) {
    controller.enqueue(buf);
    if (this.chunkSize === 21 && this.mode === MODE_DECRYPT) {
      this.chunkSize = this.rs;
    }
    this.partialChunk = new Uint8Array(this.chunkSize);
    this.offset = 0;
  }

  //reslice input into record sized chunks
  transform(chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>) {
    //console.log('Received chunk with %d bytes.', chunk.byteLength)
    let i = 0;

    if (this.offset > 0) {
      const len = Math.min(chunk.byteLength, this.chunkSize - this.offset);
      this.partialChunk.set(chunk.slice(0, len), this.offset);
      this.offset += len;
      i += len;

      if (this.offset === this.chunkSize) {
        this.send(this.partialChunk, controller);
      }
    }

    while (i < chunk.byteLength) {
      const remainingBytes = chunk.byteLength - i;
      if (remainingBytes >= this.chunkSize) {
        const record = chunk.slice(i, i + this.chunkSize);
        i += this.chunkSize;
        this.send(record, controller);
      } else {
        const end = chunk.slice(i, i + remainingBytes);
        i += end.byteLength;
        this.partialChunk.set(end);
        this.offset = end.byteLength;
      }
    }
  }

  flush(controller: TransformStreamDefaultController<Uint8Array>) {
    if (this.offset > 0) {
      controller.enqueue(this.partialChunk.slice(0, this.offset));
    }
  }
}

/*
input: a ReadableStream containing data to be transformed
key:  Uint8Array containing key of size KEY_LENGTH
rs:   int containing record size, optional
salt: ArrayBuffer containing salt of KEY_LENGTH length, optional
*/
export function encryptStream(
  input: ReadableStream<Uint8Array>,
  key: Uint8Array,
  rs: number = ECE_RECORD_SIZE,
  salt: ArrayBuffer = generateSalt(KEY_LENGTH)
) {
  const mode = 'encrypt';
  const inputStream = transformStream(input, new StreamSlicer(rs, mode));
  return transformStream(inputStream, new ECETransformer(mode, key, rs, salt));
}

/*
input: a ReadableStream containing data to be transformed
key:  Uint8Array containing key of size KEY_LENGTH
rs:   int containing record size, optional
*/
export function decryptStream(input: ReadableStream<Uint8Array>, key: Uint8Array, rs: number = ECE_RECORD_SIZE) {
  const mode = 'decrypt';
  const inputStream = transformStream(input, new StreamSlicer(rs, mode));
  return transformStream(inputStream, new ECETransformer(mode, key, rs));
}