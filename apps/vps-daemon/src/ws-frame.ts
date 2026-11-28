import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

const WS_MAGIC_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME_BYTES = 1024 * 1024; // 1 MiB guard for terminal input/control frames

export interface WsConnection {
  sendText(text: string): void;
  close(code?: number): void;
  onMessage(listener: (text: string) => void): void;
  onClose(listener: () => void): void;
}

function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

export function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  try {
    socket.write(
      `HTTP/1.1 ${status} ${message}\r\n` +
        'Connection: close\r\n' +
        'Content-Type: text/plain\r\n' +
        `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n` +
        message,
    );
  } catch {
    // Ignore broken pipe.
  }
  socket.destroy();
}

export function acceptWebSocket(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): WsConnection | null {
  const key = req.headers['sec-websocket-key'];
  if (typeof key !== 'string' || !key.trim()) {
    rejectUpgrade(socket, 400, 'Missing Sec-WebSocket-Key');
    return null;
  }
  const accept = createHash('sha1').update(`${key.trim()}${WS_MAGIC_GUID}`).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );

  let closed = false;
  let buffer: Buffer = head.length > 0 ? Buffer.from(head) : Buffer.alloc(0);
  let fragmentedChunks: Buffer[] = [];
  let fragmentedOpcode: number | null = null;
  const messageListeners = new Set<(text: string) => void>();
  const closeListeners = new Set<() => void>();

  const notifyClose = () => {
    if (closed) return;
    closed = true;
    clearInterval(keepalive);
    for (const cb of closeListeners) {
      try {
        cb();
      } catch {
        /* ignore */
      }
    }
    closeListeners.clear();
    messageListeners.clear();
  };

  const sendRaw = (frame: Buffer) => {
    if (closed || socket.destroyed) return;
    try {
      socket.write(frame);
    } catch {
      notifyClose();
    }
  };

  const close = (code = 1000) => {
    if (closed) return;
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(code, 0);
    sendRaw(encodeFrame(0x8, payload));
    socket.end();
    notifyClose();
  };

  const keepalive = setInterval(() => {
    if (closed || socket.destroyed) {
      notifyClose();
      return;
    }
    sendRaw(encodeFrame(0x9, Buffer.alloc(0)));
  }, 20_000);
  keepalive.unref();

  const processBuffer = () => {
    while (buffer.length >= 2 && !closed) {
      const b0 = buffer[0];
      const b1 = buffer[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let payloadLen = b1 & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (buffer.length < 4) return;
        payloadLen = buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (buffer.length < 10) return;
        const bigLen = buffer.readBigUInt64BE(2);
        if (bigLen > BigInt(MAX_FRAME_BYTES)) {
          close(1009);
          return;
        }
        payloadLen = Number(bigLen);
        offset = 10;
      }

      if (payloadLen > MAX_FRAME_BYTES) {
        close(1009);
        return;
      }
      const maskLen = masked ? 4 : 0;
      const frameEnd = offset + maskLen + payloadLen;
      if (buffer.length < frameEnd) return;

      const payload = Buffer.allocUnsafe(payloadLen);
      if (masked) {
        const maskOffset = offset;
        const dataOffset = offset + 4;
        for (let i = 0; i < payloadLen; i += 1) {
          payload[i] = buffer[dataOffset + i] ^ buffer[maskOffset + (i & 3)];
        }
      } else {
        buffer.copy(payload, 0, offset, frameEnd);
      }
      buffer = buffer.subarray(frameEnd);

      if (opcode === 0x8) {
        close(1000);
        return;
      }
      if (opcode === 0x9) {
        sendRaw(encodeFrame(0xa, payload));
        continue;
      }
      if (opcode === 0xa) {
        continue;
      }

      if (opcode === 0x1 || opcode === 0x2) {
        if (fin) {
          if (opcode === 0x1) {
            const text = payload.toString('utf8');
            for (const cb of messageListeners) {
              try {
                cb(text);
              } catch {
                /* ignore */
              }
            }
          }
        } else {
          fragmentedOpcode = opcode;
          fragmentedChunks = [payload];
        }
      } else if (opcode === 0x0 && fragmentedOpcode !== null) {
        fragmentedChunks.push(payload);
        if (fin) {
          const full = Buffer.concat(fragmentedChunks);
          const origOpcode = fragmentedOpcode;
          fragmentedOpcode = null;
          fragmentedChunks = [];
          if (origOpcode === 0x1) {
            const text = full.toString('utf8');
            for (const cb of messageListeners) {
              try {
                cb(text);
              } catch {
                /* ignore */
              }
            }
          }
        }
      }
    }
  };

  socket.on('data', (chunk: Buffer) => {
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
    processBuffer();
  });
  socket.on('close', notifyClose);
  socket.on('end', notifyClose);
  socket.on('error', notifyClose);

  if (buffer.length > 0) {
    processBuffer();
  }

  return {
    sendText: (text: string) => sendRaw(encodeFrame(0x1, Buffer.from(text, 'utf8'))),
    close,
    onMessage: (listener) => {
      if (!closed) messageListeners.add(listener);
    },
    onClose: (listener) => {
      if (closed) listener();
      else closeListeners.add(listener);
    },
  };
}
