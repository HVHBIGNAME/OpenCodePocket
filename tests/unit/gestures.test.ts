import { expect, it } from 'vitest';
import { swipeAccepted } from '../../src/lib/gestures';
import { keyboardLayout } from '../../src/lib/keyboard';

it('requires horizontal intent and rejects taps or mostly vertical scrolling', () => {
  expect(swipeAccepted(14, 0, 20, 390)).toBe(false);
  expect(swipeAccepted(100, 110, 200, 390)).toBe(false);
  expect(swipeAccepted(110, 14, 350, 390)).toBe(true);
  expect(swipeAccepted(-50, 8, 80, 390)).toBe(true);
  expect(swipeAccepted(50, 8, 900, 390)).toBe(false);
  expect(swipeAccepted(120, 5, 500, 800)).toBe(true);
});

it('maps native keyboard geometry once and uses the system animation duration', () => {
  expect(
    keyboardLayout(
      { viewportHeight: 550, viewportWidth: 390, keyboardHeight: 294, duration: 0.25, curve: 0 },
      390,
    ),
  ).toEqual({ height: 550, inset: 294, duration: 250, easing: 'ease-in-out' });
  expect(
    keyboardLayout(
      { viewportHeight: 844, viewportWidth: 390, keyboardHeight: 0, duration: 0, curve: 3 },
      390,
    ),
  ).toMatchObject({ height: 844, inset: 0, duration: 0 });
  expect(
    keyboardLayout(
      { viewportHeight: 300, viewportWidth: 600, keyboardHeight: 200, duration: 0.3, curve: 7 },
      300,
    ),
  ).toMatchObject({ height: 150, inset: 100, duration: 300 });
  expect(
    keyboardLayout({ viewportHeight: 0, viewportWidth: 0, keyboardHeight: 0, duration: 0, curve: 0 }, 390),
  ).toBeUndefined();
});
