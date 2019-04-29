# aes128gcm-stream
[![Build Status](https://travis-ci.com/nwtgck/aes128gcm-stream-npm.svg?branch=develop)](https://travis-ci.com/nwtgck/aes128gcm-stream-npm)

128-bit AES-GCM Encryption Stream for Web Browsers

## Thanks for Firefox Send project

The original source code has come from [Firefox Send](https://send.firefox.com/), [mozilla/send](https://github.com/mozilla/send).
I appreciate that contributors created that streaming encryption feature, so I preserved the original contributors' commits which the project uses.

## Installation

Install by npm from this GitHub repository

```bash
npm install -S git+https://github.com/nwtgck/aes128gcm-stream-npm#v0.1.2
```

## Usage

Here is an usage in TypeScript.  
You can remove the types and it will be available in **JavaScript** either.

```ts
// TypeScript


// Import
import {encryptStream, decryptStream} from 'aes128gcm-stream';
// Create a simple readable
// e.g. (await fetch("...")).body is ReadableStream
const readableStream: ReadableStream<Uint8Array> = ...
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
```
