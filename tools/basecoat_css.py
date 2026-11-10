#!/usr/bin/env python3
"""Write static/vendor/basecoat/basecoat-nova.app.css: Basecoat's Nova stylesheet as the page loads it (css/main.css).

Basecoat's own file (basecoat-nova.cdn.min.css, vendored as it ships) is three things at once: Tailwind's theme
variables, Tailwind's preflight (`@layer base`) and one `@layer components` block per component. Loaded as it is over
every screen it changes them: the preflight resets the Markdown of a description, headings and lists; and its class
names (`.btn`, `.card`, `.field`, `.empty`) are the app's too. So the page loads this derived copy instead:

- the theme variables, `@property` rules and keyframes as they are;
- no preflight: the app has its own base (app.css). In its place, the slice of it the adopted components assume
  (BASE, below), under `:where()` so any rule of theirs wins;
- of the components, only the families the app has moved to Basecoat (FAMILIES), one per phase-3 PR. Their selectors
  are rewritten from Basecoat's `data-variant` / `data-size` onto the app's own modifiers (`.btn.primary`,
  `.btn.small`, `.chip.on`…), so the places that make a button with `h('button', { class: 'btn small' })` and the ones
  that toggle `.active` at run time need no change. A variant or size the app has no class for is left out, and so
  is a rule that sizes the icons in a button or a badge: `icon(name, size)` (ui.js) sizes every icon;
- no `!important`: in the vendor layer it would beat the app's layer (main.css).

    python3 tools/basecoat_css.py           # rewrite the file
    python3 tools/basecoat_css.py --check   # exit 1 if the file is not what this script writes (tests/test_basecoat_css.py)
"""
import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'static/vendor/basecoat/basecoat-nova.cdn.min.css'
OUT = ROOT / 'static/vendor/basecoat/basecoat-nova.app.css'

# The app's button classes onto Basecoat's variants and sizes. One variant per button: the first that matches of
# primary (.primary, or .active: a toggle that is on), destructive (.danger), ghost (.ghost, or .icon: an icon button
# is borderless), outline (anything else: the app's default button).
_BTN_P = ':is(.primary,.active)'
_BTN_D = '.danger:not(.primary,.active)'
_BTN_G = ':is(.ghost,.icon):not(.primary,.active,.danger)'
_BTN_O = ':not(.primary,.active,.danger,.ghost,.icon)'
# The app's chip (ui.js chip, statusChip…) is Basecoat's badge: .on and the plan's Today / This week are filled,
# .late is the error one, .parent / .link / .source / .session are outlined, and every other chip is secondary.
_CHIP_P = ':is(.on,.plan.today,.plan.week)'
_CHIP_D = '.late:not(.on)'
_CHIP_O = ':is(.parent,.link,.source,.session):not(.on,.late)'
_CHIP_S = ':not(.on,.plan.today,.plan.week,.late,.parent,.link,.source,.session)'

FAMILIES = {
    # family: (Basecoat's class, the app's class, [(Basecoat's attribute selector, the app's)]; None: left out)
    'button': ('btn', 'btn', [
        (':not([data-variant])', _BTN_P), ('[data-variant=primary]', _BTN_P),
        ('[data-variant=destructive]', _BTN_D), ('[data-variant=ghost]', _BTN_G), ('[data-variant=outline]', _BTN_O),
        ('[data-variant=secondary]', None), ('[data-variant=link]', None),
        (':not([data-size])', ':not(.small,.icon)'), ('[data-size=default]', ':not(.small,.icon)'),
        ('[data-size=sm]', '.small:not(.icon)'), ('[data-size=icon]', '.icon:not(.small)'), ('[data-size=icon-sm]', '.icon.small'),
        ('[data-size=xs]', None), ('[data-size=lg]', None), ('[data-size=icon-xs]', None), ('[data-size=icon-lg]', None),
        ('[data-icon=', None), (' svg', None),
    ]),
    'badge': ('badge', 'chip', [
        (':not([data-variant])', _CHIP_P), ('[data-variant=primary]', _CHIP_P),
        ('[data-variant=secondary]', _CHIP_S), ('[data-variant=outline]', _CHIP_O), ('[data-variant=destructive]', _CHIP_D),
        ('[data-variant=ghost]', None), ('[data-variant=link]', None),
        ('>svg', None),
    ]),
    # select() and selectButton() (ui.js) are a bare `button.select-btn`, not Basecoat's `.select > button`; their
    # options are `.menu-list > [role=option]` in a dropdown(). Only the trigger and the options: the panel around them
    # is the menu's, with the dropdown family; Basecoat's own markup (groups, headings, an empty list's text from
    # [data-value], the span it puts the text in) and its icons (icon() sizes every icon) are left out. Order matters: each pair rewrites what the
    # ones before it left.
    'select': ('select', 'select', [
        ('.button-group', None), ('select.select', None), ('[data-popover]', None), ('[data-value]', None),
        ('[role=heading]', None), ('[role=group]', None), ('[role=separator]', None), (' svg', None), ('>svg', None),
        ('>button>span', None),  # its text: .select-text lays out its own (a grid with the sizer, a status's dot)
        ('.select:not(select):not([data-select-initialized]) [role=option]', '.menu-list>[role=option]'),
        ('.select:not(select) [role=option]', '.menu-list>[role=option]'),
        ('.select:not(select) [role=listbox]', '.menu-list[role=listbox]'),
        ('.select:not(select)>button', '.select-btn'),
        ('[data-size=sm]', '.small'),
        ('.select:not(select)', None),  # the wrapper itself: there is none
    ]),
    # dropdown() (ui.js) and the popovers made like it (the view bar's, the item picker, mentions) are one panel: a
    # fixed `.menu`, placed by the app, with `.menu-item` rows. Basecoat's `.dropdown-menu > [data-popover]` is that
    # panel, its menuitems the rows that are not a select's options (those are the `select` family's); its wrapper
    # (`.dropdown-menu` itself), placement and open/closed states are left out: the app places and animates the panel.
    # So are its headings, separators and shortcuts (the app's `.menu-label`, `.menu-sep` and `kbd` are used outside a
    # menu too), checkbox/radio items and their indicator, and its svgs. `:not([data-dropdown-menu-initialized])` is
    # the hover of a menu that Basecoat's JS does not drive: every menu here.
    'dropdown': ('dropdown-menu', 'menu', [
        ('.button-group', None), ('.input-group', None), ('[data-rtl-flip]', None), ('[data-indicator]', None),
        (' svg', None), ('[data-inset]', None), ('[role=heading]', None), ('[role=separator]', None),
        ('[data-shortcut]', None), ('kbd', None), ('[role=menu]', None),
        (':is([role=menuitemcheckbox],[role=menuitemradio])', None),
        (':not([data-dropdown-menu-initialized])', ''),
        (':is([role=menuitem],[role=menuitemcheckbox],[role=menuitemradio])', '.menu-item:not(.menu-list>*)'),
        # a destructive row's tint: Basecoat's JS marks the row under the pointer `.active`; here the pointer itself
        # (and as weighty as the plain rows' hover, which would win otherwise)
        (':is(:focus-visible,.active)', ':is(:focus-visible,.active,:hover)'),
        ('[data-variant=destructive]', '.menu-item.danger:not(.menu-list>*):not([aria-disabled=true]):not(:disabled)'),
        ('.dropdown-menu>[data-popover]', '.menu'),
        ('.dropdown-menu ', '.menu '),
        ('.dropdown-menu', None),  # the wrapper (inline-flex, relative): the app's panel has none
    ]),
    # tabPanels() (ui.js) and the sections' tabs (sections.js, runs.js, tags.js): a `.tabs-bar` row of `.tab-btn`s,
    # buttons with aria-selected or links with aria-current. Basecoat's `line` variant, its tabs only: the bar keeps
    # the app's layout (full width, the line under it, sideways scroll), the picked tab its 2px border on that line
    # (Basecoat's :after is the same line, placed for its own bar), and keyboard focus the app's fill (a ring would be
    # cut by a bar that scrolls). Its wrapper, the bar's own rules, the pill variant, vertical tabs, the panel (its
    # text size would reach every tab's content) and the svgs are left out. Order matters: the drops first, then the
    # variant's attributes, then the tab.
    'tabs': ('tabs', 'tabs-bar', [
        ('.tabs:has', None), ('[aria-orientation=vertical]', None), ('>[role=tabpanel]', None),
        (':not([data-variant=line])', None), (' svg', None), ('>svg', None), (':after', None), (':focus-visible', None),
        ('[aria-orientation=horizontal]', ''), ('[data-variant=line]', ''),
        ('.tabs>[role=tablist]>[role=tab]', '.tab-btn'),
        ('[aria-selected=true]', ':is([aria-selected=true],[aria-current=page])'),
        ('.tabs', None),  # what is left: the wrapper and the bar's own rules
    ]),
    # The app's modals (#modal, #item-modal: a div the app places, opens and traps focus in, on its own backdrop): the
    # look of Basecoat's dialog panel (radius-xl, a 1px ring of the foreground at 10% instead of a shadow, text-sm,
    # the popover's colours) and of its backdrop (the blur; its tint is Modern's --overlay). Basecoat's native
    # <dialog>, its placement (fixed, centred, 95% scale), open/closed states, scroll lock, header, footer and close
    # button are left out: the app's modals lay out their own heads and feet. Order matters: the drops first.
    'dialog': ('dialog', 'dialog', [
        (':is(.dialog,.alert-dialog)', None), ('>*>', None),
        ('.dialog>*', ':is(#modal,#item-modal)'),
        ('.dialog::backdrop', ':is(#modal-backdrop,#item-backdrop,#side-backdrop,.palette-backdrop)'),
        ('.dialog', None),
    ]),
    # toast() (state.js): one #toast at the window's bottom right, its text and an optional .toast-action (Undo). The
    # look of Basecoat's .toast-content (radius-2xl, a soft shadow, 13px text, its padding and gap, no overflow) and of
    # its action button (24px high, extra-small text). Basecoat's .toaster (a stack placed at the bottom), its .toast
    # wrapper (grid, slide-up animation, collapsing when hidden), title, description and the svgs are left out: the app
    # places one toast and replaces it. Order matters: the drops first, then the action, then the toast.
    'toast': ('toast-content', 'toast-content', [
        (' svg', None), (' section', None), ('[aria-hidden=true]', None),
        ('.toaster .toast .toast-content footer [data-toast-action]', '#toast .toast-action'),
        ('.toaster .toast .toast-content footer [data-toast-cancel]', '#toast .toast-action'),
        (' footer', None),
        ('.toaster .toast .toast-content', '#toast'),
        ('.toast-content', '#toast'),
    ]),
    # Every <input type=checkbox> (the list's row picks, the Filter menu, Settings, schedules, a description's task
    # list…), not Basecoat's `.input` / `.field > input`: its square (16px, radius 4px, the input border; filled with the
    # primary and a check mask when checked). And the app's switch, `button.vb-switch[role=switch]` with a span for its
    # knob (viewbar.js, views/graph.js), not Basecoat's checkbox with role=switch and a ::before: its track (a pill,
    # 32×18.4, the input colour, the primary when on) and knob (16px, the background; moved by `translate` when
    # aria-checked is true). Their small size, the right-to-left knob, aria-invalid (no checkbox here is ever invalid),
    # data-disabled and the `.field > label` cards around them are left out. Order matters: the drops first, then the
    # switch (whose :checked are its aria-checked), then the checkbox.
    'checkbox': ('input[type=checkbox]', 'input[type=checkbox]', [
        (':not([data-size=sm])', ''),  # the default size: before the small one's drop, which it contains
        ('[data-size=sm]', None), (':dir(rtl)', None), ('[aria-invalid=true]', None), ('[data-disabled=true]', None),
        ('.field>input[type=checkbox]:not([role=switch]),', ''), ('.field>input[type=checkbox][role=switch],', ''),
        (':is(.input[type=checkbox][role=switch])', '.vb-switch'), ('.input[type=checkbox][role=switch]', '.vb-switch'),
        (':is(html.dark *):not(*:checked)', '[aria-checked=false]:is(html.dark *)'),
        ('.vb-switch:not(*:checked)', '.vb-switch[aria-checked=false]'),
        ('.vb-switch:not(:checked)', '.vb-switch[aria-checked=false]'),
        ('.vb-switch:checked', '.vb-switch[aria-checked=true]'),
        (':before', '>span'),
        (':is(.input[type=checkbox]:not([role=switch]))', 'input[type=checkbox]'),
        ('.input[type=checkbox]:not([role=switch])', 'input[type=checkbox]'),
    ]),
    # emptyState() (ui.js) and the other `.empty` boxes: one line of text, not Basecoat's header / figure / title /
    # description / footer. The look of Basecoat's Empty itself: centred in a column, balanced lines, radius-xl, its
    # padding and a dashed border (whose width and colour app.css gives it: Basecoat's has none). A table's empty cell
    # (`td.empty`) keeps the app's look: a cell cannot be a flex box. Order matters: the drops first.
    'empty': ('empty', 'empty:not(td)', [
        (' figure', None), ('>header', None), ('>:is(section,footer)', None), (' :is(h2,h3,h4)', None),
    ]),
    # Basecoat's skeleton (muted, rounded, pulsing): ready for a placeholder while something loads. Nothing in the app
    # shows one yet (it writes "Loading…").
    'skeleton': ('skeleton', 'skeleton', []),
}

# What Basecoat's components take from the preflight it is built on: none of a <button>'s own margin, padding (1px 6px),
# grey background (its ghost variant would show it) or system font. Here, under the components, and not in app.css,
# whose `button { font: inherit }` would beat their sizes and weights (main.css: the app's layer wins).
BASE = ':where(.btn,.chip,.select-btn,.menu-item,.tab-btn,.vb-switch){margin:0;padding:0;background-color:transparent;font:inherit;color:inherit}'


def parse(css):
    """The stylesheet as a list of nodes: ('stmt', text) | ('rule', selector, body) | ('at', prelude, [nodes])."""
    nodes, i = [], 0
    while i < len(css):
        brace, semi = css.find('{', i), css.find(';', i)
        if brace < 0 or (0 <= semi < brace and css[i:semi].lstrip().startswith('@')):
            if semi < 0:
                break
            nodes.append(('stmt', css[i:semi].strip()))
            i = semi + 1
            continue
        head = css[i:brace].strip()
        depth, j = 1, brace + 1
        while depth:
            depth += {'{': 1, '}': -1}.get(css[j], 0)
            j += 1
        body = css[brace + 1:j - 1]
        if head.startswith('@') and not head.startswith(('@keyframes', '@property', '@font-face')):
            nodes.append(('at', head, parse(body)))
        else:
            nodes.append(('rule', head, body))
        i = j
    return nodes


def split_top(selector):
    """A selector list split on its top-level commas (not the ones inside :is() / :not())."""
    parts, depth, cur = [], 0, ''
    for ch in selector:
        depth += {'(': 1, ')': -1}.get(ch, 0)
        if ch == ',' and not depth:
            parts.append(cur)
            cur = ''
        else:
            cur += ch
    return parts + [cur]


def rewrite(selector):
    """The selector for the app, or None when no part of it is a family the app has adopted (or every part of it is a
    variant or size the app has no class for)."""
    out = []
    for part in split_top(selector):
        for basecoat, app, table in FAMILIES.values():
            if not re.search(rf'\.{re.escape(basecoat)}(?![\w-])', part):
                continue
            for attr, mapped in table:
                if attr in part:
                    if mapped is None:
                        part = None
                        break
                    part = part.replace(attr, mapped)
            if part is not None:
                part = re.sub(rf'\.{re.escape(basecoat)}(?![\w-])', f'.{app}', part)
                if part not in out:
                    out.append(part)
            break
    return ','.join(out) or None


def components(nodes):
    """Of a components layer, the adopted families' rules, rewritten (inside @media / @supports too)."""
    kept = []
    for node in nodes:
        if node[0] == 'rule':
            selector = rewrite(node[1])
            if selector:
                kept.append(('rule', selector, node[2].replace('!important', '')))
        elif node[0] == 'at':
            inner = components(node[2])
            if inner:
                kept.append(('at', node[1], inner))
    return kept


def derive(nodes):
    out = []
    for node in nodes:
        if node[0] == 'at' and node[1] == '@layer base':
            continue
        if node[0] == 'at' and node[1] == '@layer components':
            inner = components(node[2])
            if inner:
                out.append(('at', node[1], inner))
            continue
        out.append(node)
    # the preflight's slice, in the base layer: under the components whatever the specificity
    first = next(i for i, n in enumerate(out) if n[0] == 'at' and n[1] == '@layer components')
    out.insert(first, ('at', '@layer base', [('rule', *BASE[:-1].split('{', 1))]))
    return out


def serialize(nodes):
    parts = []
    for node in nodes:
        if node[0] == 'stmt':
            parts.append(node[1] + ';')
        elif node[0] == 'rule':
            parts.append(f'{node[1]}{{{node[2]}}}')
        else:
            parts.append(f'{node[1]}{{{serialize(node[2])}}}')
    return ''.join(parts)


HEADER = ('/* Generated by tools/basecoat_css.py from basecoat-nova.cdn.min.css: no preflight, only the families the app '
          'has adopted (%s), their variants on the app\'s classes. Do not edit: rerun the script. */\n')


def build():
    css = SRC.read_text(encoding='utf-8')
    licence = re.match(r'\s*(/\*![\s\S]*?\*/)', css)
    body = re.sub(r'/\*[\s\S]*?\*/', '', css)
    text = HEADER % ', '.join(FAMILIES) + (licence.group(1) if licence else '') + serialize(derive(parse(body)))
    return text + '\n'


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--check', action='store_true', help='exit 1 if the file is not what this script writes')
    args = ap.parse_args(argv)
    text = build()
    if args.check:
        current = OUT.read_text(encoding='utf-8') if OUT.exists() else ''
        if current != text:
            print(f'{OUT.relative_to(ROOT)} is stale: run python3 tools/basecoat_css.py', file=sys.stderr)
            return 1
        print(f'{OUT.relative_to(ROOT)}: up to date')
        return 0
    OUT.write_text(text, encoding='utf-8')
    print(f'wrote {OUT.relative_to(ROOT)} ({len(text):,} bytes, from {len(SRC.read_text(encoding="utf-8")):,})')
    return 0


if __name__ == '__main__':
    sys.exit(main())
