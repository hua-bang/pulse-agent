export class HarnessError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}
