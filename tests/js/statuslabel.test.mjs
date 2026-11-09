import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { statusLabel } from '../../static/js/ui.js';

describe('statusLabel', () => {
  it('reads a stored status name as words in sentence case', () => {
    assert.equal(statusLabel('InProgress'), 'In progress');
    assert.equal(statusLabel('ToDo'), 'To do');
    assert.equal(statusLabel('OnHold'), 'On hold');
    assert.equal(statusLabel('Backlog'), 'Backlog');
    assert.equal(statusLabel('open'), 'Open');
    assert.equal(statusLabel('In QA'), 'In QA');
    assert.equal(statusLabel('in_review'), 'In review');
    assert.equal(statusLabel(''), '');
    assert.equal(statusLabel(null), '');
  });
});
