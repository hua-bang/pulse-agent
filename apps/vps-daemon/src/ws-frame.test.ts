import type { IncomingMessage } from 'node:http';
import { Duplex } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { acceptWebSocket } from './ws-frame.js';

function fakeSocket() {
  const written: Buffer[] = [];
  const socket = new Duplex({
    read() {},
    write(chunk: Buffer, _enc, cb) {
      written.push(Buffer.from(chunk));
      cb();
    },
  });
  return { socket, written };
}

/** Client frame: masked, 64-bit length form. */
function clientFrame(opcode: number, fin: boolean, payload: Buffer): Buffer {
  const header = Buffer.alloc(14);
  header[0] = (fin ? 0x80 : 0) | opcode;
  header[1] = 0x80 | 127;
  header.writeBigUInt64BE(BigInt(payload.length), 2);
  // All-zero mask keeps the payload unchanged.
  return Buffer.concat([header, payload]);
}

const req = { headers: { 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' } } as unknown as IncomingMessage;

describe('acceptWebSocket', () => {
  it('delivers a fragmented text message under the limit', () => {
    const { socket } = fakeSocket();
    const ws = acceptWebSocket(req, socket, Buffer.alloc(0));
    const received: string[] = [];
    ws?.onMessage((text) => received.push(text));
    socket.emit('data', clientFrame(0x1, false, Buffer.from('hel')));
    socket.emit('data', clientFrame(0x0, true, Buffer.from('lo')));
    expect(received).toEqual(['hello']);
    ws?.close();
  });

  it('closes with 1009 when fragments add up past the message limit', () => {
    const { socket, written } = fakeSocket();
    const ws = acceptWebSocket(req, socket, Buffer.alloc(0));
    const received: string[] = [];
    let closed = false;
    ws?.onMessage((text) => received.push(text));
    ws?.onClose(() => {
      closed = true;
    });
    const part = Buffer.alloc(700 * 1024, 0x61);
    socket.emit('data', clientFrame(0x1, false, part));
    socket.emit('data', clientFrame(0x0, true, part));
    expect(received).toEqual([]);
    expect(closed).toBe(true);
    const closeFrame = written.find((buf) => buf[0] === 0x88);
    expect(closeFrame?.readUInt16BE(2)).toBe(1009);
  });
});
