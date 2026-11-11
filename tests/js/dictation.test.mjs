import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DICTATION_TITLE, dictation, dictationLang, spaced, speechCtor, splitResults, tail } from '../../static/js/dictation.js';

// A SpeechRecognitionResultList as the browser hands it: results of alternatives, each final or not.
const result = (transcript, isFinal) => Object.assign([{ transcript }], { isFinal });

describe('dictation', () => {
  it("listens in the iPhone app's keyboard language, else the browser's, else English", () => {
    const nav = { language: 'en-GB' };
    assert.equal(dictationLang({ tmNative: { keyboardLang: 'es-ES' }, navigator: nav }), 'es-ES');
    assert.equal(dictationLang({ navigator: nav }), 'en-GB'); // a browser: no app around it
    assert.equal(dictationLang({ tmNative: {}, navigator: nav }), 'en-GB'); // no keyboard seen yet
    assert.equal(dictationLang({ tmNative: { keyboardLang: 'es-ES"; x' }, navigator: nav }), 'en-GB'); // not a language
    assert.equal(dictationLang({}), 'en-US');
  });

  it('finds the speech recogniser, prefixed or not, and none in a browser without it', () => {
    function Std() {}
    function Webkit() {}
    assert.equal(speechCtor({ SpeechRecognition: Std, webkitSpeechRecognition: Webkit }), Std);
    assert.equal(speechCtor({ webkitSpeechRecognition: Webkit }), Webkit);
    assert.equal(speechCtor({}), null);
  });

  it('gives no button where there is no speech recognition', () => {
    assert.equal(dictation({}), null);
  });

  it('splits the final text from what is still being heard, from the first new result on', () => {
    const results = [result('already typed', true), result(' hello world', true), result(' and th', false)];
    assert.deepEqual(splitResults(results, 1), { final: ' hello world', interim: ' and th' });
    assert.deepEqual(splitResults([result('maybe', false)]), { final: '', interim: 'maybe' });
    assert.deepEqual(splitResults([], 0), { final: '', interim: '' });
  });

  it('puts one space between dictated words and the text around the cursor', () => {
    assert.equal(spaced('', 'Hello world'), 'Hello world');
    assert.equal(spaced('Buy milk', ' and eggs'), ' and eggs'); // Chrome's own leading space is not doubled
    assert.equal(spaced('Buy milk ', 'and eggs'), 'and eggs');
    assert.equal(spaced('First line\n', 'second'), 'second');
    assert.equal(spaced('Call (', 'Ana'), 'Ana');
    assert.equal(spaced('Done', ', thanks'), ', thanks');
    assert.equal(spaced('Buy ', 'fresh', 'milk'), 'fresh '); // dictated in the middle of a sentence
    assert.equal(spaced('Buy ', 'milk', '.'), 'milk');
    assert.equal(spaced('a', '  two   spaces  '), ' two spaces');
    assert.equal(spaced('a', '   '), '');
  });

  it('shows the end of a long interim text, cut at a word', () => {
    assert.equal(tail('short'), 'short');
    const long = 'one two three four five six seven eight nine ten eleven twelve';
    const t = tail(long, 20);
    assert.ok(t.startsWith('…'));
    assert.ok(long.endsWith(t.slice(1)));
    assert.ok(t.length <= 21);
    assert.ok(long.includes(` ${t.slice(1)}`), 'starts at a word');
  });

  it('tells, in its tooltip, how to use the system Dictation instead', () => {
    assert.match(DICTATION_TITLE, /macOS Dictation/);
    assert.match(DICTATION_TITLE, /Esc/);
  });
});
