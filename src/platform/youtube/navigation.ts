export function videoIdFromYouTubeUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.hostname !== 'www.youtube.com' && url.hostname !== 'youtube.com') return undefined;

    if (url.pathname === '/watch') return url.searchParams.get('v') || undefined;
    return url.pathname.match(/^\/shorts\/([^/]+)/u)?.[1];
  } catch {
    return undefined;
  }
}

export function isCaptionEventForCurrentVideo(currentUrl: string, eventVideoId: string): boolean {
  const currentVideoId = videoIdFromYouTubeUrl(currentUrl);
  return Boolean(currentVideoId && currentVideoId === eventVideoId);
}
