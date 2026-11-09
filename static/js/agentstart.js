// Run, wherever an agent is started from (its page, the Home, a run's "Run it again"): its chat in the dock, in the
// agent's folder or a new worktree of it, with `/<name> <args>` written in the dock's composer and nothing sent
// (server.py open_agent_chat). The arguments, mode, model and effort are settled there — the dock's composer is the only
// one — and the run is recorded when that first message goes. It starts with what the agent last ran with.
import { activity, refreshActivity } from './agentactivity.js';
import { RUN_MODES } from './agentsmodel.js';
import { api } from './api.js';
import { state, toast } from './state.js';

/** The mode, model and effort a new run of an agent starts with: its newest run's, else Settings' (default mode). */
export function startChoices(dirId, name) {
  const last = (activity()?.runs || []).find((r) => r.dir === dirId && r.cmd === name);
  return {
    mode: RUN_MODES.some(([m]) => m === last?.mode) ? last.mode : 'default',
    model: last ? last.model || '' : state.config.claude_model || '',
    effort: last ? last.effort || '' : state.config.claude_effort || '',
  };
}

/** Opens agent `name` of folder `folder` in the dock, its command written and not sent. → the server's answer, or
 *  null when it could not start (said in a toast). */
export async function startAgent(folder, name, { args = '', where = 'here' } = {}) {
  const c = startChoices(folder.id, name);
  try {
    const out = await api.agentOpen(folder.id, name, args, c.mode, c.model, c.effort, folder.git && where === 'worktree' ? 'worktree' : 'here');
    const { showChatHere } = await import('./term.js');
    showChatHere(out.chat, out.draft, refreshActivity); // its first message makes it a run: the pages hear of it at once
    if (out.branch) toast(`In a new worktree on ${out.branch} — add its arguments and send`);
    refreshActivity();
    return out;
  } catch (e) {
    toast(e.message, true);
    return null;
  }
}
