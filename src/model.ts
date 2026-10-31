export interface MentionSuggestion {
  id: string;
  label: string;
}

export interface MentionRange extends MentionSuggestion {
  start: number;
  end: number;
  trigger: string;
}

export interface MentionValue {
  text: string;
  mentions: readonly MentionRange[];
}

export interface MentionQuery {
  start: number;
  end: number;
  trigger: string;
  query: string;
}

export function validateTriggers(triggers: readonly string[]): void {
  if (
    !Array.isArray(triggers) ||
    !triggers.length ||
    triggers.some((trigger) => typeof trigger !== 'string' || !trigger || /\s/.test(trigger)) ||
    new Set(triggers).size !== triggers.length
  ) {
    throw new RangeError('triggers must be unique nonempty strings without whitespace');
  }
}

export function validateValue(value: MentionValue): void {
  if (typeof value.text !== 'string' || !Array.isArray(value.mentions)) {
    throw new TypeError('value must contain text and mentions');
  }
  let end = 0;
  for (const mention of value.mentions) {
    if (
      !Number.isInteger(mention.start) ||
      !Number.isInteger(mention.end) ||
      mention.start < end ||
      mention.end <= mention.start ||
      mention.end > value.text.length ||
      typeof mention.id !== 'string' ||
      !mention.id ||
      typeof mention.label !== 'string' ||
      !mention.label ||
      /[\r\n]/.test(mention.label) ||
      typeof mention.trigger !== 'string' ||
      !mention.trigger ||
      /\s/.test(mention.trigger) ||
      value.text.slice(mention.start, mention.end) !== mention.trigger + mention.label
    ) {
      throw new RangeError('Mention ranges must be sorted, nonoverlapping and match the text');
    }
    end = mention.end;
  }
}

export function applyTextEdit(
  value: MentionValue,
  start: number,
  end: number,
  inserted: string,
): MentionValue {
  validateValue(value);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end > value.text.length
  ) {
    throw new RangeError('Edit offsets must be within the text');
  }
  if (start === end && inserted === '') return value;
  const delta = inserted.length - (end - start);
  const mentions: MentionRange[] = [];
  for (const mention of value.mentions) {
    if (mention.end <= start) mentions.push({ ...mention });
    else if (mention.start >= end) {
      mentions.push({ ...mention, start: mention.start + delta, end: mention.end + delta });
    }
  }
  return {
    text: value.text.slice(0, start) + inserted + value.text.slice(end),
    mentions,
  };
}

/** Reconcile one contiguous plain-text edit using its longest common edges. */
export function updateText(value: MentionValue, text: string): MentionValue {
  validateValue(value);
  if (text === value.text) return value;
  let start = 0;
  while (start < value.text.length && start < text.length && value.text[start] === text[start]) {
    start++;
  }
  let oldEnd = value.text.length;
  let newEnd = text.length;
  while (oldEnd > start && newEnd > start && value.text[oldEnd - 1] === text[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  return applyTextEdit(value, start, oldEnd, text.slice(start, newEnd));
}

export function findMentionQuery(
  value: MentionValue,
  caret: number,
  triggers: readonly string[] = ['@'],
  maxQueryLength = 64,
): MentionQuery | null {
  validateValue(value);
  validateTriggers(triggers);
  if (!Number.isInteger(caret) || caret < 0 || caret > value.text.length) {
    throw new RangeError('caret must be within the text');
  }
  if (!Number.isInteger(maxQueryLength) || maxQueryLength < 0) {
    throw new RangeError('maxQueryLength must be a nonnegative integer');
  }
  let match: MentionQuery | null = null;
  const before = value.text.slice(0, caret);
  for (const trigger of triggers) {
    const start = before.lastIndexOf(trigger);
    if (start < 0 || (start > 0 && !/\s/.test(before[start - 1]))) continue;
    const query = before.slice(start + trigger.length);
    if (
      /\s/.test(query) ||
      query.length > maxQueryLength ||
      triggers.some((other) => query.includes(other))
    )
      continue;
    if (value.mentions.some((mention) => mention.start < caret && mention.end > start)) continue;
    if (
      !match ||
      start > match.start ||
      (start === match.start && trigger.length > match.trigger.length)
    ) {
      match = { start, end: caret, trigger, query };
    }
  }
  return match;
}

export function insertMention(
  value: MentionValue,
  query: MentionQuery,
  suggestion: MentionSuggestion,
  appendSpace = true,
): { value: MentionValue; caret: number } {
  validateValue(value);
  if (
    typeof suggestion.id !== 'string' ||
    !suggestion.id ||
    typeof suggestion.label !== 'string' ||
    !suggestion.label ||
    /[\r\n]/.test(suggestion.label)
  ) {
    throw new RangeError('Suggestions require nonempty id and single-line label');
  }
  validateTriggers([query.trigger]);
  if (value.text.slice(query.start, query.end) !== query.trigger + query.query) {
    throw new RangeError('Query no longer matches the text');
  }
  const token = query.trigger + suggestion.label;
  const next = applyTextEdit(value, query.start, query.end, token + (appendSpace ? ' ' : ''));
  return {
    value: {
      text: next.text,
      mentions: [
        ...next.mentions,
        {
          ...suggestion,
          trigger: query.trigger,
          start: query.start,
          end: query.start + token.length,
        },
      ].sort((a, b) => a.start - b.start),
    },
    caret: query.start + token.length + (appendSpace ? 1 : 0),
  };
}
