// User stories on an initiative's page: the columns of their table. Sub-initiatives no longer
// get a tree of their own there: they are links like any other, in the Relations tab, and the
// Epics among them a table too (TypeDef.child_tables, panel.js pageTables).
import { COL } from './datatable.js';

/** The stories of an initiative, as the table the tasks, notes and meetings sections use. */
export const STORY_COLUMNS = [COL.id, COL.subject, COL.status, COL.priority, COL.plan, COL.due, COL.extref, COL.labels, COL.progress, COL.updated];
