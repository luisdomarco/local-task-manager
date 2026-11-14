import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lowerName, statusLabel } from '../../static/js/ui.js';

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

describe('lowerName', () => {
  it('puts a type\'s name in lower case inside a sentence, but its acronyms', () => {
    assert.equal(lowerName('Task'), 'task');
    assert.equal(lowerName('User stories'), 'user stories');
    assert.equal(lowerName('PRD'), 'PRD');
    assert.equal(lowerName('PRDs'), 'PRDs');
    assert.equal(lowerName('AI Agent'), 'AI agent');
    assert.equal(lowerName(''), '');
  });
});
