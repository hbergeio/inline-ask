import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findNearest, parseAlternatives } from '../src/parse.ts';

test('parses structured JSON', () => {
	assert.deepEqual(parseAlternatives('{"alternatives":["4","2 + 2 is 4","it\'s 4"]}', 3), ['4', '2 + 2 is 4', "it's 4"]);
});

test('parses fenced JSON and trims to max, dropping duplicates and blanks', () => {
	const text = '```json\n{"alternatives": ["a", "a", " ", "b", "c", "d"]}\n```';
	assert.deepEqual(parseAlternatives(text, 3), ['a', 'b', 'c']);
});

test('parses JSON embedded in prose and bare arrays', () => {
	assert.deepEqual(parseAlternatives('Sure! {"alternatives":["x","y"]} hope that helps', 5), ['x', 'y']);
	assert.deepEqual(parseAlternatives('["x","y"]', 5), ['x', 'y']);
});

test('falls back to lines', () => {
	assert.deepEqual(parseAlternatives('1. four\n2. 2 + 2 is 4\n- it is 4', 5), ['four', '2 + 2 is 4', 'it is 4']);
});

test('findNearest picks the occurrence closest to the hint', () => {
	const text = '???q??? middle ???q???';
	assert.equal(findNearest(text, '???q???', 0), 0);
	assert.equal(findNearest(text, '???q???', 20), 15);
	assert.equal(findNearest(text, '???x???', 0), -1);
});
