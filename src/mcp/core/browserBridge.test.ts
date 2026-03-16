// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for the Puppeteer browser bridge.
 *
 * browserBridge.ts has module-level singleton state (initPromise, bridgePage).
 * Each test uses vi.resetModules() + dynamic import to get a fresh module
 * instance with clean state.
 *
 * vi.mock() must be declared at the top level so Vitest can hoist them before
 * any imports. Per-test behavior is controlled by module-level variables that
 * the mock factories close over — the variable is read at call time, not at
 * factory-registration time.
 */

// ---------------------------------------------------------------------------
// Control variables — updated per-test before vi.resetModules()
// ---------------------------------------------------------------------------

let _existsSyncReturns = true;
let _mockLaunchResolves: any = null; // set in beforeEach

const _mockPage = {
    on: vi.fn(),
    goto: vi.fn().mockResolvedValue(undefined),
    waitForFunction: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
};

const _mockBrowser = {
    newPage: vi.fn().mockResolvedValue(_mockPage),
    close: vi.fn().mockResolvedValue(undefined),
};

// ---------------------------------------------------------------------------
// Top-level vi.mock() declarations (hoisted by Vitest)
// ---------------------------------------------------------------------------

vi.mock('puppeteer', () => ({
    default: {
        launch: vi.fn().mockImplementation(() => Promise.resolve(_mockLaunchResolves)),
    },
}));

vi.mock('fs', async (importOriginal) => {
    const real = await importOriginal<typeof import('fs')>();
    return {
        ...real,
        existsSync: vi.fn().mockImplementation(() => _existsSyncReturns),
        statSync: vi.fn().mockReturnValue({ isFile: () => false }),
        readFileSync: real.readFileSync,
    };
});

vi.mock('http', async (importOriginal) => {
    const real = await importOriginal<typeof import('http')>();
    const srv = {
        listen: vi.fn().mockImplementation((_p: number, _h: string, cb: () => void) => {
            cb();
            return srv;
        }),
        address: vi.fn().mockReturnValue({ port: 54321 }),
        on: vi.fn().mockReturnThis(),
        close: vi.fn(),
    };
    return { ...real, createServer: vi.fn().mockReturnValue(srv) };
});

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
    // Clear call history (but NOT implementations — those stay on the vi.fn()s).
    vi.clearAllMocks();

    // Reset control variables to their safe defaults.
    _existsSyncReturns = true;
    _mockLaunchResolves = _mockBrowser;

    // Re-apply default resolved values that clearAllMocks wiped from the queue.
    _mockPage.goto.mockResolvedValue(undefined);
    _mockPage.waitForFunction.mockResolvedValue(undefined);
    _mockPage.close.mockResolvedValue(undefined);
    _mockBrowser.newPage.mockResolvedValue(_mockPage);
    _mockBrowser.close.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('canConvertViaBrowser — before bridge is initialized', () => {
    it('returns false when bridge is not initialized', async () => {
        vi.resetModules();
        const { canConvertViaBrowser } = await import('./browserBridge.ts');
        const result = await canConvertViaBrowser('image/jpeg', 'jpeg', 'image/png', 'png');
        expect(result).toBe(false);
    });

    it('returns false for any mime/ext pair when bridge is not running', async () => {
        vi.resetModules();
        const { canConvertViaBrowser } = await import('./browserBridge.ts');
        const result = await canConvertViaBrowser('application/x-exotic', 'exotic', 'model/gltf', 'gltf');
        expect(result).toBe(false);
    });
});

describe('convertViaBrowser — dist/ directory missing', () => {
    it('rejects with a message instructing user to run bun run build', async () => {
        _existsSyncReturns = false;

        vi.resetModules();
        const { convertViaBrowser } = await import('./browserBridge.ts');
        await expect(
            convertViaBrowser('test.jpg', 'aGVsbG8=', 'image/jpeg', 'jpeg', 'image/png', 'png')
        ).rejects.toThrow('bun run build');
    });
});

describe('convertViaBrowser — successful path through mocked Puppeteer', () => {
    it('calls page.evaluate with __frogConvertHeadless and returns results', async () => {
        const mockResults = [{ fileName: 'output.png', base64Bytes: 'cG5n' }];
        _mockPage.evaluate.mockResolvedValue(mockResults);

        vi.resetModules();
        const { convertViaBrowser } = await import('./browserBridge.ts');
        const result = await convertViaBrowser(
            'test.jpg', 'aGVsbG8=', 'image/jpeg', 'jpeg', 'image/png', 'png'
        );

        expect(result).toEqual(mockResults);
        expect(_mockPage.evaluate).toHaveBeenCalledWith(
            expect.any(Function),
            '__frogConvertHeadless',
            'test.jpg', 'aGVsbG8=', 'image/jpeg', 'jpeg', 'image/png', 'png'
        );
    });
});

describe('canConvertViaBrowser — after bridge page is initialized', () => {
    it('delegates to page.evaluate with __frogConvertCanConvert', async () => {
        _mockPage.evaluate
            .mockResolvedValueOnce([])    // first call: convertViaBrowser result
            .mockResolvedValueOnce(true); // second call: canConvertViaBrowser result

        vi.resetModules();
        const { convertViaBrowser, canConvertViaBrowser } = await import('./browserBridge.ts');

        // Initialize the bridge by running a conversion
        await convertViaBrowser('f.jpg', 'aA==', 'image/jpeg', 'jpeg', 'image/png', 'png');

        // Now canConvertViaBrowser should use the already-running page
        const result = await canConvertViaBrowser('image/jpeg', 'jpeg', 'image/png', 'png');

        expect(result).toBe(true);
        expect(_mockPage.evaluate).toHaveBeenLastCalledWith(
            expect.any(Function),
            '__frogConvertCanConvert',
            'image/jpeg', 'jpeg', 'image/png', 'png'
        );
    });
});

describe('BridgeResult interface', () => {
    it('has fileName and base64Bytes string fields', () => {
        const result: import('./browserBridge.ts').BridgeResult = {
            fileName: 'output.png',
            base64Bytes: 'aGVsbG8=',
        };
        expect(result.fileName).toBe('output.png');
        expect(result.base64Bytes).toBe('aGVsbG8=');
    });
});
