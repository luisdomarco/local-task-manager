# Security

Local Task Manager runs on your own machine: the server listens on `127.0.0.1` only, every request that changes something must
carry the `X-Task-Manager` header (so a web page you visit cannot post to it), and Markdown is sanitized with
DOMPurify before it reaches the page. Your data never leaves your machine unless you start Claude Code on an item
(which then talks to Anthropic under your own account) or use dictation in Chrome (which sends the audio to Google).

If you find a way around any of this, please **do not open a public issue**. Report it privately through GitHub's
*Security → Report a vulnerability* on this repository, with the steps to reproduce it. You will get an answer as
soon as it has been looked at.
