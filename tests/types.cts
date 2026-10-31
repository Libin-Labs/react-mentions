import mentions = require('@lp-labs/react-mentions');

const props: mentions.MentionsProps = {
  value: { text: '', mentions: [] },
  onChange() {},
  loadSuggestions: () => [],
};
mentions.Mentions(props);
mentions.findMentionQuery(props.value, 0);
