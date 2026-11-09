// List: every type's items in one list (views/list.js with no type): the view bar, with Type as one more filter, and
// the quiet rows. No Add: what to add is a type's page's. Its Board switch goes to the Board page.
import { listView } from './list.js';

export function mount(root) {
  return listView(null).mount(root);
}
