import { describe, expect, it } from 'vitest';
import {
  DELETE_VIDEO_GLOSSARY_TERM_MESSAGE,
  GET_VIDEO_GLOSSARY_MESSAGE,
  isDeleteVideoGlossaryTermMessage,
  isGetVideoGlossaryMessage,
  isUpsertVideoGlossaryTermMessage,
  UPSERT_VIDEO_GLOSSARY_TERM_MESSAGE,
} from './messages';

describe('video glossary messages', () => {
  it('accepts bounded glossary operations', () => {
    expect(
      isGetVideoGlossaryMessage({ type: GET_VIDEO_GLOSSARY_MESSAGE, videoId: 'video-a' }),
    ).toBe(true);
    expect(
      isUpsertVideoGlossaryTermMessage({
        type: UPSERT_VIDEO_GLOSSARY_TERM_MESSAGE,
        videoId: 'video-a',
        term: { source: 'Soul', translation: 'Sol' },
      }),
    ).toBe(true);
    expect(
      isDeleteVideoGlossaryTermMessage({
        type: DELETE_VIDEO_GLOSSARY_TERM_MESSAGE,
        videoId: 'video-a',
        source: 'Soul',
      }),
    ).toBe(true);
  });

  it('rejects empty and oversized glossary content', () => {
    expect(
      isUpsertVideoGlossaryTermMessage({
        type: UPSERT_VIDEO_GLOSSARY_TERM_MESSAGE,
        videoId: 'video-a',
        term: { source: ' ', translation: 'Sol' },
      }),
    ).toBe(false);
    expect(
      isDeleteVideoGlossaryTermMessage({
        type: DELETE_VIDEO_GLOSSARY_TERM_MESSAGE,
        videoId: 'video-a',
        source: 'x'.repeat(97),
      }),
    ).toBe(false);
  });
});
