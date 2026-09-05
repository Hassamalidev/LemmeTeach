/**
 * Vitest setup.
 *
 * Deliberately thin. The integration tests drive the real runtime and the real
 * renderer, so the fewer globals faked here the better — every shim is a place
 * where the test stops resembling a browser.
 *
 * What is shimmed is only what jsdom genuinely lacks. Note that speech
 * synthesis is *not* shimmed: its absence is a real supported configuration
 * (§17.4 rung 3), so the tests run in muted mode by default, which is exactly
 * what a learner on such a browser gets.
 */

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 16) as unknown as number) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof cancelAnimationFrame;
}

/**
 * Tells React that `act()` is available, which turns the "not configured to
 * support act" warnings into real update flushing for the render tests.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
