// Inbox: capture fast, triage later. Captured items are of type `inbox` and leave
// by being converted into a task / initiative / note / meeting. Unrelated items of
// other types are found in All items with the "Not related" filter.
import { TYPES, TYPE_ICON, TYPE_LABEL } from '../create.js';
import { convertTo, openItem } from '../panel.js';
import { quickAddBar } from '../quickadd.js';
import { PARENT_TYPES, propsOf } from '../rules.js';
import { state, updateItem } from '../state.js';
import { dropdown, emptyState, h, itemCard, parentOptions, select, selectButton } from '../ui.js';
import { refOf } from '../shownid.js';
import { planSection } from '../planrows.js';

// "Related to…" picked on a card before it is transformed, kept across re-renders. A Projects inbox item keeps it in
// its own `file_under` instead (its card's Properties shows it too, and Convert to carries it over).
const relatedChoice = new Map();
const keptOnItem = () => propsOf('inbox').some((p) => p.key === 'file_under');
const relatedOf = (item) => (keptOnItem() ? item.fields.file_under || undefined : relatedChoice.get(item.key));

// Every type a captured item can be related to (activity accepts the widest set).
const relatable = () => PARENT_TYPES.activity; // read when used: the structure arrives after this module loads

/** "Related to…" + "Convert to" for one captured item. */
function triage(item, rerender) {
  // Only open items: parentOptions already leaves out done, discarded and archived ones.
  const related = select(parentOptions(relatable(), 'Related to…'), relatedOf(item),
    (v) => {
      if (keptOnItem()) return updateItem(item.key, { file_under: v || '' }).catch(() => {}); // toasted; the save redraws
      v ? relatedChoice.set(item.key, v) : relatedChoice.delete(item.key);
      rerender();
    },
    { class: 'small', 'aria-label': `Relate ${item.title} to`, search: true });

  const transform = selectButton('Convert to', { class: 'small', 'aria-label': `Convert ${item.title} to` });
  transform.addEventListener('click', () => {
    const parent = state.byId.get(relatedOf(item));
    // A type can only be related to certain parent types: offer just the ones that fit the choice.
    const types = parent ? TYPES.filter((t) => PARENT_TYPES[t].includes(parent.type)) : TYPES;
    dropdown(transform, [
      ...(parent ? [{ heading: `Can relate to ${refOf(parent)}` }] : []),
      ...types.map((t) => ({
        label: TYPE_LABEL[t], icon: TYPE_ICON[t],
        onSelect: () => convertTo(item, t, parent ? { related_to: parent.id } : {}),
      })),
    ], { align: 'end' });
  });
  return [related, transform];
}

const newestFirst = (a, b) => String(b.fields.created_at || '').localeCompare(String(a.fields.created_at || ''));

export function mount(root) {
  const list = h('div', { class: 'plan-list inbox-list' });
  root.replaceChildren(
    h('header', { class: 'view-head' }, h('h1', {}, 'Inbox')),
    quickAddBar({ type: 'inbox' }, { autofocus: true, placeholder: 'Capture anything…  (/task, /note… to file it straight away)' }),
    list);
  const api = {
    update() {
      const captured = state.items.filter((i) => i.type === 'inbox').sort(newestFirst);
      list.replaceChildren(...[
        h('section', { class: 'plan-block inbox-block' },
          planSection({ title: 'Captured', count: captured.length || '' }),
          captured.length
            ? h('div', { class: 'cards rows' }, captured.map((i) => itemCard(i, { onOpen: openItem, extra: triage(i, () => api.update()),
              cls: keptOnItem() ? 'triage-in-card' : '' })))
            : emptyState('Inbox zero. Nothing captured waiting to be sorted.')),
      ].filter(Boolean));
    },
  };
  return api;
}
