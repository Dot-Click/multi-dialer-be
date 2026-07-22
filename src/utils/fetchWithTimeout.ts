/**
 * Wraps fetch() with a hard timeout, aborting the request if the upstream
 * server never responds. Without this, a hanging third-party API leaves the
 * request open until some outer proxy kills it (often as a bare 504 with no
 * useful error), and ties up the connection in the meantime.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 15_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
