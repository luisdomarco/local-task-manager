"""Post-build patch of Excalidraw 0.18's renderer (BUILD.md, "After the build: the app's patch").

Run once on a fresh build: `python3 build/patch.py chunks/chunk-<hash>.js` (the chunk with rough.js and the
renderer). Each replacement must match exactly once; it stops at the first that does not (a new version needs its
own look). Applied twice, it says so and changes nothing.
"""
import sys

PATCHES = [
    # 1. No hairlines: Chrome draws a stroke of 1 device pixel or less as a "hairline", broken every few pixels. A rough
    #    path is stroked at least a hair over 1 device pixel (the context's own scale: devicePixelRatio × zoom).
    ('i.lineWidth=n.strokeWidth,n.strokeLineDash&&i.setLineDash(n.strokeLineDash)',
     'i.lineWidth=(t=>Math.max(n.strokeWidth,1.01/Math.hypot(t.a,t.b)))(i.getTransform()),n.strokeLineDash&&i.setLineDash(n.strokeLineDash)'),
    # 2. Crisp odd widths: an element's cache canvas draws it from a whole pixel, so a line an odd number of device
    #    pixels wide falls across two rows at half grey. Half a pixel in, it covers its own. (Not a text, an image or a
    #    freehand line: they have no stroke to align.)
    ('l.save(),l.translate(U*d,U*d),l.scale(window.devicePixelRatio*d,window.devicePixelRatio*d);let u=Lt.canvas(r);',
     'l.save();let tmHalf=e.type==="text"||e.type==="image"||e.type==="freedraw"?0:Math.max(1,Math.round((e.strokeStyle!=="solid"?e.strokeWidth+.5:e.strokeWidth)*window.devicePixelRatio*d))%2/2;l.translate(U*d+tmHalf,U*d+tmHalf),l.scale(window.devicePixelRatio*d,window.devicePixelRatio*d);let u=Lt.canvas(r);'),
    # 3. ...and that cache canvas is laid on the scene at a whole device pixel (the context is scaled by the zoom
    #    there), not wherever the scroll puts it, which would resample it soft.
    ('t.drawImage(e.canvas,(o+n.scrollX)*window.devicePixelRatio-l*e.scale/e.scale,(s+n.scrollY)*window.devicePixelRatio-l*e.scale/e.scale,e.canvas.width/e.scale,e.canvas.height/e.scale)',
     't.drawImage(e.canvas,Math.round(((o+n.scrollX)*window.devicePixelRatio-l)*n.zoom.value)/n.zoom.value,Math.round(((s+n.scrollY)*window.devicePixelRatio-l)*n.zoom.value)/n.zoom.value,e.canvas.width/e.scale,e.canvas.height/e.scale)'),
    # 4. draw.io's "classic" head: the filled triangle with a notch in its back, a quarter of its length deep.
    ('case"triangle":case"triangle_outline":{let[s,d,c,h,u,b]=U;return delete r.strokeLineDash,[i.polygon([[s,d],[c,h],[u,b],[s,d]],',
     'case"triangle":case"triangle_outline":{let[s,d,c,h,u,b]=U;return delete r.strokeLineDash,[i.polygon(n==="triangle"?[[s,d],[c,h],[s+((c+u)/2-s)*.75,d+((h+b)/2-d)*.75],[u,b],[s,d]]:[[s,d],[c,h],[u,b],[s,d]],'),
]


def main(path):
    src = open(path, encoding='utf-8').read()
    if all(after in src for _, after in PATCHES):
        print(f'{path}: already patched')
        return 0
    for n, (before, after) in enumerate(PATCHES, 1):
        if src.count(before) != 1:
            print(f'{path}: patch {n} matches {src.count(before)} times, not once: look at this version by hand')
            return 1
        src = src.replace(before, after)
    open(path, 'w', encoding='utf-8').write(src)
    print(f'{path}: {len(PATCHES)} patches applied')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1]))
