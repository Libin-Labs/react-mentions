import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as api from '../dist/esm/index.js';

const value = {
  text: 'Hi @Ada and @Bob!',
  mentions: [
    { id: 'ada', label: 'Ada', trigger: '@', start: 3, end: 7 },
    { id: 'bob', label: 'Bob', trigger: '@', start: 12, end: 16 },
  ],
};

test('CJS and ESM have the same API', () => {
  const cjs = createRequire(import.meta.url)('../dist/cjs/index.js');
  assert.deepEqual(Object.keys(cjs).sort(), Object.keys(api).sort());
});

test('validates exact sorted nonoverlapping ranges and triggers', () => {
  api.validateValue(value);
  assert.throws(
    () => api.validateValue({ ...value, mentions: [...value.mentions].reverse() }),
    RangeError,
  );
  assert.throws(
    () =>
      api.validateValue({
        ...value,
        mentions: [{ ...value.mentions[0], end: 6 }],
      }),
    RangeError,
  );
  assert.throws(() => api.validateTriggers(['@', '@']), RangeError);
  assert.throws(() => api.validateTriggers([' ']), RangeError);
  assert.throws(() => api.applyTextEdit(value, -1, 0, 'x'), RangeError);
});

test('edits shift later ranges and remove metadata for intersected mentions', () => {
  const shifted = api.applyTextEdit(value, 0, 0, 'Hello ');
  assert.equal(shifted.mentions[0].start, 9);
  assert.equal(shifted.mentions[1].start, 18);
  const changed = api.applyTextEdit(value, 4, 5, 'Z');
  assert.equal(changed.mentions.length, 1);
  assert.equal(changed.mentions[0].id, 'bob');
  assert.equal(changed.text, 'Hi @Zda and @Bob!');
  assert.equal(value.mentions.length, 2);
});

test('insertions at mention boundaries preserve metadata while interior insertions remove it', () => {
  assert.equal(api.applyTextEdit(value, 5, 5, ''), value);
  assert.equal(api.applyTextEdit(value, 3, 3, 'X').mentions[0].start, 4);
  assert.equal(api.applyTextEdit(value, 7, 7, 'X').mentions[0].end, 7);
  assert.equal(api.applyTextEdit(value, 5, 5, 'X').mentions.length, 1);
});

test('updateText reconciles insertion/deletion and returns unchanged objects without mutation', () => {
  assert.equal(api.updateText(value, value.text), value);
  const changed = api.updateText(value, 'Hi @Ada and !');
  assert.deepEqual(changed.mentions, [value.mentions[0]]);
  const prefix = api.updateText(value, `X${value.text}`);
  assert.equal(prefix.mentions[0].start, 4);
});

test('query detection respects whitespace boundaries, selected ranges, length and multi-character triggers', () => {
  const empty = (text) => ({ text, mentions: [] });
  assert.equal(api.findMentionQuery(empty('mail@ada'), 8), null);
  assert.equal(api.findMentionQuery(value, 5), null);
  assert.equal(api.findMentionQuery(empty('@a b'), 4), null);
  assert.equal(api.findMentionQuery(empty('@abcd'), 5, ['@'], 3), null);
  assert.deepEqual(api.findMentionQuery(empty('Hi ::ad'), 7, ['@', '::']), {
    start: 3,
    end: 7,
    trigger: '::',
    query: 'ad',
  });
  assert.throws(() => api.findMentionQuery(empty(''), 1), RangeError);
});

test('insertMention returns a structured literal token and UTF-16 caret', () => {
  const source = { text: 'Hi @ad!', mentions: [] };
  const query = api.findMentionQuery(source, 6);
  const result = api.insertMention(source, query, { id: 'ada', label: 'Ada Lovelace' });
  assert.equal(result.value.text, 'Hi @Ada Lovelace !');
  assert.deepEqual(result.value.mentions, [
    {
      id: 'ada',
      label: 'Ada Lovelace',
      trigger: '@',
      start: 3,
      end: 16,
    },
  ]);
  assert.equal(result.caret, 17);
  assert.throws(
    () =>
      api.insertMention(
        source,
        { ...query, query: 'other' },
        {
          id: 'ada',
          label: 'Ada',
        },
      ),
    RangeError,
  );
});

test('HTML-looking labels remain plain text and invalid suggestions are rejected', () => {
  const source = { text: '@x', mentions: [] };
  const result = api.insertMention(source, api.findMentionQuery(source, 2), {
    id: 'html',
    label: '<img src=x>',
  });
  assert.equal(result.value.text, '@<img src=x> ');
  assert.throws(
    () =>
      api.insertMention(source, api.findMentionQuery(source, 2), {
        id: 'bad',
        label: 'two\nlines',
      }),
    RangeError,
  );
});
