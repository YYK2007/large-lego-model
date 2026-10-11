/** Poll short preparation requests; the final download keeps the original signed URL. */
export async function prepareGuidePdf(url: string, signal: AbortSignal, request: typeof fetch = fetch): Promise<string> {
  const preparationUrl = `${url}${url.includes('?') ? '&' : '?'}prepare=1`;
  while (true) {
    signal.throwIfAborted();
    const response = await request(preparationUrl, { method: 'HEAD', signal, cache: 'no-store' });
    if (response.status !== 202) {
      if (!response.ok || !response.headers.get('content-type')?.includes('application/pdf')) throw new Error('The PDF couldn’t be prepared. Try again, or send /manual in Messages.');
      return url;
    }
    const seconds = Number(response.headers.get('retry-after')) || 2;
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, Math.min(10, Math.max(1, seconds)) * 1000);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) { signal.removeEventListener('abort', abort); abort(); }
    });
  }
}
