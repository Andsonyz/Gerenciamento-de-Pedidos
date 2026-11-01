export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = status === 409 ? "BUSINESS_CONFLICT" : "REQUEST_REJECTED",
  ) {
    super(message);
  }
}
