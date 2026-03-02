/**
 * Preload script for Vitest (using jsdom).
 */

if (!navigator.deviceMemory) {
    Object.defineProperty(navigator, 'deviceMemory', { value: 4, configurable: true });
}

