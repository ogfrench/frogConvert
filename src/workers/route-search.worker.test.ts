/**
 * Unit tests for the route-search web worker's createWorkerHandler factory.
 * Tested synchronously without spawning a real Worker, mirroring test/setup.ts.
 *
 * Protocol note: after posting 'found', the worker pauses and waits for a
 * 'resume' message before continuing. Call send('resume') to exhaust remaining
 * paths and receive 'done'.
 */

import { describe, it, expect } from 'vitest';
import { createWorkerHandler } from './route-search.worker.ts';
import type { Node, Edge } from './route-search.worker.ts';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function createSyncWorker() {
    const messages: any[] = [];
    const handler = createWorkerHandler((msg: any) => messages.push(msg));
    const send = (data: any) => handler({ data } as MessageEvent);
    return { send, messages };
}

const fmtPng = { mime: 'image/png',  format: 'png', extension: 'png', name: 'PNG', internal: 'png', from: true, to: true, lossless: true,  category: 'image' };
const fmtMp3 = { mime: 'audio/mpeg', format: 'mp3', extension: 'mp3', name: 'MP3', internal: 'mp3', from: true, to: true, lossless: false, category: 'audio' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('route-search worker — createWorkerHandler', () => {

    it("'start' with unknown node identifiers emits done immediately", () => {
        const { send, messages } = createSyncWorker();

        send({ type: 'init', nodes: [], edges: [], categoryAdaptiveCosts: [] });
        send({
            type: 'start',
            fromIdentifier: 'nonexistent-a',
            toIdentifier: 'nonexistent-b',
            isSimpleMode: true,
            targetHandlerName: undefined,
            initialDeadEnds: [],
            initialPath: [],
        });

        expect(messages).toHaveLength(1);
        expect(messages[0].type).toBe('done');
    });

    it("'start' posts found then done (after resume) for a minimal 2-node graph", () => {
        const { send, messages } = createSyncWorker();

        const nodes: Node[] = [
            { identifier: 'hA:image/png:png',  edges: [0] },
            { identifier: 'hB:audio/mpeg:mp3', edges: [] },
        ];
        const edges: Edge[] = [
            { from: { format: fmtPng, index: 0 }, to: { format: fmtMp3, index: 1 }, handler: 'hA', cost: 1 },
        ];

        send({ type: 'init', nodes, edges, categoryAdaptiveCosts: [] });
        send({
            type: 'start',
            fromIdentifier: 'hA:image/png:png',
            toIdentifier: 'hB:audio/mpeg:mp3',
            isSimpleMode: true,
            targetHandlerName: undefined,
            initialDeadEnds: [],
            initialPath: [{ handlerName: 'hA', format: fmtPng }],
        });

        // Worker pauses after the first found — done requires a resume
        expect(messages.filter(m => m.type === 'found').length).toBe(1);
        expect(messages.filter(m => m.type === 'done').length).toBe(0);

        const path: any[] = messages[0].path;
        expect(path.at(-1)?.format.mime).toBe('audio/mpeg');

        // Resume with no dead ends — queue is exhausted, worker emits done
        send({ type: 'resume', deadEnds: [] });
        expect(messages.filter(m => m.type === 'done').length).toBe(1);
    });

    it("'stop' nulls the queue so a subsequent resume produces no messages", () => {
        const { send, messages } = createSyncWorker();

        const nodes: Node[] = [
            { identifier: 'hA:image/png:png',  edges: [0] },
            { identifier: 'hB:audio/mpeg:mp3', edges: [] },
        ];
        const edges: Edge[] = [
            { from: { format: fmtPng, index: 0 }, to: { format: fmtMp3, index: 1 }, handler: 'hA', cost: 1 },
        ];

        send({ type: 'init', nodes, edges, categoryAdaptiveCosts: [] });
        send({
            type: 'start',
            fromIdentifier: 'hA:image/png:png',
            toIdentifier: 'hB:audio/mpeg:mp3',
            isSimpleMode: true,
            targetHandlerName: undefined,
            initialDeadEnds: [],
            initialPath: [{ handlerName: 'hA', format: fmtPng }],
        });
        // Worker paused after found
        expect(messages.filter(m => m.type === 'found').length).toBe(1);

        send({ type: 'stop' });

        const countAfterStop = messages.length;
        send({ type: 'resume', deadEnds: [] }); // processSearch exits early: queue is null
        expect(messages.length).toBe(countAfterStop); // no new messages
    });

    it("'resume' with dead end blocks that path; exhausted queue emits done", () => {
        const { send, messages } = createSyncWorker();

        const nodes: Node[] = [
            { identifier: 'hA:image/png:png',  edges: [0] },
            { identifier: 'hB:audio/mpeg:mp3', edges: [] },
        ];
        const edges: Edge[] = [
            { from: { format: fmtPng, index: 0 }, to: { format: fmtMp3, index: 1 }, handler: 'hA', cost: 1 },
        ];

        send({ type: 'init', nodes, edges, categoryAdaptiveCosts: [] });
        send({
            type: 'start',
            fromIdentifier: 'hA:image/png:png',
            toIdentifier: 'hB:audio/mpeg:mp3',
            isSimpleMode: true,
            targetHandlerName: undefined,
            initialDeadEnds: [],
            initialPath: [{ handlerName: 'hA', format: fmtPng }],
        });

        const found = messages.filter(m => m.type === 'found');
        expect(found.length).toBe(1);

        // Block the only path and resume — queue exhausts, done is emitted
        send({ type: 'resume', deadEnds: [found[0].path] });

        expect(messages.filter(m => m.type === 'done').length).toBe(1);
        // No extra found messages after blocking the only path
        expect(messages.filter(m => m.type === 'found').length).toBe(1);
    });

    it("trivial self-path (from === to) is found immediately", () => {
        const { send, messages } = createSyncWorker();

        const nodes: Node[] = [
            { identifier: 'hA:image/png:png', edges: [] },
        ];

        send({ type: 'init', nodes, edges: [], categoryAdaptiveCosts: [] });
        send({
            type: 'start',
            fromIdentifier: 'hA:image/png:png',
            toIdentifier: 'hA:image/png:png',
            isSimpleMode: true,
            targetHandlerName: undefined,
            initialDeadEnds: [],
            initialPath: [{ handlerName: 'hA', format: fmtPng }],
        });

        expect(messages.filter(m => m.type === 'found').length).toBe(1);

        send({ type: 'resume', deadEnds: [] });
        expect(messages.filter(m => m.type === 'done').length).toBe(1);
    });

});
