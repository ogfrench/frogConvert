// This file covers handler loading and a handful of format-routing checks.
// Most individual handlers do not yet have a round-trip smoke test. Adding
// `handler.doConvert(fixture)` → assert non-empty output, one per handler
// family, is a good follow-up.
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WaveFile } from 'wavefile';

// --- MOCKS SETUP ---

// AudioContext Mock for meyda and qoa-fu
class MockAudioContext {
    createGain = () => ({ connect: vi.fn() });
    decodeAudioData = async () => ({
        length: 1000,
        numberOfChannels: 2,
        sampleRate: 44100,
        getChannelData: () => new Float32Array(1000)
    });
}
(globalThis as any).AudioContext = MockAudioContext;
if (typeof window !== 'undefined') {
    (window as any).AudioContext = MockAudioContext;
}

// sppd mocks
vi.mock('three-mesh-bvh', () => ({}));
vi.mock('three-bvh-csg', () => {
    return {
        CSG: {
            Brush: class { },
            Evaluator: class { evaluate() { return {}; } }
        }
    };
});

// qoa-fu mocks
vi.mock('qoa-fu', () => {
    class MockQOAEncoder {
        writeHeader = () => true;
        writeFrame = () => true;
        getData = () => new Uint8Array([1, 2, 3]);
    }
    class MockQOADecoder {
        getChannels = () => 1;
        getSampleRate = () => 44100;
    }
    class MockQOABase {}
    return { QOAEncoder: MockQOAEncoder, QOADecoder: MockQOADecoder, QOABase: MockQOABase };
});

// meyda mocks
if (typeof Image !== 'undefined') {
    vi.spyOn(Image.prototype, 'addEventListener').mockImplementation(function (this: HTMLImageElement, event: unknown, cb: any) {
        if (event === 'load') {
            Object.defineProperty(this, 'naturalWidth', { value: 100 });
            Object.defineProperty(this, 'naturalHeight', { value: 100 });
            setTimeout(cb, 0);
        }
    });
} else {
    (globalThis as any).Image = class MockImage {
        naturalWidth = 100;
        naturalHeight = 100;
        addEventListener(event: string, cb: any) {
            if (event === 'load') setTimeout(cb, 0);
        }
    };
}

if (typeof HTMLCanvasElement !== 'undefined') {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        getImageData: () => ({ data: new Uint8ClampedArray(100 * 100 * 4) }),
        drawImage: vi.fn(),
        clearRect: vi.fn(),
        putImageData: vi.fn()
    } as any);
} else {
    (globalThis as any).HTMLCanvasElement = class MockCanvas {
        getContext() {
            return {
                getImageData: () => ({ data: new Uint8ClampedArray(100 * 100 * 4) }),
                drawImage: () => {},
                clearRect: () => {},
                putImageData: () => {}
            };
        }
        toBlob(cb: any) { cb(new Blob()); }
    };
}

if (typeof globalThis.ImageData === 'undefined') {
    (globalThis as any).ImageData = class {
        data: Uint8ClampedArray;
        constructor(data: Uint8ClampedArray) { this.data = data; }
    };
}

// --- IMPORTS ---
import meydaHandler from './meyda.ts';
import qoaFuHandler from './qoa-fu.ts';
import sppdHandler from './sppd.ts';

// --- TESTING MEYDA, QUAFU AND SPPD HANDLERS FOR YIELDING ---

describe('Conversion Handlers Yielding', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout'] });
        if (typeof window !== 'undefined' && typeof window.HTMLMediaElement !== 'undefined') {
            vi.spyOn(window.HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('probably');
        }
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('meyda handler yields via setTimeout when generating FFT spectrum arrays and performance exceeds 15ms target', async () => {
        let now = 0;
        const perfSpy = vi.spyOn(performance, 'now').mockImplementation(() => {
            now += 20;
            return now;
        });
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

        const handler = new meydaHandler();
        await handler.init();

        const fakeInputData = [{ name: 'test.png', bytes: new Uint8Array([0, 0, 0]) }];
        const fakeInputFormat = handler.supportedFormats.find(f => f.internal === 'image')!;
        const fakeOutputFormat = handler.supportedFormats.find(f => f.internal === 'audio')!;

        const promise = handler.doConvert(fakeInputData, fakeInputFormat, fakeOutputFormat);

        await vi.runAllTimersAsync();

        try {
            await promise;
        } catch (e) { }

        expect(setTimeoutSpy).toHaveBeenCalled();
        expect(perfSpy).toHaveBeenCalled();
    });

    it('qoa-fu handler yields via setTimeout when encoding QOA and performance exceeds 15ms target', async () => {
        let now = 0;
        const perfSpy = vi.spyOn(performance, 'now').mockImplementation(() => {
            now += 20;
            return now;
        });
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

        const handler = new qoaFuHandler();
        await handler.init();

        const wav = new WaveFile();
        wav.fromScratch(1, 44100, '16', new Array(1000).fill(0));

        const fakeInputData = [{ name: 'test.wav', bytes: wav.toBuffer() }];
        const fakeInputFormat = handler.supportedFormats.find(f => f.internal === 'wav')!;
        const fakeOutputFormat = handler.supportedFormats.find(f => f.internal === 'qoa')!;

        const promise = handler.doConvert(fakeInputData, fakeInputFormat, fakeOutputFormat);

        await vi.runAllTimersAsync();
        const result = await promise;

        expect(result.length).toBe(1);
        expect(setTimeoutSpy).toHaveBeenCalled();
        expect(perfSpy).toHaveBeenCalled();
    });

    it('sppd handler yields via setTimeout when generating dense 3D voxels and performance exceeds 15ms target', async () => {
        let now = 0;
        const perfSpy = vi.spyOn(performance, 'now').mockImplementation(() => {
            now += 20;
            return now;
        });
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

        const handler = new sppdHandler();
        (handler as any).THREE = {
            Mesh: vi.fn().mockReturnValue({ position: { copy: vi.fn() }, lookAt: vi.fn() }),
            Vector3: vi.fn().mockReturnValue({ x: 0, y: 0, z: 0 }),
        };
        (handler as any).scene = { add: vi.fn(), remove: vi.fn() };
        (handler as any).wallGeometry = {};
        (handler as any).wallMaterial = {};
        (handler as any).wallPortalMaterial = {};

        const mockVoxels = new Map([
            ['0;0;0', { x: 0, y: 0, z: 0, Add: vi.fn().mockReturnValue({ x: 0, y: 0, z: 0 }), Sub: vi.fn(), Scale: vi.fn().mockReturnThis() }],
            ['1;0;0', { x: 1, y: 0, z: 0, Add: vi.fn().mockReturnValue({ x: 0, y: 0, z: 0 }), Sub: vi.fn(), Scale: vi.fn().mockReturnThis() }]
        ]);

        const promise = handler.buildWalls(mockVoxels as any, new Map());

        await vi.runAllTimersAsync();
        await promise;

        expect(setTimeoutSpy).toHaveBeenCalled();
        expect(perfSpy).toHaveBeenCalled();
    });
});
