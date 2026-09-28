export class InvariantError extends Error {
  constructor(message: string) {
    super(`Invariant violated: ${message}`);
    this.name = 'InvariantError';
  }
}

export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new InvariantError(message);
}

/** Narrows an indexed read (which is `T | undefined` under noUncheckedIndexedAccess). */
export function defined<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new InvariantError(message);
  return value;
}

export function assertNever(value: never, context: string): never {
  throw new InvariantError(`${context}: unexpected value ${JSON.stringify(value)}`);
}
