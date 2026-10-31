import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import {
  findMentionQuery,
  insertMention,
  updateText,
  validateTriggers,
  validateValue,
  type MentionQuery,
  type MentionSuggestion,
  type MentionValue,
} from './model.js';

export interface SuggestionsContext {
  trigger: string;
  signal: AbortSignal;
}

export interface MentionsProps {
  value: MentionValue;
  onChange: (
    value: MentionValue,
    details: { reason: 'input' | 'select'; suggestion?: MentionSuggestion },
  ) => void;
  loadSuggestions: (
    query: string,
    context: SuggestionsContext,
  ) => readonly MentionSuggestion[] | Promise<readonly MentionSuggestion[]>;
  triggers?: readonly string[];
  minQueryLength?: number;
  maxQueryLength?: number;
  debounceMs?: number;
  maxSuggestions?: number;
  appendSpace?: boolean;
  onError?: (error: unknown) => void;
  renderSuggestion?: (suggestion: MentionSuggestion, active: boolean) => ReactNode;
  textareaProps?: Omit<
    TextareaHTMLAttributes<HTMLTextAreaElement>,
    | 'value'
    | 'defaultValue'
    | 'onChange'
    | 'onSelect'
    | 'onKeyDown'
    | 'onCompositionStart'
    | 'onCompositionEnd'
    | 'onBlur'
    | 'children'
    | 'dangerouslySetInnerHTML'
    | 'role'
    | 'aria-controls'
    | 'aria-expanded'
    | 'aria-activedescendant'
    | 'aria-autocomplete'
    | 'aria-haspopup'
  >;
  className?: string;
  style?: CSSProperties;
  loadingText?: string;
  emptyText?: string;
  errorText?: string;
}

const defaultTriggers = ['@'];

export function Mentions({
  value,
  onChange,
  loadSuggestions,
  triggers = defaultTriggers,
  minQueryLength = 0,
  maxQueryLength = 64,
  debounceMs = 150,
  maxSuggestions = 10,
  appendSpace = true,
  onError,
  renderSuggestion,
  textareaProps,
  className = '',
  style,
  loadingText = 'Loading suggestions',
  emptyText = 'No suggestions',
  errorText = 'Suggestions unavailable',
}: MentionsProps) {
  validateValue(value);
  validateTriggers(triggers);
  if (
    ![minQueryLength, maxQueryLength, debounceMs, maxSuggestions].every(Number.isInteger) ||
    minQueryLength < 0 ||
    maxQueryLength < minQueryLength ||
    debounceMs < 0 ||
    maxSuggestions < 1
  ) {
    throw new RangeError('Invalid suggestion limits');
  }
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<readonly MentionSuggestion[]>([]);
  const [resultKey, setResultKey] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [active, setActive] = useState(0);
  const requestId = useRef(0);
  const pendingCaret = useRef<number | null>(null);
  const loader = useRef(loadSuggestions);
  const errorCallback = useRef(onError);
  loader.current = loadSuggestions;
  errorCallback.current = onError;
  const listId = useId();
  const query =
    focused &&
    !composing &&
    !textareaProps?.disabled &&
    !textareaProps?.readOnly &&
    caret >= 0 &&
    caret <= value.text.length
      ? findMentionQuery(value, caret, triggers, maxQueryLength)
      : null;
  const key = query ? `${query.start}:${query.end}:${query.trigger}:${query.query}` : '';
  const enabled = Boolean(query && query.query.length >= minQueryLength && dismissed !== key);
  const currentSuggestions = resultKey === key ? suggestions : [];
  const queryRef = useRef<MentionQuery | null>(query);
  queryRef.current = query;

  useEffect(() => {
    const id = ++requestId.current;
    const controller = new AbortController();
    setSuggestions([]);
    setResultKey(key);
    setActive(0);
    if (!enabled || !queryRef.current) {
      setStatus('idle');
      return () => {
        controller.abort();
      };
    }
    setStatus('loading');
    const currentQuery = queryRef.current;
    const timer = setTimeout(async () => {
      try {
        const result = await loader.current(currentQuery.query, {
          trigger: currentQuery.trigger,
          signal: controller.signal,
        });
        if (controller.signal.aborted || id !== requestId.current) return;
        if (
          !Array.isArray(result) ||
          result.some(
            (item) =>
              !item ||
              typeof item.id !== 'string' ||
              !item.id ||
              typeof item.label !== 'string' ||
              !item.label ||
              /[\r\n]/.test(item.label),
          )
        )
          throw new TypeError('Suggestions must contain nonempty id and single-line label');
        setSuggestions(result.slice(0, maxSuggestions));
        setStatus('ready');
      } catch (error) {
        if (controller.signal.aborted || id !== requestId.current) return;
        setStatus('error');
        errorCallback.current?.(error);
      }
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, key, debounceMs, maxSuggestions]);

  useEffect(() => {
    if (pendingCaret.current !== null && textarea.current) {
      textarea.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      setCaret(pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [value.text]);

  const select = (suggestion: MentionSuggestion) => {
    if (!query || !enabled) return;
    const next = insertMention(value, query, suggestion, appendSpace);
    pendingCaret.current = next.caret;
    setDismissed(key);
    setSuggestions([]);
    onChange(next.value, { reason: 'select', suggestion });
    textarea.current?.focus();
  };
  const expanded = enabled && status !== 'idle';
  return (
    <div className={`lp-mentions ${className}`} style={{ position: 'relative', ...style }}>
      <textarea
        {...textareaProps}
        ref={textarea}
        value={value.text}
        aria-label={
          textareaProps?.['aria-label'] ??
          (textareaProps?.['aria-labelledby'] ? undefined : 'Message')
        }
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        aria-activedescendant={
          expanded && currentSuggestions[active] ? `${listId}-${active}` : undefined
        }
        onFocus={(event) => {
          setFocused(true);
          setCaret(
            event.currentTarget.selectionStart === event.currentTarget.selectionEnd
              ? event.currentTarget.selectionStart
              : -1,
          );
          textareaProps?.onFocus?.(event);
        }}
        onBlur={() => {
          setFocused(false);
        }}
        onSelect={(event) => {
          const element = event.currentTarget;
          setCaret(element.selectionStart === element.selectionEnd ? element.selectionStart : -1);
        }}
        onChange={(event) => {
          const element = event.currentTarget;
          setCaret(element.selectionStart);
          setDismissed(null);
          onChange(updateText(value, element.value), { reason: 'input' });
        }}
        onCompositionStart={() => {
          setComposing(true);
        }}
        onCompositionEnd={(event) => {
          setComposing(false);
          setCaret(event.currentTarget.selectionStart);
        }}
        onKeyDown={(event) => {
          if (composing || event.nativeEvent.isComposing || !expanded) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            setDismissed(key);
          } else if (currentSuggestions.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault();
            const delta = event.key === 'ArrowDown' ? 1 : -1;
            setActive(
              (previous) =>
                (previous + delta + currentSuggestions.length) % currentSuggestions.length,
            );
          } else if (currentSuggestions[active] && ['Enter', 'Tab'].includes(event.key)) {
            event.preventDefault();
            select(currentSuggestions[active]);
          }
        }}
      />
      {expanded && (
        <div
          className="lp-mentions__popup"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 10,
          }}
        >
          <div role="listbox" id={listId} aria-label="Mention suggestions">
            {currentSuggestions.map((suggestion, index) => (
              <div
                role="option"
                aria-selected={index === active}
                id={`${listId}-${index}`}
                key={`${suggestion.id}:${index}`}
                className="lp-mentions__option"
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onMouseEnter={() => setActive(index)}
                onClick={() => select(suggestion)}
              >
                {renderSuggestion
                  ? renderSuggestion(suggestion, index === active)
                  : suggestion.label}
              </div>
            ))}
          </div>
          <div role="status" aria-live="polite">
            {status === 'loading' || resultKey !== key
              ? loadingText
              : status === 'error'
                ? errorText
                : currentSuggestions.length === 0
                  ? emptyText
                  : `${currentSuggestions.length} suggestions`}
          </div>
        </div>
      )}
    </div>
  );
}
