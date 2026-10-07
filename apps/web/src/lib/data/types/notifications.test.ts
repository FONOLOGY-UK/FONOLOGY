import { describe, expect, it } from 'vitest';
import { renderSmsPreview, smsParts, SMS_SAMPLE_VALUES } from './notifications';

describe('renderSmsPreview', () => {
  it('fills known placeholders and leaves unknown ones visible', () => {
    expect(renderSmsPreview('Hi {firstName}, job {jobNumber} {nope}', SMS_SAMPLE_VALUES)).toBe(
      'Hi Sam, job F01-JOB-061026001 {nope}',
    );
  });

  it('collapses the gap an empty fill-in leaves', () => {
    expect(renderSmsPreview('Tracking: {tracking} done', { tracking: '' })).toBe('Tracking: done');
  });
});

describe('smsParts', () => {
  it('counts plain text at 160 a part, then 153', () => {
    expect(smsParts('a'.repeat(160))).toEqual({ parts: 1, unicode: false });
    expect(smsParts('a'.repeat(161))).toEqual({ parts: 2, unicode: false });
    expect(smsParts('a'.repeat(306))).toEqual({ parts: 2, unicode: false });
  });

  it('treats £ as plain text but curly quotes and emoji as Unicode (70 a part)', () => {
    expect(smsParts('Price £89.99').unicode).toBe(false);
    expect(smsParts('We’ve got it').unicode).toBe(true);
    expect(smsParts('x'.repeat(69) + '😀').parts).toBe(2);
  });
});
