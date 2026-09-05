const PRIVATE_FIELD =
  /^(?:x[-_]?api[-_]?key|api[-_]?key|authorization|proxy[-_]?authorization|cookie|set[-_]?cookie|headers|requestHeaders|responseHeaders|password|secret|client[-_]?secret|token|access[-_]?token|refresh[-_]?token)$/iu;

/** Keep the endpoint useful while removing URL credentials, query values and fragments. */
export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '[redacted-url]';
    url.username = '';
    url.password = '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (
        url.hostname === 'www.youtube.com' &&
        url.pathname === '/watch' &&
        key === 'v' &&
        /^[a-z\d_-]{1,64}$/iu.test(url.searchParams.get(key) ?? '')
      )
        continue;
      url.searchParams.set(key, '[redacted]');
    }
    return url.toString();
  } catch {
    return '[invalid-url]';
  }
}

export function providerSecrets(apiKey: string, baseUrl: string): string[] {
  try {
    const url = new URL(baseUrl);
    return [
      apiKey,
      decodeURIComponent(url.username),
      decodeURIComponent(url.password),
      ...url.searchParams.values(),
    ].filter(Boolean);
  } catch {
    return [apiKey];
  }
}

export function redactDebug(value: unknown, secrets: readonly string[] = []): unknown {
  const variants = [
    ...new Set(secrets.filter(Boolean).flatMap((secret) => [secret, encodeURIComponent(secret)])),
  ].sort((a, b) => b.length - a.length);
  const cleanString = (input: string): string => {
    let text = input;
    for (const secret of variants) text = text.split(secret).join('[redacted]');
    return text
      .replace(/https?:\/\/[^\s<>"'\\]+/giu, (url) => redactUrl(url))
      .replace(/\bBearer\s+[^\s"'<>]+/giu, 'Bearer [redacted]')
      .replace(/\bsk-[a-z\d_-]{8,}/giu, '[redacted]');
  };
  const visit = (item: unknown): unknown => {
    if (typeof item === 'string') {
      // Model APIs often wrap JSON inside a string; redact keys within that JSON too.
      if (/^\s*[{[]/u.test(item)) {
        try {
          return JSON.stringify(visit(JSON.parse(item)));
        } catch {
          /* Plain model text. */
        }
      }
      return cleanString(item);
    }
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === 'object') {
      return Object.fromEntries(
        Object.entries(item).map(([key, child]) => [
          cleanString(key),
          PRIVATE_FIELD.test(key) ? '[redacted]' : visit(child),
        ]),
      );
    }
    return item;
  };
  return visit(value);
}

export function debugError(error: unknown): unknown {
  if (!(error instanceof Error)) return { message: String(error) };
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    ...('code' in error ? { code: error.code } : {}),
    ...(error.cause ? { cause: debugError(error.cause) } : {}),
  };
}
