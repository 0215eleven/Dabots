// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Happy Coder Contributors
// Adapted from slopus/happy d6b85a0dda14c9582e1f083539fd11d99924022f
// packages/happy-cli/src/api/encryption.ts encryptBox/encryptLegacy/decryptLegacy.
// Changes: explicit RNG; raw bytes instead of JSON; strict framing/size validation.
// Original permission notice: vendor/LICENSE.happy.
import nacl from 'tweetnacl';
export function randomBytesFrom(randomBytes, size) {
  if (typeof randomBytes !== 'function') throw new Error('Secure randomness is required.');
  const bytes = randomBytes(size);
  if (!(bytes instanceof Uint8Array) || bytes.length !== size) throw new Error('Invalid secure random source.');
  return bytes.slice();
}
export function keyPair(randomBytes) { return nacl.box.keyPair.fromSecretKey(randomBytesFrom(randomBytes,32)); }
export function wrapKey(data, recipientPublicKey, randomBytes) {
  const ephemeral = keyPair(randomBytes);
  const nonce = randomBytesFrom(randomBytes,24);
  try {
    const encrypted = nacl.box(data,nonce,recipientPublicKey,ephemeral.secretKey);
    const output = new Uint8Array(32+24+encrypted.length);
    output.set(ephemeral.publicKey);output.set(nonce,32);output.set(encrypted,56);
    return output;
  } finally { ephemeral.secretKey.fill(0); }
}
export function unwrapKey(bundle, secretKey) {
  if (!(bundle instanceof Uint8Array) || bundle.length < 72 || bundle.length > 16384) throw new Error('Invalid key envelope.');
  const plain=nacl.box.open(bundle.subarray(56),bundle.subarray(32,56),bundle.subarray(0,32),secretKey);
  if(!plain)throw new Error('Key envelope authentication failed.');
  return plain;
}
export function seal(data,key,randomBytes) {
  const nonce=randomBytesFrom(randomBytes,24),ciphertext=nacl.secretbox(data,nonce,key);
  const output=new Uint8Array(24+ciphertext.length);output.set(nonce);output.set(ciphertext,24);return output;
}
export function open(data,key) {
  if(!(data instanceof Uint8Array)||data.length<40||data.length>1048576)throw new Error('Invalid encrypted record.');
  const plain=nacl.secretbox.open(data.subarray(24),data.subarray(0,24),key);
  if(!plain)throw new Error('Record authentication failed.');return plain;
}
