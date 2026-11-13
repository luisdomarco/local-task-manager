// The part of CodeMirror 6 the app's Live editor uses (static/js/livemd.js), as one ES module.
export { EditorState, EditorSelection, StateField, StateEffect, RangeSetBuilder, Compartment, Transaction, Annotation, Prec } from '@codemirror/state';
export { EditorView, Decoration, ViewPlugin, WidgetType, keymap, placeholder } from '@codemirror/view';
export { history, historyKeymap, defaultKeymap, undo, redo } from '@codemirror/commands';
export { Language, LanguageSupport, defineLanguageFacet, syntaxTree, ensureSyntaxTree, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
export { autocompletion, startCompletion, closeCompletion, completionStatus, acceptCompletion, completionKeymap } from '@codemirror/autocomplete';
export { parser as markdownParser, GFM } from '@lezer/markdown';
export { tags } from '@lezer/highlight';
