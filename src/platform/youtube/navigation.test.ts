import { describe, expect, it } from 'vitest';
import { isCaptionEventForCurrentVideo, videoIdFromYouTubeUrl } from './navigation';

describe('YouTube navigation identity', () => {
  it('reads watch and Shorts video ids', () => {
    expect(videoIdFromYouTubeUrl('https://www.youtube.com/watch?v=next-video&t=51s')).toBe(
      'next-video',
    );
    expect(videoIdFromYouTubeUrl('https://www.youtube.com/shorts/short-video?feature=share')).toBe(
      'short-video',
    );
  });

  it('does not treat non-video pages as video sessions', () => {
    expect(videoIdFromYouTubeUrl('https://www.youtube.com/')).toBeUndefined();
    expect(videoIdFromYouTubeUrl('https://example.com/watch?v=video')).toBeUndefined();
    expect(videoIdFromYouTubeUrl('not a url')).toBeUndefined();
  });

  it('rejects delayed caption events from the previous SPA route', () => {
    const currentUrl = 'https://www.youtube.com/watch?v=new-video';
    expect(isCaptionEventForCurrentVideo(currentUrl, 'old-video')).toBe(false);
    expect(isCaptionEventForCurrentVideo(currentUrl, 'new-video')).toBe(true);
  });
});
