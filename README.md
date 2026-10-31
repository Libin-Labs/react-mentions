# @lp-labs/react-mentions

Package version: `1.0.0`.

A controlled plain-text textarea with structured mention ranges, async
suggestions, stale-response protection, keyboard/mouse selection and edit
reconciliation. React 18.2 or 19 is the only runtime peer; there are no runtime
dependencies. Includes ESM, CommonJS, declarations and optional CSS.

## Use

```sh
npm install @lp-labs/react-mentions react
```

```tsx
import { useState } from "react";
import { Mentions, type MentionValue } from "@lp-labs/react-mentions";
import "@lp-labs/react-mentions/styles.css";

const people = [
  { id: "ada", label: "Ada Lovelace" },
  { id: "grace", label: "Grace Hopper" }
];

export function Message() {
  const [value, setValue] = useState<MentionValue>({ text: "", mentions: [] });
  return (
    <>
      <label htmlFor="message">Message</label>
      <Mentions
        value={value}
        onChange={(next, details) => {
          setValue(next);
          console.log(details.reason); // "input" or "select"
        }}
        loadSuggestions={async (query, { signal, trigger }) => {
          // For a remote endpoint, pass signal to fetch and return {id, label}[].
          if (signal.aborted || trigger !== "@") return [];
          return people.filter((person) =>
            person.label.toLowerCase().includes(query.toLowerCase()));
        }}
        textareaProps={{ id: "message", rows: 5, placeholder: "Type @ to mention" }}
      />
      <pre>{value.text}</pre>
    </>
  );
}
```

The parent must immediately return accepted text and ranges via `value`.
`onChange` is a proposal, not internal persistent state. Store/submit the plain
text and mention metadata together. Use metadata IDs for entity linking; do not
infer identity by parsing labels.

## Supported document model

Only a **textarea** is supported, not contenteditable, HTML, rich text, or a
markup serialization format. A `MentionValue` is:

```ts
{
  text: "Hello @Ada",
  mentions: [{ id: "ada", label: "Ada", trigger: "@", start: 6, end: 10 }]
}
```

`MentionSuggestion` is `{id: string, label: string}`. `MentionRange` extends it
with `{start: number, end: number, trigger: string}`. Offsets are UTF-16 code-unit
indexes (the same indexing as JavaScript strings and textarea selections);
`end` is exclusive. Ranges cover trigger plus full label, excluding the optional
appended space. Ranges must be sorted, nonoverlapping, nonempty, in bounds, and
exactly match `text.slice(start, end) === trigger + label`. IDs and labels must
be nonempty; labels cannot contain CR/LF. Triggers must be nonempty and contain
no whitespace. Multiple occurrences may share an entity ID.

Ordinary typing/paste/deletion uses the longest common prefix/suffix to infer
one contiguous edit. Ranges after the edit shift; any range intersecting the
edit loses its metadata but its remaining characters remain ordinary text.
Insertion strictly inside a mention removes its range. Insertion exactly at
its start shifts it, and insertion at its end preserves it. Mentions are not
atomic deletion tokens. Plain text does not visually highlight ranges.

The diff is not an edit-history/operational-transform engine. Repeated identical
characters can make the original edit location ambiguous; disjoint programmatic
edits may conservatively discard ranges between changed regions. Use
`applyTextEdit` with known offsets for exact external edits and pass the result
as `value`. It is not grapheme-aware; callers supplying offsets must avoid
splitting surrogate pairs if that matters for their application.

All default rendering uses escaped React text; HTML-looking labels stay literal
text. There is no `dangerouslySetInnerHTML` path or HTML insertion/paste parsing.
Do not add unsafe HTML to a custom renderer yourself.

## Mentions props

| Prop | Default | Contract |
| --- | --- | --- |
| `value` | required | Valid `MentionValue`. |
| `onChange(value, details)` | required | Details `{reason: "input" \| "select", suggestion?}`; suggestion exists on selection. |
| `loadSuggestions(query, context)` | required | Return readonly `MentionSuggestion[]` or a promise. Context `{trigger, signal: AbortSignal}`. Filtering/ranking is up to the loader. |
| `triggers` | `["@"]` | Unique nonempty strings with no whitespace; multi-character triggers supported. |
| `minQueryLength` | `0` | Nonnegative integer, excluding trigger. |
| `maxQueryLength` | `64` | Integer >= minimum; measured in UTF-16 code units. |
| `debounceMs` | `150` | Nonnegative integer loader delay in milliseconds. |
| `maxSuggestions` | `10` | Positive integer; truncates loader output. |
| `appendSpace` | `true` | Add one space after an inserted mention. |
| `onError(error)` | absent | Active loader/rejected-result errors; aborted/stale errors are ignored. |
| `renderSuggestion(suggestion, active)` | label text | Return noninteractive React content. Never nest focusable controls in an option. |
| `textareaProps` | absent | Native textarea props except component-owned value/change, selection, key, blur, composition, role and suggestion ARIA props. Includes `id`, `name`, `rows`, `disabled`, `readOnly`, `required`, labels, style and class. |
| `className`, `style` | `""`, absent | Wrapper customization; preserve relative positioning for popup placement. |
| `loadingText` | `"Loading suggestions"` | Loading status text. |
| `emptyText` | `"No suggestions"` | Empty result text. |
| `errorText` | `"Suggestions unavailable"` | Failure status text. |

`textareaProps.onFocus` is preserved. Default accessible name is `"Message"`,
unless `aria-label` or `aria-labelledby` is supplied. When using an external
label, also supply an appropriate `aria-label`/`aria-labelledby` if you want to
override this default. `disabled`/`readOnly` prevent suggestion loading.
Native `maxLength` applies to user typing, but programmatic mention insertion
does not enforce it: validate resulting length in the parent if necessary.

## Trigger and asynchronous behavior

Queries activate only with focus and a collapsed selection, outside an existing
mention, at document start or after whitespace. The text between trigger and
caret must contain no whitespace or other configured trigger and must satisfy
the length bounds. Thus `email@name` does not open suggestions. Selection
replaces trigger through caret, leaving text after the caret untouched.

Up/Down wraps the active suggestion; Enter or Tab accepts it and keeps textarea
focus. Escape dismisses the current query until typing changes it. Mouse selection
prevents mousedown focus loss. During IME composition, the menu/selection shortcuts
are suspended. Blur closes the menu. There is no caret-position measurement:
the popup sits below the entire textarea, not next to the typed trigger.

Every query change, dismissal, blur or unmount cancels the debounce timer and
aborts that request's signal. A sequence check and abort check suppress stale
responses even when a loader ignores abort. Abort does not stop noncooperative
server work. A loader identity change alone does not reload the same query;
the latest loader is used on the next query request. Results must be arrays
of valid suggestions; invalid results follow the error path. Errors show a
status and optionally invoke `onError`; they are not thrown from render.

## Helpers and exported types

All helpers are named exports and do not require a mounted component.

* `validateValue(value): void`: validate the model; malformed container types
  throw `TypeError`, invalid ranges throw `RangeError`.
* `validateTriggers(triggers): void`: require a nonempty array of unique,
  nonempty, whitespace-free trigger strings; otherwise `RangeError`.
* `applyTextEdit(value, start, end, inserted): MentionValue`: replace
  `[start, end)` and update ranges without mutation. Invalid offsets throw
  `RangeError`; insertion offsets may equal text length.
* `updateText(value, text): MentionValue`: infer a contiguous edit and update
  ranges; returns the original object for identical text.
* `findMentionQuery(value, caret, triggers = ["@"], maxQueryLength = 64)`:
  return `MentionQuery` (`{start, end, trigger, query}`) or null. It does not
  apply a minimum length. Invalid caret/max length throws `RangeError`.
* `insertMention(value, query, suggestion, appendSpace = true)`:
  return `{value: MentionValue, caret: number}`. Validates the suggestion
  and that query still matches the source; stale/malformed queries throw
  `RangeError`. The caller must pass a current query from `findMentionQuery`.

Also exported: `MentionsProps`, `SuggestionsContext`, `MentionSuggestion`,
`MentionRange`, `MentionValue`, and `MentionQuery`. Component model/limit
validation runs during render; use a React error boundary for bad supplied
state. Errors in consumer callbacks are not swallowed.

Standalone helper example:

```ts
import { findMentionQuery, insertMention, applyTextEdit } from "@lp-labs/react-mentions";

const draft = { text: "Hello @Ad", mentions: [] };
const query = findMentionQuery(draft, draft.text.length);
if (query) {
  const { value, caret } = insertMention(draft, query, { id: "ada", label: "Ada" });
  const edited = applyTextEdit(value, caret, caret, "!");
  console.log(edited.text); // "Hello @Ada !"
}
```

`SuggestionsContext` is `{ trigger: string; signal: AbortSignal }`.
`MentionsProps` is the exported props interface above; callback details are
`{ reason: "input" | "select"; suggestion?: MentionSuggestion }`. Helper
parameters use `MentionValue`, numeric offsets/caret, and string inserted/text
values. `validateTriggers` and query helpers accept readonly trigger arrays.
No helper queues asynchronous work. Module import does not access browser
globals; mount in a DOM-capable React application and include DOM TypeScript
declarations for textarea/signal APIs. Loaders own transport cleanup beyond
the supplied abort signal; no worker package is required.

## Styling and accessibility

Import the CSS export or supply your own. Stable classes are `lp-mentions`,
`lp-mentions__popup`, `lp-mentions__option`; the textarea is a direct child.
The popup uses inline absolute positioning and z-index 10. Ancestor overflow
can clip it; there is no portal, auto-flip, virtualization or scroll-into-view
of the active option. Long suggestion lists may require your own styling.

```css
.chat-input textarea { min-height: 140px; }
.chat-input .lp-mentions__option[aria-selected="true"] { background: #ede9fe; }
```

Pass `className="chat-input"`. The textarea retains its native multiline
semantics and exposes list autocomplete, popup state, and active descendant;
the popup uses listbox/options and a polite status. Screen-reader behavior for
textarea autocomplete varies, so test with your target browser/assistive
technology. No claim of a fully certified ARIA combobox is made. Labels,
status text and custom renderers should remain accessible.

## License

[MIT](./LICENSE).

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
