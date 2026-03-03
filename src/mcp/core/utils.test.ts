import { describe, it, expect } from 'vitest';
import { findFormatAndHandler } from './utils.ts';
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
});
