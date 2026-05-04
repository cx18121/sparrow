export class GenerationError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 500) {
    super(message);
  }
}
