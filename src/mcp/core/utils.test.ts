import { describe, it, expect } from 'vitest';
import { findFormatAndHandler, findFormatCandidates, findFirstPath } from './utils.ts';
import type { FormatHandler, FileFormat } from '../../core/FormatHandler/FormatHandler.ts';

describe('MCP utils', () => {
    describe('findFormatAndHandler', () => {
        const mockFormat1: FileFormat = { name: 'JPEG Image', mime: 'image/jpeg', extension: 'jpeg', from: true, to: true, format: 'jpeg' };
        const mockFormat2: FileFormat = { name: 'PNG Image', mime: 'image/png', extension: 'png', from: true, to: true, format: 'png' };

        const mockHandler1: FormatHandler = {
            name: 'MockHandler1',
            ready: true,
            supportedFormats: [mockFormat1],
            doConvert: async () => []
        };

        const mockHandler2: FormatHandler = {
            name: 'MockHandler2',
            ready: true,
            supportedFormats: [mockFormat2],
            doConvert: async () => []
        };

        const handlers = [mockHandler1, mockHandler2];

        it('should find format and handler by mime and extension', () => {
            const result = findFormatAndHandler(handlers, 'image/jpeg', 'jpeg');
            expect(result).toBeDefined();
            expect(result?.format).toEqual(mockFormat1);
            expect(result?.handler).toEqual(mockHandler1);
        });

        it('should find format and handler by mime and format name', () => {
            const result = findFormatAndHandler(handlers, 'image/png', 'png');
            expect(result).toBeDefined();
            expect(result?.format).toEqual(mockFormat2);
            expect(result?.handler).toEqual(mockHandler2);
        });

        it('should return undefined if mime does not match', () => {
            const result = findFormatAndHandler(handlers, 'image/gif', 'gif');
            expect(result).toBeUndefined();
        });

        it('should return undefined if extension does not match', () => {
            const result = findFormatAndHandler(handlers, 'image/jpeg', 'jpg');
            expect(result).toBeUndefined();
        });

        it('should handle handlers with no supported formats gracefully', () => {
            const emptyHandler: FormatHandler = { name: 'EmptyHandler', ready: true, doConvert: async () => [] };
            const result = findFormatAndHandler([emptyHandler], 'image/jpeg', 'jpeg');
            expect(result).toBeUndefined();
        });
    });

    // The registry is full of tokens that mean several things. Before these,
    // "json" resolved to pandoc's csljson, a bibliography format, so every
    // server-side json route parsed ordinary JSON as CSL; and "pdf" as a target
    // resolved to Ghostscript, which only writes PDF from PDF, so md -> pdf and
    // epub -> pdf reported no path while their landing pages advertised them.
    describe('ambiguous tokens', () => {
        const fmt = (o: Partial<FileFormat> & { format: string; extension: string }): FileFormat =>
            ({ name: o.format, mime: 'application/json', from: true, to: true, ...o });
        // Handler order is priority order, so the wrong entry is the one a
        // first-match-wins scan reaches first. That is the case worth encoding.
        const pandoc: FormatHandler = {
            name: 'pandoc', ready: true, doConvert: async () => [],
            supportedFormats: [fmt({ format: 'csljson', extension: 'json' }), fmt({ format: 'json', extension: 'json' })],
        };
        const fromjson: FormatHandler = {
            name: 'fromjson', ready: true, doConvert: async () => [],
            supportedFormats: [fmt({ format: 'json', extension: 'json', to: false })],
        };
        const handlers = [pandoc, fromjson];

        it('ranks an exact format match above one that only matched the extension', () => {
            const ranked = findFormatCandidates(handlers, 'application/json', 'json', 'from');
            expect(ranked.map(c => `${c.handler.name}/${c.format.format}`))
                .toEqual(['pandoc/json', 'fromjson/json', 'pandoc/csljson']);
        });

        it('still returns every candidate, because the best-ranked one can be a dead end', () => {
            expect(findFormatCandidates(handlers, 'application/json', 'json', 'from')).toHaveLength(3);
        });

        it('drops candidates that cannot go the requested direction', () => {
            const ranked = findFormatCandidates(handlers, 'application/json', 'json', 'to');
            expect(ranked.map(c => c.handler.name)).toEqual(['pandoc', 'pandoc']);
        });

        it('leaves findFormatAndHandler as the top-ranked candidate', () => {
            expect(findFormatAndHandler(handlers, 'application/json', 'json', 'from')?.format.format).toBe('json');
        });

        it('tries the next candidate when the top-ranked pairing has no path', () => {
            // The graph here only routes from fromjson's entry. A resolver that
            // committed to the top-ranked pandoc/json would report no path.
            const tried: string[] = [];
            const graph = {
                async *searchPath(from: any, to: any) {
                    tried.push(`${from.handler.name}/${from.format.format}`);
                    if (from.handler.name === 'fromjson') yield [from, to];
                },
            };
            return findFirstPath(graph, handlers, 'application/json', 'json', 'application/json', 'json', false)
                .then(path => {
                    expect(path).not.toBeNull();
                    expect(path![0].handler.name).toBe('fromjson');
                    expect(tried[0]).toBe('pandoc/json');
                });
        });

        it('returns null when no pairing routes', async () => {
            const graph = { async *searchPath() { /* nothing routes */ } };
            expect(await findFirstPath(graph as any, handlers, 'application/json', 'json', 'application/json', 'json', false)).toBeNull();
        });

        it('returns null for a token no handler claims, rather than searching', async () => {
            let searched = false;
            const graph = { async *searchPath() { searched = true; } };
            expect(await findFirstPath(graph as any, handlers, 'image/gif', 'gif', 'application/json', 'json', false)).toBeNull();
            expect(searched).toBe(false);
        });

        it('caps the pairings it will search, so a token with thirty readers cannot hang a request', async () => {
            // "png" matches thirty registry entries; the full cross product is
            // nine hundred searches. The cap is the guard against that.
            const many: FormatHandler = {
                name: 'many', ready: true, doConvert: async () => [],
                supportedFormats: Array.from({ length: 40 }, (_, i) => fmt({ format: 'json', extension: `x${i}` })),
            };
            let searches = 0;
            const graph = { async *searchPath() { searches++; } };
            expect(await findFirstPath(graph as any, [many], 'application/json', 'json', 'application/json', 'json', false)).toBeNull();
            expect(searches).toBeLessThanOrEqual(24);
        });
    });
});
