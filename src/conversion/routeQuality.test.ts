import { describe, it, expect } from 'vitest';
import { classifyRoute, routeQualityNotice } from './routeQuality.ts';

describe('classifyRoute', () => {
  it.each([
    [['pptx', 'html', 'svg', 'png', 'pdf'], 'image-only'],
    [['docx', 'html', 'svg', 'png', 'pdf'], 'image-only'],
    [['md', 'html', 'svg', 'png', 'pdf'], 'image-only'],
    [['pdf', 'png', 'html', 'pptx'], 'image-only'],
    [['pdf', 'text', 'html', 'docx'], 'text-only'],
    [['pptx', 'pdf'], 'faithful'],
    [['md', 'html', 'docx'], 'faithful'],
    [['png', 'pdf'], 'faithful'],
    [['png', 'jpeg', 'pdf'], 'faithful'],
    [['pdf', 'png'], 'faithful'],
    [['mp4', 'mp3'], 'faithful'],
  ])('%j is %s', (formats, expected) => {
    expect(classifyRoute(formats as string[])).toBe(expected);
  });
});

describe('routeQualityNotice', () => {
  it('says an image-only PDF has no selectable text', () => {
    const n = routeQualityNotice(['pptx', 'html', 'svg', 'png', 'pdf'])!;
    expect(n.title).toBe('This PDF is made of pictures');
    expect(n.body).toMatch(/can't be selected/);
  });

  it('is silent for a faithful route', () => {
    expect(routeQualityNotice(['pptx', 'pdf'])).toBeNull();
  });
});
