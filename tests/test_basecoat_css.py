"""tools/basecoat_css.py: the Basecoat stylesheet the page loads is the one the script writes, with no preflight, only
the adopted families, and their variants on the app's classes."""
import re
import unittest

from tools import basecoat_css as bc


class DerivedBasecoatTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.css = bc.OUT.read_text(encoding='utf-8')

    def test_the_file_is_what_the_script_writes(self):
        self.assertEqual(self.css, bc.build(), 'run python3 tools/basecoat_css.py')

    def test_main_css_loads_it(self):
        main = (bc.ROOT / 'static/css/main.css').read_text(encoding='utf-8')
        self.assertIn('@import url("../vendor/basecoat/basecoat-nova.app.css") layer(vendor);', main)
        self.assertNotIn('basecoat-nova.cdn.min.css', main)

    def test_no_preflight_and_no_important(self):
        base = re.findall(r'@layer base\{(.*?)\}\}', self.css)
        self.assertEqual(base, [bc.BASE[:-1]], 'the only base rule is the slice the components assume')
        self.assertNotIn('!important', self.css)
        self.assertNotRegex(self.css, r'(^|[},])\*,:after,:before', "Tailwind's * reset")

    def test_only_the_adopted_families(self):
        layers = re.findall(r'@layer components\{', self.css)
        self.assertTrue(layers)
        components = self.css[self.css.index('@layer components{'):]
        # Basecoat's other families, whose class names are the app's too (or would style its markup)
        for cls in ('card', 'field', 'dialog', 'select', 'tabs', 'toast', 'input', 'popover', 'badge', 'button-group',
                    'dropdown-menu', 'input-group', 'combobox'):
            self.assertNotRegex(components, rf'\.{cls}(?![\w-])', cls)

    def test_variants_are_on_the_apps_classes(self):
        self.assertNotIn('data-variant', self.css)
        self.assertNotIn('data-size', self.css)
        self.assertNotIn('data-icon', self.css)
        self.assertIn('.btn:is(.primary,.active){', self.css)
        self.assertIn('.btn:not(.primary,.active,.danger,.ghost,.icon){', self.css)
        self.assertIn('.btn.small:not(.icon){', self.css)
        self.assertIn('.chip:is(.on,.plan.today,.plan.week){', self.css)

    def test_icons_keep_their_own_size(self):
        """icon(name, size) sizes an icon; Basecoat's svg rules would make every one in a button 16px."""
        self.assertNotRegex(self.css, r'\.(btn|chip|select-btn|menu-list|menu|menu-item|tab-btn)[^{}]*svg')

    def test_select_is_on_the_apps_markup(self):
        """select() is a bare button.select-btn and its options .menu-list > [role=option]: no `.select` wrapper."""
        self.assertIn('.select-btn{', self.css)
        self.assertIn('.select-btn.small{', self.css)
        self.assertIn('.menu-list>[role=option][aria-selected=true]{', self.css)
        self.assertNotIn('data-popover', self.css, 'the panel is the app\'s .menu (family `dropdown`), placed by the app')
        self.assertNotIn('data-value', self.css, "Basecoat's empty-list text would show on every list")
        self.assertEqual(bc.rewrite('.select:not(select)>button:focus-visible'), '.select-btn:focus-visible')
        self.assertEqual(bc.rewrite('.select:not(select) [role=option].active'), '.menu-list>[role=option].active')
        self.assertIsNone(bc.rewrite('.select:not(select)'), 'the wrapper: there is none')
        self.assertIsNone(bc.rewrite('.select:not(select) [role=group]'))

    def test_dropdown_is_the_apps_menu(self):
        """dropdown()'s panel is a fixed .menu the app places: Basecoat's look on it and on its rows, not its wrapper,
        placement or open/closed states; a select's options stay the select family's."""
        self.assertEqual(bc.rewrite('.dropdown-menu>[data-popover]'), '.menu')
        self.assertIsNone(bc.rewrite('.dropdown-menu'), 'the wrapper: inline-flex would lay the rows in a line')
        self.assertEqual(bc.rewrite('.dropdown-menu :is([role=menuitem],[role=menuitemcheckbox],[role=menuitemradio]):focus-visible'),
                         '.menu .menu-item:not(.menu-list>*):focus-visible')
        self.assertEqual(
            bc.rewrite('.dropdown-menu:not([data-dropdown-menu-initialized]) :is([role=menuitem],[role=menuitemcheckbox],[role=menuitemradio]):hover'),
            '.menu .menu-item:not(.menu-list>*):hover', 'the hover of a menu no Basecoat JS drives: every one here')
        self.assertEqual(bc.rewrite('.dropdown-menu [data-variant=destructive]:is(:focus-visible,.active)'),
                         '.menu .menu-item.danger:not(.menu-list>*):not([aria-disabled=true]):not(:disabled)'
                         ':is(:focus-visible,.active,:hover)')
        for left in ('.dropdown-menu [role=separator]', '.dropdown-menu [role=heading]', '.dropdown-menu [data-indicator]',
                     '.dropdown-menu :is([data-shortcut],kbd:last-child,.kbd:last-child)', '.dropdown-menu [role=menu]'):
            self.assertIsNone(bc.rewrite(left), left)
        self.assertIn('.menu{gap:0;overflow-x:hidden;', self.css)
        self.assertNotRegex(self.css, r'\.menu\{[^}]*display:inline-flex')

    def test_tabs_are_the_apps_line_tabs(self):
        """tabPanels()' and the sections' tabs are `.tab-btn`s in a `.tabs-bar`: Basecoat's `line` tabs on the tab
        only, picked by aria-selected or aria-current; not its bar, wrapper, pill variant, panel or :after line."""
        self.assertEqual(bc.rewrite('.tabs>[role=tablist]>[role=tab]'), '.tab-btn')
        self.assertEqual(bc.rewrite('.tabs>[role=tablist][data-variant=line]>[role=tab][aria-selected=true]'),
                         '.tab-btn:is([aria-selected=true],[aria-current=page])')
        for left in ('.tabs', '.tabs>[role=tablist]', '.tabs>[role=tablist][data-variant=line]', '.tabs>[role=tabpanel]',
                     '.tabs>[role=tablist]:not([data-variant=line])>[role=tab][aria-selected=true]',
                     '.tabs>[role=tablist]>[role=tab]:focus-visible', '.tabs>[role=tablist]>[role=tab]:after',
                     '.tabs>[role=tablist][aria-orientation=vertical]>[role=tab]',
                     '.tabs:has(>[role=tablist][aria-orientation=vertical])'):
            self.assertIsNone(bc.rewrite(left), left)
        self.assertNotIn('role=tab', self.css)
        self.assertNotIn('tabs-bar', self.css, "the bar is the app's: full width, its line, sideways scroll")

    def test_dialog_is_the_apps_modal(self):
        """#modal and #item-modal take the look of Basecoat's dialog panel and their backdrops its blur; its native
        <dialog>, placement, states, scroll lock, header, footer and close button are left out."""
        self.assertEqual(bc.rewrite('.dialog>*'), ':is(#modal,#item-modal)')
        self.assertEqual(bc.rewrite('.dialog::backdrop,.alert-dialog::backdrop,.command-dialog::backdrop'),
                         ':is(#modal-backdrop,#item-backdrop,#side-backdrop,.palette-backdrop)')
        for left in (':is(.dialog,.alert-dialog)>*', ':is(.dialog,.alert-dialog):is([open],:popover-open)',
                     'html:has(:is(.dialog,.alert-dialog,.command-dialog,.drawer):modal)', '.dialog>*>header',
                     '.dialog>*>footer', '.dialog>*>:is(button,form[method=dialog])', '.dialog>*>header>h2,.dialog>*>[data-title]',
                     '.dialog'):
            self.assertIsNone(bc.rewrite(left), left)
        self.assertNotIn('position:fixed;top:50%', self.css)
        self.assertNotIn(':modal', self.css)

    def test_toast_is_the_apps_toast(self):
        """The one #toast takes the look of Basecoat's .toast-content and its Undo the action button's size; the
        .toaster stack, its placement, the .toast wrapper and its animation are left out."""
        self.assertEqual(bc.rewrite('.toast-content'), '#toast')
        self.assertEqual(bc.rewrite('.toaster .toast .toast-content'), '#toast')
        self.assertEqual(bc.rewrite('.toaster .toast .toast-content footer [data-toast-action],'
                                    '.toaster .toast .toast-content footer [data-toast-cancel]'), '#toast .toast-action')
        for left in ('.toaster', '.toaster .toast', '.toaster .toast .toast-content footer',
                     '.toaster .toast .toast-content svg', '.toaster .toast .toast-content section h2',
                     '.toaster .toast[aria-hidden=true] .toast-content'):
            self.assertIsNone(bc.rewrite(left), left)
        self.assertNotIn('toaster', self.css.split('@layer components{', 1)[1])

    def test_checkbox_and_switch_are_the_apps(self):
        """Every input[type=checkbox] takes Basecoat's checkbox (not only its `.input` / `.field > input`), and the
        app's switch, a button with aria-checked and a span, Basecoat's switch: its :checked onto aria-checked, its
        ::before onto the span; the small size, right-to-left, aria-invalid and the `.field > label` cards are left out."""
        cb = ':is(.field>input[type=checkbox]:not([role=switch]),.input[type=checkbox]:not([role=switch]))'
        sw = ':is(.field>input[type=checkbox][role=switch],.input[type=checkbox][role=switch])'
        self.assertEqual(bc.rewrite('.field>input[type=checkbox]:not([role=switch]),.input[type=checkbox]:not([role=switch])'),
                         'input[type=checkbox]')
        self.assertEqual(bc.rewrite(f'{cb}:checked:after'), 'input[type=checkbox]:checked:after')
        self.assertEqual(bc.rewrite(f'{cb}:is(html.dark *):checked'), 'input[type=checkbox]:is(html.dark *):checked')
        self.assertEqual(bc.rewrite('.field>input[type=checkbox][role=switch],.input[type=checkbox][role=switch]'), '.vb-switch')
        self.assertEqual(bc.rewrite(f'{sw}:not([data-size=sm])'), '.vb-switch')
        self.assertEqual(bc.rewrite(f'{sw}:not(*:checked)'), '.vb-switch[aria-checked=false]')
        self.assertEqual(bc.rewrite(f'{sw}:is(html.dark *):not(*:checked)'), '.vb-switch[aria-checked=false]:is(html.dark *)')
        self.assertEqual(bc.rewrite(f'{sw}:checked:not([data-size=sm]):before'), '.vb-switch[aria-checked=true]>span')
        self.assertEqual(bc.rewrite(f'html.dark {sw}:not(:checked):before'), 'html.dark .vb-switch[aria-checked=false]>span')
        for left in (f'{sw}[data-size=sm]', f'{sw}:dir(rtl):checked:not([data-size=sm]):before', f'{cb}[aria-invalid=true]',
                     f':where(*[data-disabled=true]) {cb}', '.field>label:has(input[type=checkbox])'):
            self.assertIsNone(bc.rewrite(left), left)
        components = self.css.split('@layer components{', 1)[1]
        self.assertNotIn(':checked', ''.join(re.findall(r'\.vb-switch[^{]*', components)))
        self.assertNotIn(':before', ''.join(re.findall(r'\.vb-switch[^{]*', components)))

    def test_empty_and_skeleton(self):
        """An empty state takes Basecoat's Empty box, not its header / figure / title / footer (the app's is one line of
        text), and never a table's empty cell; the skeleton comes as it is."""
        self.assertEqual(bc.rewrite('.empty'), '.empty:not(td)')
        for left in ('.empty>header', '.empty figure', '.empty figure:has(>svg:only-child) svg:not([class*=size-])',
                     '.empty :is(h2,h3,h4)', '.empty>:is(section,footer)', '.empty>header>p>a:hover'):
            self.assertIsNone(bc.rewrite(left), left)
        self.assertEqual(bc.rewrite('.skeleton'), '.skeleton')
        components = self.css.split('@layer components{', 1)[1]
        self.assertNotRegex(components, r'\.empty(?!:not\(td\))')
        self.assertIn('.empty:not(td){gap:', components)

    def test_rewrite(self):
        self.assertEqual(bc.rewrite('.btn[data-variant=ghost]:hover'), '.btn:is(.ghost,.icon):not(.primary,.active,.danger):hover')
        self.assertIsNone(bc.rewrite('.btn[data-size=lg]'), 'a size the app has no class for is left out')
        self.assertIsNone(bc.rewrite('.card'), 'a family the app has not adopted')
        self.assertEqual(bc.rewrite('.btn:not([data-variant]),.btn[data-variant=primary]'), '.btn:is(.primary,.active)')
        self.assertEqual(bc.split_top(':is(.a,.b):hover,.c'), [':is(.a,.b):hover', '.c'])


if __name__ == '__main__':
    unittest.main()
