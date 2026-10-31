import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
for (const name of [
  'window',
  'document',
  'HTMLElement',
  'HTMLTextAreaElement',
  'Element',
  'Event',
  'MouseEvent',
  'KeyboardEvent',
  'CompositionEvent',
])
  globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { act } = React;
const { Mentions } = await import('../dist/esm/index.js');
const h = React.createElement;
const pause = () => new Promise((resolve) => setTimeout(resolve, 10));

async function mount(props = {}) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const changes = [];
  function App() {
    const [value, setValue] = React.useState({ text: '', mentions: [] });
    return h(Mentions, {
      value,
      onChange(next, details) {
        changes.push({ next, details });
        setValue(next);
      },
      loadSuggestions: () => [
        { id: 'ada', label: 'Ada' },
        { id: 'bob', label: 'Bob' },
      ],
      debounceMs: 0,
      ...props,
    });
  }
  await act(async () => root.render(h(App)));
  const textarea = container.querySelector('textarea');
  await act(async () => textarea.focus());
  return {
    container,
    textarea,
    changes,
    async type(text) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(
          textarea,
          text,
        );
        textarea.setSelectionRange(text.length, text.length);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      });
    },
    async wait() {
      await act(pause);
    },
    async key(key) {
      await act(async () =>
        textarea.dispatchEvent(
          new KeyboardEvent('keydown', {
            key,
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
    },
    async close() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

test('typing opens async suggestions and arrow/Enter selection emits a structured value', async () => {
  const app = await mount();
  try {
    await app.type('Hi @b');
    await app.wait();
    assert.equal(app.container.querySelectorAll('[role="option"]').length, 2);
    assert.equal(app.textarea.getAttribute('aria-expanded'), 'true');
    await app.key('ArrowDown');
    assert.equal(
      app.container.querySelectorAll('[role="option"]')[1].getAttribute('aria-selected'),
      'true',
    );
    await app.key('Enter');
    assert.equal(app.textarea.value, 'Hi @Bob ');
    const change = app.changes.at(-1);
    assert.equal(change.details.reason, 'select');
    assert.deepEqual(change.next.mentions, [
      {
        id: 'bob',
        label: 'Bob',
        trigger: '@',
        start: 3,
        end: 7,
      },
    ]);
    assert.equal(app.textarea.selectionStart, 8);
    assert.equal(document.activeElement, app.textarea);
  } finally {
    await app.close();
  }
});

test('out-of-order async responses cannot overwrite the newest query and abort old signals', async () => {
  const pending = new Map();
  const app = await mount({
    loadSuggestions: (query, { signal }) =>
      new Promise((resolve) => pending.set(query, { resolve, signal })),
  });
  try {
    await app.type('@a');
    await app.wait();
    await app.type('@b');
    await app.wait();
    assert.equal(pending.get('a').signal.aborted, true);
    await act(async () => pending.get('b').resolve([{ id: 'b', label: 'Bea' }]));
    await act(async () => pending.get('a').resolve([{ id: 'a', label: 'Ada' }]));
    assert.equal(app.container.querySelector('[role="option"]').textContent, 'Bea');
  } finally {
    await app.close();
  }
});

test('Escape dismisses suggestions and editing opens a fresh query', async () => {
  const app = await mount();
  try {
    await app.type('@a');
    await app.wait();
    await app.key('Escape');
    assert.equal(app.container.querySelector('[role="listbox"]'), null);
    await app.type('@ad');
    await app.wait();
    assert.ok(app.container.querySelector('[role="listbox"]'));
    await app.key('Tab');
    assert.equal(app.textarea.value, '@Ada ');
  } finally {
    await app.close();
  }
});

test('mouse selection preserves focus and untrusted labels are text, never markup', async () => {
  const app = await mount({
    loadSuggestions: () => [{ id: 'html', label: '<img src=x onerror=alert(1)>' }],
  });
  try {
    await app.type('@x');
    await app.wait();
    assert.equal(app.container.querySelector('img'), null);
    const option = app.container.querySelector('[role="option"]');
    await act(async () => {
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      option.click();
    });
    assert.equal(app.changes.at(-1).next.mentions[0].id, 'html');
    assert.equal(document.activeElement, app.textarea);
    assert.equal(app.container.querySelector('img'), null);
  } finally {
    await app.close();
  }
});

test('suggestion failures report errors and display an accessible status', async () => {
  const errors = [];
  const app = await mount({
    loadSuggestions: async () => {
      throw new Error('offline');
    },
    onError: (error) => errors.push(error),
  });
  try {
    await app.type('@a');
    await app.wait();
    assert.equal(errors[0].message, 'offline');
    assert.equal(
      app.container.querySelector('[role="status"]').textContent,
      'Suggestions unavailable',
    );
  } finally {
    await app.close();
  }
});

test('unmount aborts in-flight suggestion work', async () => {
  let signal;
  const app = await mount({
    loadSuggestions: (_query, context) => {
      signal = context.signal;
      return new Promise(() => {});
    },
  });
  await app.type('@a');
  await app.wait();
  await app.close();
  assert.equal(signal.aborted, true);
});

test('composition hides the menu until composition ends', async () => {
  const app = await mount();
  try {
    await act(async () =>
      app.textarea.dispatchEvent(
        new CompositionEvent('compositionstart', {
          bubbles: true,
        }),
      ),
    );
    await app.type('@a');
    await app.wait();
    assert.equal(app.container.querySelector('[role="listbox"]'), null);
    await act(async () =>
      app.textarea.dispatchEvent(
        new CompositionEvent('compositionend', {
          bubbles: true,
        }),
      ),
    );
    await app.wait();
    assert.ok(app.container.querySelector('[role="listbox"]'));
  } finally {
    await app.close();
  }
});

test('readonly textareas do not load suggestions', async () => {
  let calls = 0;
  const app = await mount({
    value: { text: '@a', mentions: [] },
    textareaProps: { readOnly: true },
    loadSuggestions: () => {
      calls++;
      return [];
    },
  });
  try {
    await app.wait();
    assert.equal(calls, 0);
    assert.equal(app.container.querySelector('[role="listbox"]'), null);
  } finally {
    await app.close();
  }
});

test('invalid loader results use the explicit error path', async () => {
  const errors = [];
  const app = await mount({
    loadSuggestions: () => [{ id: '', label: 'No ID' }],
    onError: (error) => errors.push(error),
  });
  try {
    await app.type('@a');
    await app.wait();
    assert.ok(errors[0] instanceof TypeError);
    assert.equal(app.container.querySelector('[role="option"]'), null);
  } finally {
    await app.close();
  }
});
