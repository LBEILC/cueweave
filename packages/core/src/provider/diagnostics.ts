import type { ProviderSettings } from './types';

/** Keep diagnostics readable without exposing configured credentials. */
export function redactProviderDiagnostic(text: string, settings: ProviderSettings): string {
  let safe = text;
  for (const secret of [settings.apiKey, encodeURIComponent(settings.apiKey)]) {
    if (secret) safe = safe.split(secret).join('[REDACTED]');
  }
  return safe
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/([?&][^=\s&]+)=([^\s&#]*)/g, '$1=[REDACTED]')
    .replace(/Bearer\s+[^\s"',;]+/gi, 'Bearer [REDACTED]')
    .slice(0, 8_000);
}

export function diagnosticError(error: unknown): string {
  const lines: string[] = [];
  const seen = new Set<unknown>();
  while (error != null && !seen.has(error) && lines.length < 4) {
    seen.add(error);
    if (!(error instanceof Error)) {
      lines.push(String(error));
      break;
    }
    lines.push(`${error.name}: ${error.message}`);
    error = error.cause;
  }
  return lines.join('\n原因: ');
}

/** Bound error-body reads; do not wait indefinitely for an error stream. */
export async function diagnosticResponse(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '';
  const timer = setTimeout(() => void reader.cancel().catch(() => {}), 1_500);
  try {
    while (text.length < 4_000) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    return text.length >= 4_000 ? `${text.slice(0, 4_000)}\n[响应已截断]` : text;
  } catch {
    return text || '无法读取响应正文。';
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}
