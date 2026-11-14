import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { frameDoc, isDrawioXml, scriptJson, viewerConfig } from '../../static/js/drawiodoc.js';
import { codeLanguage, fileKind, isDrawio, linkWikilinks } from '../../static/js/filetree.js';

const XML = '<mxfile><diagram name="A"><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram></mxfile>';

describe('draw.io files', () => {
  it('a .drawio is text (its XML in Source and Edit) shown as its diagram', () => {
    assert.equal(fileKind('Docs/Flow.drawio'), 'text');
    assert.equal(codeLanguage('Docs/Flow.drawio'), 'xml');
    assert.equal(isDrawio('Docs/Flow.DRAWIO'), true);
    assert.equal(isDrawio('Docs/Flow.drawio.svg'), false);
  });

  it('knows a diagram from other XML', () => {
    assert.equal(isDrawioXml(XML), true);
    assert.equal(isDrawioXml('<?xml version="1.0"?>\n<mxGraphModel><root/></mxGraphModel>'), true);
    assert.equal(isDrawioXml('<svg/>'), false);
    assert.equal(isDrawioXml(''), false);
  });

  it('![[x.drawio]] is a placeholder renderDrawios draws; a missing one says so', () => {
    const at = (t) => (t === 'Flow.drawio' ? 'Docs/Flow.drawio' : null);
    assert.equal(linkWikilinks('![[Flow.drawio]]', at), '<div class="md-drawio" data-drawio="Docs/Flow.drawio"></div>');
    assert.match(linkWikilinks('![[Gone.drawio]]', at), /class="md-missing"/);
    assert.match(linkWikilinks('[[Flow.drawio]]', at), /^\[Flow\.drawio\]\(/, 'a plain link stays a link');
  });
});

describe('the viewer frame', () => {
  it('JSON in a script element cannot close it', () => {
    const s = scriptJson({ xml: '</script><script>alert(1)</script> ' });
    assert.ok(!s.includes('<'));
    assert.ok(!s.includes(' '));
    assert.deepEqual(JSON.parse(s), { xml: '</script><script>alert(1)</script> ' });
  });

  it('allows no network and carries the diagram as data', () => {
    const doc = frameDoc('<mxfile></script><img src=x onerror=alert(1)></mxfile>', { id: 'd1' });
    const csp = /Content-Security-Policy" content="([^"]+)"/.exec(doc)[1];
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'unsafe-inline' blob:;/);
    assert.doesNotMatch(csp, /unsafe-eval|https?:|connect-src/);
    assert.equal((doc.match(/<\/script>/g) || []).length, (doc.match(/<script/g) || []).length, 'the XML closes no script');
    assert.ok(!doc.includes('<img src=x'));
    assert.match(doc, /window\.PROXY_URL='data:,'/);
    assert.match(doc, /mxStencil\.allowEval = false/);
  });

  it('draws read-only, on its own paper', () => {
    const c = viewerConfig(XML, { compact: true });
    assert.equal(c.xml, XML);
    assert.equal(c['dark-mode'], false);
    assert.equal(c.lightbox, false);
    assert.equal(c.editable, false);
    assert.equal(c.toolbar, 'pages zoom layers');
    assert.match(frameDoc(XML, { id: 'x' }), /background:#fff/);
  });
});
