import { Mentions, applyTextEdit, type MentionsProps } from '@lp-labs/react-mentions';

const props: MentionsProps = {
  value: { text: '', mentions: [] },
  onChange(value, details) {
    value.text.toLowerCase();
    const reason: 'input' | 'select' = details.reason;
    void reason;
  },
  async loadSuggestions(query, { signal }) {
    signal.throwIfAborted();
    return [{ id: query, label: query }];
  },
};
Mentions(props);
applyTextEdit(props.value, 0, 0, 'Hi');
