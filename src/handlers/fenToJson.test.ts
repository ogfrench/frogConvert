import { expect, test } from 'vitest';
import CommonFormats from '../core/CommonFormats/CommonFormats.ts';
import { FormatDefinition } from '../core/FormatHandler/FormatHandler.ts';
import fenToJsonHandler from './fenToJson.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const fenFormat = new FormatDefinition(
  'Forsyth–Edwards Notation',
  'fen',
  'fen',
  'application/vnd.chess-fen',
  'text',
).supported('fen', true, true, true);
const jsonFormat = CommonFormats.JSON.supported('json', true, true, true);

const startPosition = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

test('fenToJson converts FEN starting position to JSON', async () => {
  const handler = new fenToJsonHandler();
  await handler.init();

  const [out] = await handler.doConvert(
    [{ name: 'start.fen', bytes: encoder.encode(startPosition) }],
    fenFormat,
    jsonFormat,
  );
  expect(out.name).toBe('start.json');
  const game = JSON.parse(decoder.decode(out.bytes));
  expect(game.turn).toBe('w');
  expect(game.halfMoves).toBe(0);
  expect(game.moveNumber).toBe(1);
  expect(game.board).toHaveLength(8);
  expect(game.board[0]).toHaveLength(8);
});

test('fenToJson round-trip preserves FEN', async () => {
  const handler = new fenToJsonHandler();
  await handler.init();

  const [asJson] = await handler.doConvert(
    [{ name: 'start.fen', bytes: encoder.encode(startPosition) }],
    fenFormat,
    jsonFormat,
  );
  const [backToFen] = await handler.doConvert(
    [{ name: asJson.name, bytes: asJson.bytes }],
    jsonFormat,
    fenFormat,
  );
  expect(decoder.decode(backToFen.bytes)).toBe(startPosition);
});
