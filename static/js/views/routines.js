// #/runs/routines: the Agents section's Routines — every schedule of every agent in one list, the next to fire first and
// the paused ones last (schedmodel.js routineOrder, tested). Each is a schedule's card (agentschedules.js scheduleList):
// ▷ Run now, and ⋯ Edit… · Go to its agent · Pause / Resume · Delete. A search over the agent, the rule and the
// arguments in the page's bar, as Labels' or Trash's. views/runs.js mounts it and hands it the section's tabs.
import { onActivity } from '../agentactivity.js';
import { addFolderDialog } from '../agentspane.js';
import { scheduleDialog, scheduleList } from '../agentschedules.js';
import { agentHref } from '../agentsmodel.js';
import { api } from '../api.js';
import { routineMatches, routineOrder } from '../schedmodel.js';
import { h, pageCount, pageEmpty, pageHead, searchBox, secondaryButton } from '../ui.js';

export function routinesPage(dirs, { sectionTabs }) {
  let schedules = null;
  let q = '';
  let stamp = 0;
  const count = pageCount();
  const list = h('div', { class: 'agents-routines' });
  const input = h('input', { type: 'search', placeholder: 'Search routines', 'aria-label': 'Search routines',
    oninput: () => { q = input.value.trim().toLowerCase(); paint(); } });

  // Edit… opens the agent's Schedule dialog: only while its folder and command are still there.
  const agentOf = (s) => {
    const folder = dirs.find((d) => d.id === s.dir);
    const agent = folder?.commands.find((c) => c.name === s.cmd);
    return folder && agent ? { folder, agent } : null;
  };
  const edit = (s) => {
    const found = agentOf(s);
    if (found) scheduleDialog({ ...found, existing: s, onSaved: load });
  };

  function paint() {
    if (!schedules) { list.replaceChildren(pageEmpty('Reading the routines…')); return; }
    const paused = schedules.filter((s) => s.paused).length;
    count.textContent = schedules.length ? `${schedules.length - paused} on${paused ? ` · ${paused} paused` : ''}` : 'Empty';
    if (!schedules.length) {
      list.replaceChildren(pageEmpty('Nothing scheduled yet. Schedule… on an agent\'s page runs it on its own: every routine shows here.'));
      return;
    }
    const shown = routineOrder(schedules.filter((s) => routineMatches(s, q)));
    list.replaceChildren(shown.length
      ? scheduleList(shown, { showAgent: true, edit, changed: load, openAgent: (s) => { location.hash = agentHref(s.dir, s.cmd); } })
      : pageEmpty('No routine matches.'));
  }
  async function load() {
    const mine = ++stamp;
    try {
      const r = await api.agentSchedules();
      if (mine === stamp) { schedules = r.schedules || []; paint(); }
    } catch { if (mine === stamp) { schedules = []; paint(); } }
  }

  paint();
  load();
  const off = onActivity(load); // a scheduled run started: its next time moved
  return {
    sig: '~routines',
    nodes: [
      pageHead({ title: 'Routines', count, action: secondaryButton('Add folder', { ico: 'plus', onclick: () => addFolderDialog() }) }),
      sectionTabs('routines'),
      h('div', { class: 'view-bar' }, searchBox(input)),
      list,
    ],
    stop: () => { off(); stamp += 1; },
    refresh(next) { dirs = next; },
  };
}
