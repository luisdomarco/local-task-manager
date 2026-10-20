// People named on items: an activity's sender (`from`) and a meeting's attendees.
// `from` used to be one line of text; it is a list now, and old files still hold the text.
export const peopleOf = (value) => (Array.isArray(value) ? value : value ? [String(value)] : []).filter(Boolean);
