import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseUnifiedDiff } from '../../static/js/udiff.js';

const DIFF = `diff --git a/a.txt b/a.txt
index 5626abf..f00c965 100644
--- a/a.txt
+++ b/a.txt
@@ -1,2 +1,3 @@
 one
-two
+TWO
+three
\\ No newline at end of file
diff --git a/b.txt b/b.txt
new file mode 100644
--- /dev/null
+++ b/b.txt
@@ -0,0 +1 @@
+hi
`;

describe('udiff', () => {
  it('reads hunks and their lines, leaving the headers out', () => {
    const d = parseUnifiedDiff(DIFF);
    assert.deepEqual(d.lines, [
      { hunk: '@@ -1,2 +1,3 @@' }, { sign: ' ', text: 'one' }, { sign: '-', text: 'two' }, { sign: '+', text: 'TWO' }, { sign: '+', text: 'three' },
      { hunk: '@@ -0,0 +1 @@' }, { sign: '+', text: 'hi' },
    ]);
    assert.equal(d.add, 3);
    assert.equal(d.del, 1);
  });

  it('is nothing for nothing', () => {
    assert.deepEqual(parseUnifiedDiff(''), { lines: [], add: 0, del: 0 });
    assert.deepEqual(parseUnifiedDiff('Binary files /dev/null and b/x differ\n'), { lines: [], add: 0, del: 0 });
  });
});
