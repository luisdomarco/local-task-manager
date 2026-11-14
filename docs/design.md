# Design guide — how the app looks, and how to keep it that way

The rules every screen follows. Read this before changing anything a user sees; reuse what is named here before
writing a new class or helper. The tokens (colours, sizes, radii) live at the top of `static/css/app.css` for Classic and in
`static/css/themes/modern.css` for Modern, each in light and dark; this file is the decisions on top of them (§2).

The idea in one line: **a page to read, not a form to fill in.** Few frames, colour only where it means something, the
same pattern for the same thing everywhere.

## 1. Principles

1. **Monochrome first.** Zinc greys (shadcn/ui). Colour is for meaning only: a status's dot, an item type's icon, a
   label's tint, overdue/late (`--destructive`). Never colour a whole row, header or column for decoration.
2. **No frame until it is needed.** Values on a card or a page are text; their control shows its border on hover or
   focus (`.quiet`). The create form is a card half filled in: the same quiet rows. The app's Settings, a form you go
   to in order to fill it in, keeps its fields in a soft grey frame (`--border`). Only the title and the description,
   where you write, keep theirs everywhere.
3. **Rows, not boxes.** Lists of things, tables too, are rows between thin lines; a box around each one is only for
   things you drag (board cards).
4. **Say what is empty, in one quiet word.** An empty property reads *Empty* (`quietBlanks`); an empty kind of child waits
   on one **+ Add …** line (`shownKinds`), not as a wall of blank headers.
5. **One pattern per thing.** A status always looks the same (dot + words); a property always sits in a row with its
   name on the left; an empty place always says so in one line.
6. **No dashboards inside items.** No progress bars or score cards on initiative pages; a sentence says how things go
   (Today's day line, `dayline.js`).
7. **An app's cursor.** The arrow everywhere (`body { cursor: default }`), the hand on what is clicked (`.btn`, rows,
   links), the I-beam only in a field, a textarea or an editor — never over a label or a heading, where it flickered as
   the mouse crossed the words.
8. **Every width, both themes.** 375 / 820 / 1000 / 1303 px, light and dark, no horizontal scroll of the page.

## 2. Tokens and themes

The app has two themes (Settings → Themes, README §7 *Themes*): **Modern**, the default,
Basecoat's (shadcn's Nova style) with options of its own, and **Classic**, the look it first had (`themeprefs.js` `SKINS`, the
first the default; index.html's first script says the same). Both draw the same components from the same
tokens. A theme is the tokens' values, in its own file, `static/css/themes/<id>.css`, under `:root[data-skin="<id>"]`.
The theme, the mode and Modern's options are kept in the browser (`tm-skin`, `tm-theme`, `tm-<option>` in
localStorage) and set on the root by `index.html`'s first script before the first paint, so a reload never flickers.
`theme.js` changes them live. A test (`tests/js/themeprefs.test.mjs`) runs that script against `themeprefs.js`.

### The tokens

| What | Tokens | Classic | Modern | Rule |
|---|---|---|---|---|
| Surfaces | `--background`, `--card`, `--popover`, `--well`, `--muted`, `--accent` (hover), `--row-hover` (a hovered row or ×: `--accent` today, one place to change it), `--sidebar` | zinc greys | Radix greys (`--base-1…12`, from `data-base`) | `--muted` mixed to ~45–70 % for soft tints (a hovered row, an empty state). |
| Text | `--foreground`, `--muted-foreground` | | | Secondary text, labels, metadata: `--muted-foreground`. Never lighter. |
| Lines | `--border` (dividers, boxes), `--input` (field outlines, ≥ 3:1) | | | A divider between rows: `1px solid var(--border)`. |
| Accent and focus | `--primary`, `--ring`, `--focus` (2px ring on buttons and links), `--field-ring` + `--field-halo` (fields), `--brand-*` | the ink (near-black, near-white in dark) | the accent (`--brand-fill`, from `data-accent`) | Never remove a focus style without replacing it. |
| Meaning | `--destructive`; `--st-*-bg/-fg` and `--st-dot` per status; `--pr-icon-1/2/3`, `--pr-1-bg`; `--t-<type>`; `--graph-*` | | Radix steps 3/11/9/6 | Status and priority colours come from `statusCss()` / `.s-*` / `.pr-*`, never hard-coded. |
| Type | `--fs-3xs` · `--fs-caption` · `--fs-2xs` · `--fs-xs` · `--fs-sm` · `--fs-base` · `--fs-h4` · `--fs-lg` · `--fs-h3` · `--fs-title`; Markdown's `--fs-doc-h1/h2/h3` | 11 · 11.5 · 12 · 12.5 · 13 · **13.5** · 14 · 15 · 17 · 22; 19/16/14.5 | 12 at least, **14** the body, 16 · 16 · 18 · 24; 22/18/16 (compact: 13 the body, the rest Classic's but 12 at least) | No other font sizes, but three a glyph fits a box by (a badge's count 9.5, a week number 10, an agent's status 10.5). A phone sets the scale again (16 the body; *The phone layer*), and `--fs-field` (16) is a field's size on any touch screen, under which iOS zooms into it. Weights: 400, 500 (labels), 600 (headings). |
| Size | `--control-h`, `--control-h-sm`, `--row-h`, `--spacing` | 32 · 28 · 48 · not set | 36 · 30 · 40 · 4.5 (compact 28 · 24 · 32 · 3.5) | Controls ≥ `--control-h` (`-sm` for `.small` in dense rows). Modern measures in steps of `--spacing`, as Basecoat does. |
| Panels | `--side-w`: every right panel (an item's card, a page's, an agent's) | `clamp(360px, 32vw, 500px)` | | One width for every right panel. |
| Radii | `--radius` 8 · `--radius-sm` 6 · `--radius-xs` 4 · `--radius-full` 999 | | `data-radius` changes them | A card: `--radius` + 4px. A radius that is half a box's height stays a number. |
| Shadows | `--shadow-sm`, `--shadow-card`, `--shadow-lg` (and Modern's `--shadow-md`) | | its own, deeper in dark | A board card's ring is `--shadow-card` (a theme sets the token, never `box-shadow`, so app.css's hover ring and drop marker still add to it). |
| Layers | `--z-sticky` 15 · `--z-card` 20 · `--z-dock` 22 · `--z-drawer-backdrop` 24 · `--z-drawer` 25 · `--z-modal` / `--z-bulk` 30 · `--z-popover` / `--z-fullscreen` 40 · `--z-palette` 45 · `--z-skip` 50 · `--z-toast` 60 | | | A component's own stacking (1–5) stays a number in its rule. |

**Contrast**: text ≥ 4.5:1; control borders, focus and a type's icon ≥ 3:1. `tests/js/contrast.test.mjs` reads the
token files and checks every theme, mode, accent, base and canvas (a pair under the floor that was always there is
listed in it by name, so a new one fails).

**Dark** is one block per theme. `theme.js` and `index.html`'s first script always set `data-theme` to `light` or
`dark` (System resolved, and followed when the system changes) and the `.dark` class with it, so no
`@media (prefers-color-scheme)` block is needed. A new colour goes in Classic's `:root` **and** its one dark block
(`:root[data-theme="dark"]`, which a dark terminal in the dock shares), and in each theme's file in light and dark.

**A rule reads the token, never the theme.** No `[data-skin]` selector outside a theme's file, with one exception:
Classic's blocks for the Basecoat components (below).

### Cascade layers

`static/css/main.css` names them: `vendor` (third-party CSS the app dresses: Inter, Basecoat) < `app` (app.css, then
the statuses' `<style>`, Excalidraw's and xterm's stylesheets) < `themes` < `phone` (phone.css, *The phone layer*). A later layer wins whatever the
specificity, so a theme's tokens beat Classic's. Third-party CSS loaded at run time goes through
`layeredCss(href, layer)` (`layeredcss.js`), never a bare `<link>`: unlayered CSS would beat every layer. Generated CSS
goes inside `@layer app { … }` (ui.js `statusCss`). `!important` reverses the order: an app-layer `!important` beats
the themes layer, so a forced size that is Classic's alone is scoped to `:where(:root[data-skin="classic"])`.
`modern.css` repeats the layer statement at its top: it can reach the page before main.css, and the first sheet to
name the layers fixes their order.

### The phone layer

A phone is **760px or less and a coarse pointer** (`phone.js` `PHONE_TOUCH`; `isPhone()` in JS). A narrow window on a
computer is not one: it keeps app.css's own ≤760 / ≤640 rules, and `PHONE_POP`'s centred popups, as before.
`static/css/phone.css` is the last layer, so it beats Classic and every theme without `!important` or a
`[data-skin]`, and holds **only two blocks** (`tests/js/phone.test.mjs` fails on a rule outside them):

- `@media (max-width: 760px) and (pointer: coarse)` — the phone's scale and layout.
- `@media (pointer: coarse)` — any touch screen, a tablet too: `--fs-field` (16), what shows on hover shown from the
  start, keyboard hints hidden.

A computer never matches either, so the desktop is unchanged by construction (§5, item 6, checks it).

| Rule | How |
|---|---|
| **Tokens first** | The phone sets the tokens the page already reads: type (`--fs-base` 16, `--fs-sm` 15 … `--fs-title` 24), `--control-h` 44, `--control-h-sm` 44, `--row-h` 52, Basecoat's `--spacing` 5.5px (its buttons, menus and tabs come out at 44). A component with its own number gets a token with the computer's value as fallback (`--icon-btn`, 30 in Classic; `--fs-menu-side`, Classic's side menus) that the phone sets. A token set again lower down (`.list-main`'s `--row-h`, `.im-side.tabbed`'s `--fs-side`) is set there too. |
| **Targets** | `--tap` (44): a menu row, a palette row, a toast's action. A target that cannot grow gets a 44px hit area, not a bigger box. |
| **Safe areas** | `viewport-fit=cover` (index.html), and `env(safe-area-inset-*)` on the top bar, the drawer, the page's foot, Settings' save bar, the toast and the bulk bar. Never `maximum-scale`: fields are 16px, so the page keeps its pinch. |
| **What floats** | On a phone `floating()` puts a real `.float-backdrop` under it: a tap on the dim closes that layer and is swallowed. A centred menu is one scroller, as tall as what the keyboard leaves (`--vvh`, `phone.js` `trackViewport`), and is placed again when the keyboard comes and goes. |
| **The keyboard** | `keyboardShy()` (ui.js: ≤760 or a coarse pointer): a picker focuses its current row, not its search, and `focusFirst` skips text fields. A prompt whose only job is typing keeps its focus. |
| **One tap acts** | iOS withholds the click of a tap whose mousemove changed the page. Hover in a list (the palette, the item picker) reacts to `pointerType === 'mouse'` only; tooltips too. |
| **Hover** | What hover reveals shows from the start on `(pointer: coarse)` — not a quiet field's frame or a row's select's: those stay quiet, as on a computer, read as values, not a form. A hover background that would stick after a tap is in `@media (hover: hover)` in app.css. |
| **The shell** | The drawer, the top bar, the view bar, the date picker, ⌘K, dialogs, Settings and the create form are sized in phone.css (`--control-h-sm` is 44 there). What a phone does differently in JS asks `isPhone()` / `isTouch()`: the drawer's focus and close (sidebar.js), long press on a tree row (treepane.js `longPress`), the Pinned button (pinbar.js), ⌘K's Cancel, `touchSearch()` (ui.js) on a search field, Settings' Keyboard tab. |
| **Collections** | A list's row, an agenda's row (`.plan-row`, a grid of areas *tick · subject · act* over *tick · meta · act*), Labels' and Contacts' rows are two lines: the subject whole on two lines, what it carries under it. A list's row is a list app's, not a card: 60px with a one-line subject, growing with a second, its subject and id one block (no gap between them, the id's line 1.3) centred in it. A box that cannot grow (a list's tick, held at 20px by app.css's `!important`) sits in a 44px `label.pick-hit` that list.js builds only on a phone. A drag has a tap's way too: a board card's ⋯ *Move to…* and a column's ⋯ (boardview.js), Month's day sheet (month.js). A layout that is a screen of columns defaults to its list on a phone (Goals; Today already did). |
| **Item, pages, Docs, graph** | The card is the whole screen (`#item-modal:not(.is-prompt)`, its height `--vvh`); the status pill under the title is as clear of it as of the tabs under the pill (the title's block pulls the tabs up; `.item-tabs` has no top padding there); panel.js on a phone puts the head's resolve, Promote, Escalate and Convert under the title (`.im-title-acts`). On a touch screen a tap on a description's text opens it (no Edit button) and **Done** (`.body-done`) or a tap outside closes it, saving; the outside close listens to pointer events with a 10px slop (mdblock.js `watchOutside`), never `click`, which WebKit does not fire on a tap on what is not clickable, a comment's Return is a newline (panel.js `commentBox`), and a render waits until a focused field is left (`keepFocus`). `.mde` is `overflow: clip` there, so its toolbar can stick. Docs shows its trees or a doc, never both (`.docs-page.no-doc` / `.has-doc`, app.css ≤760, with `.docs-back` *‹ Docs* over the doc), and a file's head puts its title on a line of its own and the modes (stretched) and *Download* (`.files-download`, its icon) in one row under it; graphcanvas.js gives a touch pointer `TOUCH_REACH` and `TOUCH_SLOP`, tap-to-light in place of hover, and *Centre here* while a node is lit. A drag down from the card's head closes it (`phone.js` `swipeDown`, `swipeCloses`; the head is `touch-action: none`). Properties keep the computer's two columns; a row of `row-list` is one line, the title at least 70% (`.work-meta`: the status's dot, the priority's bars and word). A comment's actions are one ⋯ (panel.js `commentActions`). A box too small to grow gets an `::after` hit area (`.vb-switch`). |
| **Desktop untouched** | A control only a phone has is **built only when `isPhone()`**, never built and hidden: an extra element changes a computer's DOM (and the §5 gate's hash). `replaceChildren(...)` writes a `null` as the text "null": filter the list first. app.css's ≤640 rules a phone shares are widened with `, (max-width: 760px) and (pointer: coarse)`, which no computer matches. |

### Modern's options

Settings → Themes → Look is a set of options, `OPTIONS` in `static/js/themeprefs.js` (density, accent, base, radius,
sidebar, canvas, font, heading, menu, icons). Each is a `data-<option>` on the root (none in Classic) and a
`tm-<option>` in localStorage; its first value is the default, which has no rule. In `themes/modern.css` the levels
are: Radix scales → `--base-1…12` (the greys, from `data-base`) and `--brand-1…12` (from `data-accent`) → the shadcn
tokens → the app's. So every rule there reads `--base-N`, never `--gray-N`. The accent's filled control is
`--brand-fill`, with `--brand-contrast` on it and `--brand-text` for the accent as text; `--primary`, `--ring`,
`--focus` and `--graph-accent` are `--brand-fill`. Which step fills (9, 10 or 11) and whether white or the ink goes
on it is measured per accent (`plans/design-system.md`, *As built — appearance*). `PRESETS` are lines of options:
what one leaves out is the default.

**To add an option**: its values in `OPTIONS` (and in `index.html`'s first script, which the test runs against the
module), its rules in `modern.css` under `:root[data-skin="modern"][data-<option>="<value>"]`, a row in
`views/themes.js` `ROWS`; if it changes a colour, add it to the loops of `tests/js/contrast.test.mjs`.

**Reading options** (`READING` in `themeprefs.js`: `width`, Fit | Expanded) count in every look, Classic too: a
`data-<key>` on the root in both, set before the first paint by the same script. A rule reads them as
`:root[data-width="wide"] …` or `:root:not([data-width="wide"]) …`, never under `[data-skin]`.

**What reads the theme live**: the graph (`graphcanvas.js`) and the canvas (`canvas/whiteboard.js`) watch the root's
attributes (`THEME_ATTRS`) and redraw on any of them. A terminal in the dock does not: it takes Claude Code's own theme.

### Basecoat's components

A primitive moved to Basecoat (plans/design-system.md, phase 3) is drawn by Basecoat's CSS in **every** theme:
buttons (`.btn`), chips (`.chip`, Basecoat's badge), selects (`select()` and `selectButton()`'s `.select-btn`, and a
`select()`'s options, `.menu-list > [role=option]`), menus (`dropdown()`'s `.menu` and its `.menu-item` rows, the view
bar's and the pickers' panels too), tabs (`tabPanels()`'s and a section's `.tab-btn`), modals (`#modal`,
`#item-modal` and their backdrops), the toast (`#toast`), every checkbox (`input[type=checkbox]`), the switch
(`.vb-switch`), the empty state (`.empty`) and the skeleton (`.skeleton`). The page loads
`vendor/basecoat/basecoat-nova.app.css`, which `tools/basecoat_css.py` writes from Basecoat's own file: no Tailwind
preflight, only the adopted families, their variants on the app's classes (`.btn.primary` / `.active` → primary,
`.danger` → destructive, `.ghost` / `.icon` → ghost, any other → outline; `.small` → small; `.chip.on` → primary…), and
no rule that sizes an icon (`icon(name, size)` does). So:
- a view keeps writing `btn small`, `btn icon`, `chip late`: never `data-variant` or `data-size`;
- a theme's look comes from its tokens (Basecoat reads `--primary`, `--radius`, `--spacing`, `--text-sm`…); Modern
  takes Basecoat's shape as it is;
- **Classic's look is the exception**: its sizes and colours for a family are in `app.css`, under
  `:where(:root[data-skin="classic"])` (no added weight, so a screen's rule still wins where it did), right after
  the family's rules that hold in every theme. One such block per family, and nowhere else;
- an element reset of app.css (`button { font: inherit }`, `.icon`) must not reach a Basecoat component: app.css is
  in a later layer and would beat it whatever its weight (`button:where(:not(.btn, .chip, .select-btn, .menu-item, .tab-btn))`,
  `.icon:where(:not(.btn))`);
- **a select keeps the app's markup**: its chevron is a background (`--chevron`), not Basecoat's svg, and the picked
  option's check is Basecoat's in Modern (a background of `[aria-selected=true]`) and the app's `.opt-check` icon in
  Classic;
- **a menu is the app's panel with Basecoat's look**: `dropdown()` places a fixed `.menu` itself (Basecoat's wrapper,
  placement and open/closed states are left out). Its rows show hover and focus by their background, never the
  page's focus outline; a `.danger` row's is the destructive tint. A rule of app.css on every `.menu-item` sets no
  background: in the later layer it would hide Basecoat's hover. `.menu-label`, `.menu-sep` and `kbd` stay the app's
  (they are used outside menus too);
- **tabs are Basecoat's `line` tabs on the app's bar**: Basecoat gives a tab its type, colour (the foreground at 60%,
  muted in dark), spacing and transition; the `.tabs-bar` (full width, the line under it, sideways scroll with its
  fades), the picked tab's 2px line on the bar's own line and keyboard focus as a soft fill are the app's, in every
  theme (a ring would be cut by a bar that scrolls). A tab is rounded at the top only: a rounded bottom would bend the
  line's ends up;
- **a modal is the app's, dressed as Basecoat's dialog**: `#modal` and `#item-modal` stay divs the app places, opens,
  traps focus in and closes on Esc (Basecoat's native `<dialog>`, its centring, open/closed states, scroll lock,
  header, footer and close button are left out). They take its radius, its 1px ring of the foreground for an edge
  instead of a shadow, its text size and colours; their backdrops (and the palette's and the phone drawer's) its blur,
  with the tint from `--overlay` (Modern's is Basecoat's 10% black). A modal's width is the app's (`max-width: none`
  over Basecoat's 24rem), and nothing on them is animated but `rise` and `fade`;
- **the toast is the app's one `#toast`, dressed as Basecoat's**: `toast()` shows one at a time at the bottom right and
  replaces it (Basecoat's stacking `.toaster`, its slide-up and its title/description layout are left out). It takes
  the look of Basecoat's `.toast-content` (radius-2xl, a soft shadow, 13px text, its padding) and its Undo the action
  button's size; an error's red and the place over the bulk bar stay the app's;
- **a checkbox is any `input[type=checkbox]`, a switch the app's `.vb-switch`**: Basecoat's checkbox (its `.input` /
  `.field > input`) is every checkbox here, so app.css's rules on every `input` skip it (`input:where(:not([type=checkbox]))`)
  and give it to Classic's block. The switch stays a `button` with `role=switch`, `aria-checked` and a span for its
  knob: Basecoat's `:checked` is its `aria-checked`, its `::before` the span. In Modern both are sized in steps of
  `--spacing` (modern.css sizes the switch's track, which Basecoat fixes in px); Classic's block undoes, with
  `revert` in a rule that weighs nothing, what only Basecoat sets (`appearance`, `display`…), so the browser draws
  its own checkbox again. The task's round check in a row (`.check`, `checkbox()` in ui.js) is the app's own;
- **an empty state is one line of text in Basecoat's Empty box**: `emptyState(text)` and the other `.empty` divs take
  its box (centred in a column, balanced lines, radius-xl, 6 steps of padding) and, in every theme but Classic, a
  dashed hairline of `--border` with no fill (Basecoat's own has no border width). Its header, figure, title and
  footer are left out: the markup stays one line. A table's empty cell (`td.empty`) keeps the app's grey cell in
  every theme. Basecoat's `width: 100%` counts with the box's margin: one with a margin sets `width: auto`
  (`.empty.error`). `.skeleton` (muted, rounded, pulsing) is there for a placeholder; nothing shows one yet;
- **the date picker is the app's** (`calendar()` in `datepicker.js`, `.cal`), not Cally's: Cally draws in a shadow DOM
  with Intl's weekday names, so Classic could not stay as it is. Modern gives it shadcn's Calendar in modern.css: a day
  is 8 steps of `--spacing` (a control's height), ‹ › are ghost buttons, today sits on `--brand-subtle`, the picked
  day on `--primary`, the focus ring is Basecoat's (3px of `--ring` at 50 %). Cally stays in `#/lab`;
- a family moved to Basecoat is checked in Classic as **identical**, computed style for computed style, before and
  after (§5).

### Modern's screens

A screen's look in Modern lives in `modern.css`'s "Screens" section (plans/design-system.md, phase 4). Classic never
loads that file, so a rule there needs no Classic mirror. The rules there:
- measures in steps of `--spacing`; what is picked on `--sidebar-active` (the accent's tint) with its icon in
  `--brand`; weights 400 / 500, 600 for a heading;
- a box that holds things is a card: `--radius` + 4px and `--shadow-sm`;
- **never size a list's cells**: a phone's list lays them out in app.css, and the themes layer would win over it.
  Sizes go on the table, in variables, or in `@media (min-width: 641px)`.

| Screen | In Modern |
|---|---|
| Shell | The sidebar's links 7 steps tall, the picked one on the accent's tint with its icon in the accent; group titles 12px medium; ⌘K's rows at the body's size, 8 steps. |
| Lists and tables (`table.grid`) | Rows `--row-h` (40, 32 compact), text at the body's size, the head 8 steps, 13px medium; a picked row on `--picked-bg`. The view bar shortens itself at its own container widths (736 / 576, over app.css's 640 / 560): its controls are larger. |
| Board | A column's corners one step over the controls'; a card outlined in `--border` with `--shadow-sm` (through `--shadow-card`), its subject at the body's size. |
| The item | A card's title 20px (`--fs-title` on `.im-title`), a page's 24, weight 600; the side panel at the body's size; the status picker a badge on `--st-bg` / `--st-fg`. |
| Today and Planning | An agenda row a table's (`--row-h`), its figures tabular; today (its line, its tag, its number in the month) in `--brand`; a goal's progress tag stays grey. |
| Settings | A field's label at the body's size, 500, its help at the body's size; an on/off boolean (a vault's guide and types, Export's scope) is still a checkbox in the markup, drawn as Basecoat's switch by Modern alone. |
| Agents | A run an outlined item (its command in `--foreground`, its line grey with tabular figures, its status a dot and a word); the boxes cards. An item's own Claude panel keeps its `.cs-item` rows. |
| Explorer and Docs | A tree row the sidebar's link (7 steps, the open file on `--sidebar-active`); rendered Markdown (`.md`, wherever it is) as shadcn's typography: headings 600, a quote on a 2px `--border` line, a table ruled under each row; a task list keeps its own indent (`:not(:has(input[type=checkbox]))`). |
| The Live editor | Reads as `.md` does (the same heading sizes, quote, code and link), in the body's font, so writing and reading look alike; the marks it shows on the line you are on are `--muted-foreground`. A [[doc]] is underlined as a link; an item's ref (`STY-482`) too, dotted, in reading and in Live. Its menus (/ [[ @) are a popover with the dropdown's rows (`--accent` on the one picked). CodeMirror's own parts are styled in `livemd.js` `THEME`, not app.css: CodeMirror adds its CSS outside the cascade layers, where it beats any layer. |
| Graph | The settings a card, rows 8 steps, Basecoat's slider (a 1.5-step track on `--muted`, the knob outlined in `--primary`); an item's local graph a card. The drawing reads `--graph-*`. |
| Canvas | The whiteboard a card. Excalidraw's chrome reads the tokens (app.css's `.excalidraw` variables); its menus (☰, More tools) Basecoat's dropdown's rows (1.5 × 2 steps, 16px icons, no gap). |
| The dock and a chat | The sessions the sidebar's links (the open one on `--sidebar-active`); Chat \| Terminal the view bar's segmented control; a chat at the body's size, its composer a card with a field's focus ring. A terminal's pane keeps Claude Code's theme. |

### Tooltips: a `title`, always

Every tooltip of the app is an element's `title` (set in `h()` or at run time, on several lines with `\n` when it
needs them). Classic leaves it to the browser. Modern draws it: `tooltip.js` shows one `.tooltip` for the page
(Basecoat's look: the foreground as background, extra-small text, at most 20rem) on hover or keyboard focus, above
the element or below it at the top of the window, and never cut by an `overflow`. While it shows, the title waits in
`data-tip-title` so the browser's tooltip does not show too. So a view never writes a tooltip element or a
`data-tooltip`; it sets `title`. The graph's `.graph-tip` (several lines that follow the pointer) is the one tooltip
of its own.

## 3. Components and patterns

### Status, priority, type

- **Status** = a coloured dot + its name in words, no frame: `statusChip(status)` for display, `statusSelect(b)` beside a
  title, `select()` with class `status-select` in tables. Names are read with `statusLabel()` (`InProgress` →
  *In progress*, `QA` stays); the files keep their own spelling. Types without a status (note, meeting, activity) show
  none — guard with `hasField(type, 'status')`.
- **Priority** = its icon and its name, both in its colour (`.pr-*` sets `--pr-ink` and `--pr-mask`); every level
  alike, no fill and no frame, Urgent / P0 too.
- **Kind of work** = its swatch (`--k-*`) + its name, no frame (`chip kind k-<kind>`); the name of a Work log group by
  kind.
- **Item type** = its icon in `--t-<type>`; the type chip only in a card's head and crumbs.
- **Item id** = `refOf(item)` (`shownid.js`) wherever an id is shown: the server's `ref`, a short id with its type's
  prefix (`STY-482`), else the id. A table's id column uses `shownId(item)` (the same, but a long Projects id drops its
  project's key, `ACME-INI-001` → `INI-001`, the whole id in its tooltip); a search over ids, `idMatches(item, q)`
  (ref, id and old ids). `item.id` stays the key for links, pins and sorting, never what is drawn.
- **Late / carried over**: `lateBy()` text (*Yesterday*, *18 d late*) in `--destructive`, plus one arrow that plans it
  for now: `carriedAction()`.

### Properties (cards, pages, create form, Settings)

- One per row, name on the left: container `fields prop-rows`, each row **`propRow(label, control, { tag, help,
  wide, cls, attrs })`** (`ui.js`) — a `.field` = `<span>name</span>` + control (112px label column; 84px on a phone;
  180px in Settings). `tag: 'div'` when the control is several controls or a value only read (a `<label>` would send a
  click on the name to its first button); `help` a grey line under the control (Settings' `setRow`). Never a `.field`
  written by hand: nine local helpers and some thirty inline rows went onto it.
- On a card, a page and the create form add `.quiet`: controls frameless until hovered or focused, everywhere (an
  item's tabs too: §Tabs); an empty one says what goes in it, its helper text (the field's `placeholder` in
  `tm/structures`: *feat/<topic>*, *Why it was dropped*), or *Empty* when it has none (`quietBlanks()`, which fills an
  empty `placeholder` too, and the `.select-label:empty::before` rule). A field is never left blank. Blocks of rows split by a line:
  `blocksOf` + `breakBlocks` (`PROP_BLOCKS`: priority · dates · labels; the outside ticket last).
- Section heading over them: small caps grey (*PROPERTIES*), not a bold title.

### Title

The subject is the page's `h1`/title (`textarea.title-input`, wraps, Enter ends it) with the **status pill beside it**
(`.title-status`), its middle level with the middle of the title's first line. A light frame on hover only; while it
is being written, no frame and no ring, just the caret. Crumbs/type chip and id above, small and grey.

### Lists

- **Tables** (`dataTable`, `.grid` in `.table-wrap`): no box, rows between lines on the page's background (`--table-bg`;
  a table inside a card or the side panel takes the card's). What does not fit scrolls sideways with a soft shadow on
  the side there is more. A header's text sits over its column's (`th` pads as a cell; its `.th-btn` reaches 6px out
  for the hover). Header row of `.th-btn`s; status, priority
  and plan cells are `select.small`, frameless until the row is hovered. An unset value is a blank cell (`.blank`) or a
  muted *—*, never *null* or *undefined*.
- **Rows of cards** (Inbox): `h('div', { class: 'cards rows' }, …itemCard())` under a Planning section head
  (*Captured 1*, `planSection`) — no box, a line between, pickers quiet until hover (always framed on touch screens).
- **A page's head and bar** (Labels, Contacts, Trash, Settings): the head a list's, `pageHead({ title,
  count, action })` (ui.js): the title, its grey count on the baseline (`pageCount()`: *3 labels*, *1 item*, *Empty*;
  none where tabs under the title carry the counts, as Contacts' People · Groups), the primary *Add …* at the right.
  Then the view bar's line without its menus — `div.view-bar` with the page's search in `searchBox(input)` (ui.js: the
  260px `--muted` box with a magnifier, the one the view bar draws), then what the page has (Trash's *Empty trash* as a
  red ghost button), never in the head: on a phone the head goes to the top bar and the bar
  slides. Its rows are a list's: `table.grid.fixed` at `fixedColumns` widths, the row's ✎ × as `rowAction`s on hover
  (`tr.hover-host`), its main action (Restore, Confirm, Add) a small ghost button always shown; nothing to show is
  `pageEmpty(text)`, a quiet grey line, no box. Contacts' People · Groups are a section's tab links (`.section-tabs`).
  The Explorer's and Docs' tree filters are the same search box.
- **Work log** is a list over log rows, not items: the whole `viewBar` (Filter, Group, Display) with its own fields,
  groups and columns (`worklogview.js`: `logFields`, `LOG_GROUPS`, `LOG_PROPS`), its date range a button right after
  Filter (`lead`) that opens a popover of presets and two days (`popover`, exported by viewbar.js). Its groups are a
  list's grey band (`tr.group-head` › `.group-line` › `.group-toggle`), the group's entries and time at its right
  (`.wl-group-total`). A column the group already says (Date by day, Kind by kind) is not drawn.
- **Overview's work and records** (Tasks, Notes, Meetings: `workGroups`): the Panel kit's groups and rows, never a second tab bar — a folding name with its count (open ones only, for a kind that closes), *+ Add…* as `aside`, rows with the id muted and, at the right, a task's status and priority as two columns without a table, edited in place with the lists' cells (`COL.status` / `COL.priority` from `datatable.js`, outside the row's link so a pick does not open it; quiet until the row is hovered, as `.grid td`'s), the priority at the right edge (`.work-meta`; on a phone the priority keeps only its bars) or a record's date, the tables' pager (`paged`) in the group's foot. The whole line up to *+ Add* folds it. **Issues** uses the same groups (`workGroups(…, { table: true })`), each unfolding into its kind's `dataTable` with the columns of its list but `ISSUE_LEFT_OUT` (ticket id, progress): id and subject at fixed widths (`ISSUE_TABLE`) so every kind's table lines up with the others, an empty last column (`FILL_COLUMN`) taking what is left, sideways scroll without a bar; quiet (small grey heads, no bold subject), *Show N closed* on its pager's line (`.issue-body`). The quick add (+ Add) shuts on Esc, *Close*, or a click elsewhere while empty.
- **Relations / Docs**: built of the Panel kit (below): `stackGroup`s of `rowList`s, quiet pickers, a secondary button
  to add one more. **Parent** opens Relations, **Goal** right under it (then the other link fields; an empty single
  link is a quiet `select` as Parent's, *Pick a goal…*, never a "— none —"): one group for where the item lives (`project` and `related_to` in the
  file), the chain as rows — its parent and on up, closed by its project (`in`) — the first with ✎ (`itemPicker` over
  `parentChoices`) and its ×. Where its project can change (rules.js `projectFree`: a task, a note…, and a ticket of
  `leaves_project` — initiative, story, spec, support, hotfix, PRD — with a short id) the project row's ✎ is that same
  picker and its × takes it out of every project; a sub-document hanging from no item has ✎ *Move to another project*.
  **Both are always there**: one that cannot act — the × of what must hang from an item (`needs_parent`: a plan), the ✎
  and × of a ticket's project with a long id, the × of a sub-document's project, a ✎ with nothing else to pick — is
  drawn faint (`.row-action.is-off`, panel.js `off`) and a click says why in the toast (*Its id (ACME-INI-001) carries
  its project: it moves once its vault has short ids…*); while it hangs from no item, a picker offering only what may be
  its parent (rules.js `parentChoices`: projects for a type whose project can change, never for a `needs_parent` one). **A link is shown once**: set, it is a row — its name opens it, ✎ and
  × on hover —, never a filled picker beside its row; an empty picker names what it picks in grey (*Pick a parent…*); the row
  that adds a relation has a
  primary *Add*, faded until an item is picked (`btn small primary`).
- **Activity / AI Agents**: lists without frames but for what someone wrote or started. Activity under the name of each
  day (`.activity-day`), a comment a `surface-card` (`.activity-card`), an event a grey line with a dot; a session a
  `surface-card` too (`.cs-item`, title over a short meta with `agoLabel`, its ↗ ⋯ over its corner, `hover-reveal`).
- **The view bar** (`viewbar.js` on `viewmodel.js`, the same on every list, board and section tab): `[Search] [Filter]
  … [Order: X ▾] [Group: X ▾] [Display] [List | Board]`. Search is a 260px `--muted` box with no border. **Filter** is a
  two-level popover — the fields the structure gives the page (`filterFields`), then the values, each with a 14px box,
  its status dot, its name and its count (`valueCounts`, grey at 0), and *is / is not*. What is applied shows as chips
  under the bar — 26px pills with a hairline border on the page's background, "Project is" grey and the values
  dark ("Project is **Acme Web** ×" … *Clear* · *Save as view*) — which take no room when there are none. **Group** offers the
  type's `group_by` plus Label (an item sits in each of its labels' groups), *Order in groups* and *Show empty groups*.
  **Display**: Show closed (None / Last week / All), the columns to show (on a board, **Show on cards**: priority, ID,
  planned, due, labels, parent, project, ticket — `cardProps` / `cardShows`), on a board *Empty columns* (Show / Fold
  / Hide), and a foot with *Reset to default* left and **Save as view** right. Pills that turn a thing on or off
  (`.vb-pill`) are dark while on (`--foreground`), outlined while off. **Save as view** asks a name and keeps the
  page's view, its order and (on the Board) its type under it (`savedviews.js`); the views are listed in the sidebar's
  **Views**, under Favourites, lit while the page still shows them, each with a × (Undo) on hover. Everything is saved per list and vault (`list.<type>`, v2; `migrateView` reads a view
  saved before). Narrow bars drop words before they overflow (container queries on `.view-bar`).
- **Rows** (`.list-main`): 40px, a line between, `--muted` on hover; the id mono and grey, the subject takes the rest
  and is cut with "…", status a dot + name, initiative / project as grey text with the type's icon, Planned in red when
  late. Status, Priority and Planned are edited in place (selects framed only on hover, capped at their cell: a longer
  label is cut with "…", never over the next column); on a phone Planned reads as text. The columns shared by every list keep one width and one order (`LIST_WIDTHS`, `COLUMN_RANK`); what does not
  fit gives way, Due first and Type last (`hiddenColumns`) — the page never scrolls sideways. A group's head is a 34px
  `--well` row: fold arrow, dot or icon, name, count and a "+" on hover that adds an item with that value.
- **Under a list's table**: its pager always (`paged({ always: true })` for every main list — `LIST_PAGE` —, even on one page; an item's tables only from a second page), then one quiet line of how the closed rows go and the way back: *4 closed are hidden · Show closed*, or *4 closed shown · Hide closed* (`.vb-hidden`, a `link-btn`).
- **Selection**: a row's 14px box shows on hover (always on a touch screen); once one is ticked, every row shows it and
  the header gets *select all*. The `.bulk-bar` floats dark at the bottom centre: *N selected* · Status · Priority · Plan
  · Labels · Project (only where every ticked type can change it: `movesProject`) · trash · ×.
- **Board** (`boardview.js`; any list with a Group): columns of `--muted`, radius 10, as wide as `--board-col-w` (272px;
  every board's column, Planning's too: change it there and only there), the head's dot, name and the count right by
  it, then (at the right) the fold button on hover and the ⋯; the window's height with each column scrolling on its own and the sideways scroll at the bottom. A closed or
  empty column folds into a 40px strip read top to bottom; a click unfolds it. "+ Add a card" shows on hover. A card
  (`itemCard(…, { variant: 'board' })`): its 14px done box, a title of 2 lines at most, a grey line with where it
  belongs, then priority (its bars and its name, `priorityChip`) · planned (what Display → Show on cards leaves on: ID and labels start off, `CARD_OFF`), no
  framed chips. Dropping a card sets the field the board groups by
  (Planned and Label have none); its place in the column is kept with **Order → Manual**, the default (`order`, every
  type has it). Grouped by status, a task's board keeps board.md's lists (name, WIP, ⋯). **Columns move** on every list's
  board: a column's head (and a folded one's strip) drags it (`kanban.js` `dragsList` + `listDropZone`: the list MIME
  type, so a card's drag and a column's never mix; the 4px `.list-marker` shows where it lands) and Shift+←/→ on the
  focused head moves it one place, as a pinned chip does. The order is the view's, per grouping (`view.colOrder`,
  `colorder.js`), never Order's; Group says *Drag a column by its header to move it*, and once one moved, offers
  *Reset column order*. A board of columns that move is `boardOf({ onReorder })` with `movable` columns.
- **On a phone (≤ 640px)**: a row is two lines — dot, subject and when (Planned, else Due, else Date) on the first, the
  id · initiative or project in grey on the second; the top bar takes the list's title and its Add as "+", the pins
  giving way; the view bar and the applied filters slide sideways as 40px chips; the top bar's buttons are 44px.
- **Bulk**: a pick column + `.bulk-bar` with one Undo (`bulk.js`); never confirm dialogs for reversible changes —
  toast with **Undo** (`toast(msg, false, { label: 'Undo', run })`).

### Tabs

`tabPanels(tabs, active, onChange)`: underline style, a `count` badge when the tab holds things (0 included). Each
panel carries `data-tab="<key>"` for styling (a `count` is a string: `String(n)`, or a 0 hides the badge). **An item's
tabs are not remembered**: a card or a page always opens on its first main tab (Overview) and its first side tab
(Properties; Activity on a narrow screen, where Properties sits under the title); the one picked holds while it stays
open, through every save (panel.js `mainTab`/`sideTab`, `pageMainTab`/`pageTab`, reset in `show()` and
`createPageEditor`). A minimized card or Back brings back the tabs it had. On a narrow screen (≤860px) an item's card and page show one pane at a time, picked in a **Detail | Properties | Activity** row (itemform.js `paneSwitch`: a `seg` with `role: 'tablist'`, its thirds sharing the row; `.switched`, and `.show-props` or `.show-side`, on the body), under the card's head or sticky under a page's crumbs (`top: var(--pinbar-h)`); it opens on Detail and holds through every save (panel.js `cardPane`/`pagePane`, reset where the tabs are), and the side panel does not fold there. A new two-column screen passes `pane` to `modalFrame` rather than stacking its columns. Settings remembers its tab. Keyboard focus on a tab is a soft fill (`--accent`, as a menu item's), never the
outside ring: a bar scrolls sideways, so a ring around a tab is cut to two bars.

**A sidebar section's tabs** (`sectionHead(route, title)` in `sections.js`, `.section-tabs`): views that share one
sidebar link — Projects' Meetings · Brief · Issues · Records, a
tab per type. They are **links**, not `tabPanels`: each tab is its view at its own address (`#/week`, `#/prds`), so the
page title is the section's name, the bar sits right under the header (above the toolbar), and the header's *Add*
is the tab's. A tab is icon (14) · name · open count (a 0 shows none; the tab itself is always there: `data-tab-count`, filled by
`setTabCounts` from the sidebar's counts); the current one has `aria-current="page"`. The section's link goes to the
tab last opened (`pref('section.<key>')`). A view in one calls `sectionHead` and puts `head.title` in its `h1` and
`head.tabs` after its header; outside a section (or with one tab left) it returns its own title and no bar.

An item's own tabs (`itemTabs`, card and page alike): **Overview** (its description, its ⧉ ⤢ over the box's top-right
corner, `.body-wrap.in-tab`; then its work and records — Tasks, Notes, Meetings — stacked, `workGroups`) · Settings
(Area and objective first, its fields with no title, then a project's own groups, then a ticket's Delivery groups —
Readiness, Execution… Paused or discarded —: no tab of their own) · Files (attachments) · Links · Docs
(`docsTab`) · **Issues** (every other kind that hangs from it, stacked as Overview's, each its table: `groupTabs`), last, set apart by
a short line (`.tab-btn.apart`, the tab's `apart: true`). A structure with `child_groups` (Projects) gets one such tab per
group instead (Initiatives · Issues · Briefs · Records), the line before the first. **Seven at most** (`foldTabs`,
`tabfold.js`): its own sections always, then the groups while there is room; a group past the seven waits in a **+**
after the last one shown (`.tab-btn.tab-more`, a `dropdown` of their names and counts — the tabs' grey `.count` pill, `count:`, never a keycap), and shows anyway once it holds an
item (any status), while it is the tab open, or once picked from + until the detail closes (the editor's `openedTabs`).
**Canvas** (`canvasTab`, a type with `canvas` in its structure: in Projects a project, initiative, story, task and
meeting) is last, set apart by its own line, never one of the seven nor folded: the Canvas layout (`mountCanvasView`,
host = its ref, `canvas/itemcanvas.js`) at a height of its own (`.item-canvas`), built the first time the tab shows
(`onShow`) and kept by its editor while the item stays open, so a save that draws the tabs again moves the same
whiteboard into the new panel; it is destroyed (its last strokes saved) when another item opens there or the detail
closes. Its side column offers the open items that hang from it, at any depth, as cards. One line under the bar, none over it; a tab's count is a number, so a 0 shows no badge (as the side panel's). Settings
follows the side panel's line, one field per row, its name on the left (a map with `key_labels`, On hold, a row per
key: On hold by · Why on hold · Resume when; never keys titled over boxes): a group's name a small grey uppercase title with no icon, as the create form's
sections (*SPEC AND RELEASE*, as *SETTINGS*), a thin line between groups, each field quiet as in Properties — no frame
until hovered or edited, an empty one saying what goes in it — and a text or a long text the row's width, a choice, a
date or a number only what it needs (280px; a number 120px, a due day 96px), a read-only
one plain (`.item-tabs .prop-readonly`), never a filled box. Which kinds
stay in Overview: `WORK_KINDS` in `panel.js`. The side panel keeps what is about the item, not its content:
Properties · Activity · AI Agents · Relations · Time, last.

### Planning (Today, Week, Month; `planrows.js`, `calendar.js`)

- **Head** (`periodHead`): *Planning* · `[Day | Week | Month]` (links: `#/today`, `#/week`, `#/month`; a `.seg`) ·
  `‹ This week ›` · the range in grey (*W46 · Nov 9 – Nov 15*); no Add (the Board page, Today and Planning add from
  their columns and quick adds). It replaces section tabs: Next week is `›`
  (`#/nextweek` still opens it), and the sidebar's Planning link goes to the last of Week or Month. Today's head is its
  title with the day line (date · done of planned · logged · next meeting). On a phone the title goes to the top
  bar and the switch, the nav and the day line stay.
- **The view bar** on every Planning page: no search on Today; *Show closed* is None / All; the layout switch is the
  page's own (`layout.options`): Today List | Board, Week List | Board | Free board, Month Calendar | Board. A note on
  the bar says how the period goes (*3 of 7 done*, `note`); the Week board adds *Days* to Display (`displayRows`).
- **Agenda** (Today's list, Week's list): sections, not boxes. A section head (`planSection`) is 36px — dot, name,
  count, a tag (*Today*), its action at the right (*Move all to this week*, a "+" on hover that opens the quick add) — a
  line under it, black for today; a past day grey. A row (`planRow`) is 42px on a grid: 14px box · subject (a
  meeting's time first) · where it belongs (grey, the type's icon; gone under 760px of list, a container query) · three
  columns of one width on every row, so they line up down the list (`rowMeta`, `.plan-meta.cols`: 96px status · 56px
  priority, its bars and name · 84px date, *1 wk late* in red, *Due today*, *Done Wed 4*; a phone drops the status and
  keeps the bars); a meeting's row keeps its own line; a
  `planCard` shows the status left of the priority too · the move of a carried-over one (→). Consecutive empty days
  are one line (`emptySlot`: *Tue 10 · Wed 11 … Nothing planned*), each day a drop target and a click to open it.
  Closed ones wait behind *N done today · Show*. Week ends with *Next week W47 · 0 planned, 7 days free ›*.
- **Boards** are the lists' (`boardOf`) with `planCard` cards (the board card without its id): Week's days (past and
  empty ones folded into strips, today's column wider and scrolled to), Month's horizons, Today's own columns with a
  Meetings column first (folded last on a day with none). A column takes a `lead` (meetings above the cards, not
  dropped on), an `aside` (*Move all*) and an `empty` line.
- **Calendar** (Month, `monthCalendar`): a week column and seven days, six rows; a day's number in a 24px circle
  (black today), outside days grey, past days a faint tint. A cell shows three pills at most — a meeting (its colour), a
  planned item, a due one — then *+N more*; on a phone the pills are dots. A late line (*Carried over 3 · …  Move all
  to today*) and *Anytime this month* sit above it. Pills drag between days and weeks.

### Goals (`views/goals.js`, `goals.js`)

- **Head**: *Goals* · *2 open · 1 closed* in grey · **Add goal** (primary). The view bar: **Filter** over the items
  (not the goals), **Display** (Show closed items; *Closed goals* Hide / Show, a `displayRows` row) and **List |
  Board | Canvas**, kept per vault in this browser (`planViewOf('goals')`). Canvas: see *Canvases*.
- **Board**: a column per goal (`boardOf`, `--board-col-w`), its head a `listHeader` — the goal's status dot, its name
  as a link that opens it, the count (its tooltip: *2 of 5 closed*) and ⋯ (Open, Rename, Move earlier / later, Mark
  done / Reopen). Its cards are the board's own. The last column is **Add a goal** (`addListColumn`: a name, Enter).
- **List**: Planning's agenda (`planSection` + `planRow`): a section per goal — the goal icon and its name, the count,
  *2 of 5 closed* as the tag, then its priority chip, "+" and ⋯ —.
- **Order**: goals by priority, then their own `order`, then title (`byGoalRank`); a goal dragged among goals of
  another priority takes theirs. Items by `goal_order` (`byGoalOrder`): a drop writes the goal and its place, and only
  the neighbours that must move (`dropInGoal`, `rules.placement`).
- **A goal's page**: Overview shows its Description in the description block every item has (`mdBlock`, panel.js `goalDesc`, bound
  to the `description:` field: its body is not used), then a progress row with *N of M closed* and **+ Add items** (an `itemPicker` of open projects, initiatives, stories and tasks in no goal); then a
  group per kind it can hold, in the order of the hierarchy — Projects, Initiatives, Stories, Tasks, Notes —, shown even
  when empty, spaced as another item's groups under its description (no line of its own). Projects, initiatives and stories are born in their project, so their **+ Add** is an `itemPicker` of that
  type's open items in no goal; Tasks and Notes keep their quick add.

### Canvases (`canvas/`: Goals' Canvas, any page's)

- **What a page hands in** is a provider; the canvas knows no page:
  `{ kind, label, items() (the side list), all() (Map id → item: every one a card may show), card(item), line(item), open(item) }`.
  `card(item)` → `{ title, kicker?, status?: { label, key }, priority?, note?, progress?: { done, total }, link? }`.
  `mountCanvasView(el, { host, provider })` draws the rest: the canvas picker, the side column, the whiteboard. `host`
  names its folder, `<Docs>/Canvases/<host>`. Its providers: Goals' (`goalsProvider`), and an item's or a free canvas's
  (`itemCanvasProvider({ items, whose, listed })`, panel.js: a card per item, any type).
- **The Canvas page** (`views/canvases.js`, `#/canvas/<path>`) is Docs' page (`.docs-page`, `.docs-panel`, its
  `.docs-head` sections with **+**, the same resizer) with a section per host — Free (`General`), Goals, each item's
  (`canvas/itemcanvas.js canvasHost`) — and `.canvas-row` links, and on its right the host's layout with
  `{ path, fixed: true }`: the canvas named instead of picked (`.canvas-name-fixed`), the page's list being the picker.
  `onOpen(c)` keeps the address on the canvas shown (a rename, a new one from ⋯); `actions(c, anchor)` adds
  **Move to an item…** to ⋯ (`itemPicker` over the types with `canvas`, then `api.movePath`).
- **The layout**: as a board, it takes the height left (`.canvas-view`, `board-layout` on `#view`). A 220 px column, the
  picker (`select`) and ⋯ on top, then a `.seg` of two tabs, **Shapes** and the provider's label (`canvas.<host>.side`,
  Shapes first), and a ⟨sidebar⟩ button folds it to a 32 px rail (`canvas.<host>.folded`). The whiteboard sits in a soft frame (`--border`, `--radius`). Filter, Display and the chips
  step aside (`#view.canvas-layout`). A narrow window stacks the column above the canvas. Excalidraw's own UI goes
  mobile under 730 px of canvas, so the column stays narrow.
- **A card is a board's card**, drawn in Excalidraw's primitives and grouped:
  - a white frame, 280 wide, `--border` grey, round. It is the card: `customData.tmItem`, its `[[link]]`, what arrows
    bind to. Its height is `cardHeight`: one even rhythm (`LEAD`: title lines 20, ID 15, the status row 17, 10 between
    blocks, 12 above and below), so a one-line and a two-line title read alike;
  - then its parts (`tmPart`): the title (16 px), the ID in grey (12 px), the status as the app draws it (a dot of
    `--st-dot`, its name), the priority (its bars and name in `--pr-ink`), the note on the right and a progress bar.

  Colours are the light theme's; Excalidraw darkens the whole scene in dark mode. `customData.tmSig` says what the card
  shows. A changed item redraws only the parts, so the frame keeps your colour, place and arrows. `CARD_LAYOUT` is
  bumped when the parts move.
- **Excalidraw's own chrome** (toolbar, properties, Library, menus, dialogs) wears the app's colours: its violet palette
  is variables on `.excalidraw`, set from the app's tokens (`--primary`, `--accent`, `--popover`, `--border`, the radii)
  under `.canvas-stage`, so they follow the theme. Its dialogs (Export image, Help) are drawn outside the canvas, in a
  body-level `.excalidraw-modal-container`: the same variables are set there too, or they come out violet.
  - The ☰ menu is a `.menu`: 5 px in, a border, `--shadow-lg`, rows of `--fs-sm`, grey icons and shortcuts, an
    `--accent` hover, its *Canvas background* a `.menu-label`.
  - A dialog is a `#modal`: radius 14, `--shadow-lg`, a 17 px 650 title in the app's font, its buttons `.btn.primary`,
    the scale a `.seg`. Its switches and radio choices are bare inputs over a drawn track, so the app's field look is
    taken off them.
  - The Library panel is on `--popover`, its Search · Library tabs a `.seg`, its ⋮ a `.btn.icon`; its headings are
    section labels (`--muted-foreground`, 12.5 px, 600), its *Browse libraries* link out is hidden and its empty hint
    says how to add to it (the right-click menu), not where the link was.
- **The shapes panel** (`shapepanel.js`) is draw.io's palette in the app's quiet style: a search (every word, over a
  figure's name, keywords and family), then the families as section labels that fold (`--muted-foreground`, 12.5 px,
  600; General open, `canvas.shapes.open`), each a grid of 36 px pictures (`.shape-tile`, `--muted` under the mouse).
  A picture under the mouse shows its figure larger beside the panel, with its name under it (`.shape-peek`, the
  popover's surface; draw.io's preview): the same SVG drawn at 128 px, cached as the tile's. A picture is the figure's own skeleton drawn as SVG (`shapes/thumb.js`): ink in `currentColor`, paper in
  `--shape-paper`, so it follows the theme. Drag one onto the canvas (`SHAPE_MIME`) or click it: the figure lands there,
  or in the view's middle (a second click steps down and right), selected.
- **Figures** are data in `shapes/` (`general.js`, `bpmn.js`, `flowchart.js`; `index.js` the families), built with
  `kit.js`. Drawn as draw.io draws them: white, a 1 px black line (`#000000`), square corners (the rounded ones by
  name: rounded rectangle, BPMN activities), roughness 0, Nunito 14. Excalidraw has only rectangles, diamonds, ellipses,
  lines, arrows and texts, so a figure is a group of **ink** (closed lines filled white — a hexagon, a cylinder's body
  —, ellipses, a marker's strokes; a black marker is a **mark**) under a **box**: a rectangle its size, on top, filled
  `#ffffff01` with no line. The box is what arrows bind to (from its middle too: it is filled), what holds the label,
  what you take hold of. A figure whose outline is a rectangle, diamond or ellipse is its own box (its **outline**).
  Each part says which in `customData.tmRole`. A colour that reaches the box (`boxRepairs`) goes on to the ink, and the
  box is cleared again. A double-click on a figure writes its label at once: Excalidraw's first double-click only goes
  into a group, so the whiteboard gives its canvas a second one.
- **The canvas's own defaults** follow: clean lines, a 1 px black line, square corners, Nunito 16, shapes filled white
  (Excalidraw takes hold of a shape with no fill only by its outline, so a filled one drags from its middle), arrows
  ending in a filled head (`triangle`, which the vendored Excalidraw draws notched, as draw.io's *classic*; Excalidraw's
  open V was its default, so a canvas saved with it draws the filled one too). Excalidraw's Library panel keeps only
  what you add to it.
- **A 1 px line is one sharp row of pixels**, at any zoom, on a 1× screen as on a retina one. Excalidraw drew it across
  two rows at half grey, broken every few pixels (Chrome's hairline for a stroke of ≤ 1 device pixel): the vendored
  renderer is patched for it, with the notched head (`static/vendor/excalidraw/BUILD.md`, *After the build*).
- **The main menu** (☰) is the whiteboard's own (`menu()` in `whiteboard.js`, Excalidraw's `MainMenu` with its
  `DefaultItems`): **Download .excalidraw** (the file excalidraw.com opens; it replaces Excalidraw's *Save to…* dialog,
  whose one choice it was), Export image…, **Export to draw.io…**, Find on canvas, Help, Reset the canvas, then the
  background's colours and under them **Canvas pattern** — a `.seg` of **Plain · Grid** (`gridModeEnabled`, which also
  snaps to it; Ctrl+' toggles it too). No *Excalidraw links* (GitHub, X, Discord: Excalidraw's, not the app's), no theme
  switch (the page's). The background and the pattern are the file's (its `appState`): changed alone, they are saved.
- **Export to draw.io** (`drawio.js`, pure) writes the canvas as a `.drawio` file (`<mxfile>`, uncompressed) that draw.io
  opens or imports. A figure of the shapes panel is one shape in draw.io's own style for it (`FIGURE_STYLES`: its
  `mxgraph.flowchart.*`, `mxgraph.bpmn.*`, `shape=…`), the size of its box, its label and colours; its ink is draw.io's
  to draw (the pool with lanes, which draw.io makes of children, goes part by part). A card is a rounded box with its
  title, ID and status. Rectangles, ellipses and diamonds are draw.io's, free texts its texts, arrows and lines its edges
  bound to the shapes their ends are bound to (an end bound to a figure's ink, to the figure), an elbow
  `orthogonalEdgeStyle` with its side as `exitX/Y`, `entryX/Y`, its heads draw.io's (`arrowhead`: triangle → classic).
  The background and the grid go with it.
- **Arrows meet a shape at the middle of a side**, as draw.io's and Miro's connectors, never anywhere along it:
  - `anchorlayer.js` draws the dots over Excalidraw (it has none): hover a shape, or select it, and its four dots show,
    blue (`.wb-anchor`); drag from one and a dashed line follows to the dot of the shape under the pointer, lit green;
    let go and the arrow is made, bound at both ends, in the arrow style chosen (elbow by default). With Excalidraw's
    own arrow tool the shape under the pointer shows its dots too, the one it will meet green. An arrow selected keeps
    Excalidraw's handles: the dots only say where its end may go (they let the pointer through). A click on a dot an
    arrow already meets selects that arrow, by giving Excalidraw's canvas a click on it: its handles (its linear
    editor) come only from a pointer selection, with the up a moment after the down.
  - `anchors.js` (pure) says which shape is under a point (`targetAt`: a shape, a free text, a card's frame or a
    figure's box, never a card's parts nor a figure's ink) and where its dots are; `snapArrows` puts an end drawn elsewhere on the nearest side's middle when
    the pointer is up, and routes again an elbow that comes into its side the wrong way (an end moved to another side
    keeps the segments you dragged). An elbow keeps the side as its `fixedPoint`, and Excalidraw's own router
    (`mutateElement` with new binding objects, on an elbow in the scene) draws its path around the shapes. A rotated shape is left as Excalidraw binds it.
- **Opening an item** from a canvas is `openItemCard`: a modal even for a type with a page, so closing it leaves you on
  the canvas.
- **Saving**: debounced 800 ms, only when the drawing changes (`getSceneVersion`), against the file's rev. A 409 reads
  the file again, and the toast offers *Keep mine*. Fonts measure late (Excalidraw registers them as the scene needs
  them), so text is measured again on `document.fonts` `loadingdone`.

### Forms (create, Settings)

- **A form's buttons, and a confirm's, are `formActions({ lead, onCancel, actions, small })`** (`ui.js`): `lead` at
  the left (the keys, *Delete … for good?*, an entry's Delete), a spacer, **Cancel — always a ghost button** —, then
  the `actions`, the last one primary (or danger for a delete). `small` in a panel, a row or a table (a comment's
  edit, a link's, Time, a Trash confirm), regular in a dialog (`openDialog`'s `foot`, or inside its `<form>` when ↵
  submits). Never a Cancel drawn by hand: it was four ways (ghost, outlined, plain, small or not) on one page.
- **A button that reads as a link** is `linkButton(text, onClick, { muted })`: one `.link` class, underlined, no box;
  `muted` greys it until hover (a line under a table, Today's *3 done today · Show*). *Show 3 closed* / *Hide closed*
  under a group is `closedToggle({ n, shown, noun, onToggle })` (`aria-pressed`). (`.link-btn` is its old name, left
  only for the list's closed line until that moves.)
- The create form is the card's rows (`propList`, `titleStatus`, `.quiet`, `prop-rows`), every property in view, its
  link fields as the card's Relations (`stackGroup` + `picks-quiet`). Its head is **New** and the type it creates, a
  `select()` (create.js `typePick`): the one it was opened for (the list's, or the one picked in *Add item*), any other
  one a pick away. Its main column is sections one under another, each under a small grey uppercase title as
  *PROPERTIES* (`.create-section`), never folding: Area and objective first, a project's Settings (the grey-titled
  groups of the page's tab), then the description, the page's own block (`mdBlock`, `mdblock.js`: a box that opens the
  editor on a click). No Links: they are added on the card. It asks only what is known when the item is opened: a
  field a later step writes (`later` in `tm/structures`: execution, release, triage, a pause, the outcome) is left out
  (rules.js `askedOnCreate`), and the new file takes its template's value. An optional select (create.js `OPTIONAL`)
  starts on none, so nothing is written until it is picked.
- Its right column's **Relations** opens with where the item goes, one **Parent** field (itemform.js `parentControl`, as
  the card's Relations: a project or an item, writing `project` and `related_to`; an item brings its project), a
  `stackGroup` as the link fields under it. Its goal is `later` (joined from the Goals view, whose values the form keeps
  and sends, or the card).
- A create the server would refuse is not sent (rules.js `missingOnCreate`): each field it needs and lacks (the
  subject, a project's key, a ticket's Parent when it brings no project, the Parent of a story, PRD, plan or hotfix) is marked in `--destructive` (its name, and its
  box, framed even in quiet rows: `.is-invalid`, `aria-invalid`), the first one focused, no toast and no message. Only
  a value given but wrong (a key that is not 2–4 capitals, or taken) says why under it (`.field-error`). A mark goes
  as soon as the field is filled in; nothing is marked before a create is tried.
- Settings (the app's) is rows as Properties, but its fields keep a soft grey frame (`--border`, a shade darker on
  hover, the halo in use), Statuses' too; its text is the lists' size: names and values 13px (`--fs-sm`), the notes
  under a section or a field 12.5px (`--fs-xs`). Each section's name is a small grey uppercase title (*VAULTS*), as
  the item page's groups; a vault's, a saved folder's and an export's
  row actions (×, download, Show in Finder) show on hover (`.row-action`). Its head is `pageHead`; a tab's name fits
  whole (*Statuses*).
- A folder field (a vault's folder, Settings' *Add a folder* rows, the Agents' *Add folder*) gets **Choose…** beside it
  (`folderButton(input, {prompt, onPick})`, `folderpick.js`): macOS's folder dialog, opened by the server, writes the
  path into the field as if typed. In the iPhone app the app's own Files picker does it (`nativePicker()`, its
  `pickFolder` message handler). Elsewhere it is not there and the field is typed as before.
- Settings → Keyboard and the `?` dialog are one view (`views/keyboard.js`): `keymap.js`'s groups as sections of
  `prop-rows`, a row's keys as `kbd` chips where its name goes (`.keys`; "or" between two, none between keys pressed
  one after the other), what they do at the right, and a search over all of it (`.keys-search`). Themes opens with
  **Mode** (light, dark, system), its only place: the sidebar has no switch.
- Settings: form tabs at `max-width: 860px`, sections one under another divided by a line, each setting a row
  (`setRow(label, control, help)` in `views/settings.js`), the save bar sticky at the foot (`.settings-save`).
- Settings → Vaults (`views/vaults.js`) is a page's rows (`table.grid.fixed.vault-grid`, its ✎ × `rowAction`s on hover,
  *New vault* a small ghost button in the section head), and one dialog per vault: `openDialog({ cls: 'vault-modal' })`
  holding `tabPanels` (General · Item types · Features · Default texts), each tab Settings' `prop-rows` (the same rows, inside the dialog), its foot
  `formActions` with *Save* and a `kbd-hint` the phone hides. On a phone the table is stacked rows as Labels'
  (`phone.css`: name and its chips, the folder, then structure · types · features; the Default column is a chip by the
  name, as *This page*: a fourth item on line 3 has no room), and the dialog scrolls under its sticky foot. A setting that is the vault's own (its item types) is
  saved into the vault (`api.saveVaultSettings`), what is this device's (name, folder, default) into config.json.
  **Default texts**, a tab of its own (`.vault-texts`), is in Projects a `select` of the types on and one `mdBlock` (`tabbed`, as the
  create form's Description) saved as you type (`api.setDefaultText`), never through the dialog's Save; a save redraws
  only the picker's *(empty)* marks, so the editor keeps its focus. Its placeholders are listed under it as `code`. With
  nothing to set (a new vault, a folder gone, a structure changed but not saved, a legacy one) the tab is one `muted small` line saying why.
  Features is a `.vault-feature-list`: per feature a native checkbox and its text (name; what it hides, `muted small`;
  its types). One the device has none of (`features.js` `onPlatform`) or whose types are all off is the vault's value,
  disabled, with its reason after the name (*· Not on this device*); a type a feature takes is locked in Item types,
  *(with ‹feature›)*. A surface that goes with a feature carries `data-feature="<id>"` (app.css hides it under
  `<html data-off>`) or asks `has()` / `viewOn()`: never a vault-specific check of its own.
- Settings → Themes (`views/themes.js`) applies each choice at once, so it has no save bar. A look is a **theme card**
  (`.theme-cards` > `button.theme-card`, `aria-pressed`, `.active` framed in `--foreground`): a preview of the look in
  light and dark side by side (`.tc-preview` with two `.tc-half`, drawn with literal colours so it shows the other
  look, not the current one), its name (`.tc-name`) and a line about it (`.tc-about`). Its other choices are
  `.seg` groups in `prop-rows`; one that does not apply to the current look is `disabled`, with a note saying why.

### Rendered Markdown (`.md`, `ui.js renderMarkdown`, `mdextras.js`)

What marked reads plus Obsidian's own, one look everywhere Markdown is shown (a doc's Preview, a description, a comment):
- **Callout** (`> [!type] Title`): `.callout .callout-<tone>`, a box tinted with `--c` at 9%, a 3px bar in `--c`, its
  icon and title (`.callout-title`, `--c` mixed with the text for contrast) over `.callout-body`. The tones take the
  status dots' colours (the same in both themes); `-`/`+` make it a `<details>`. A new type is a row in `TYPES`.
- **Table**: always in `.md-table`, which scrolls sideways — never squeeze a table to fit. A cell of prose gets
  `.md-cell-mid` / `.md-cell-long` (9–28em / 16–28em, `cellClass` by its length); a short one stays on one line.
- `==mark==` a soft yellow; `#tag` a quiet pill (`.md-tag`).
- **Blank lines**: each beyond the first is a `.md-gap` one line high (`keepBlankLines`, marked's `preprocess` hook).
- **Diagram**: a ```` ```mermaid ```` fence becomes `.md-diagram` (`diagrams.js renderDiagrams`, called after the HTML
  is set; Mermaid loads only then), in Mermaid's `default` or `dark` theme by the page's, scrolling sideways when wider.
  One Mermaid cannot read keeps its `<pre>` and a `.md-diagram-error` line under it. Its corner `.md-expand` (an
  icon button over `--card`, shown on hover, always on `hover: none`) opens it in `#modal.expand-modal`
  (`expand.js openExpanded`): the zoom stage of an image (`zoom.js`), the SVG growing to fill it.
- **Pictures**: `![[x.png|300]]` is an `img.md-embed` (`filetree.js linkWikilinks`), `![](rel.png)` is pointed at the
  vault's file (`vaultlinks.js linkPaths`); both cap at the text's width and open expanded with a click
  (`cursor: zoom-in`), except inside a link or an editor.
- **Links**: a Markdown link written as a path is rewritten after rendering by `linkPaths` to the view links open in
  (`setLinkContext`: Docs sets `docsHref` while shown, so nothing followed there leaves it). Call it after every
  `renderMarkdown` of vault text, next to `linkRefs`.
- **A `[[link]]` to nothing**: `.md-missing`, its label muted with a dashed underline, `Not found: …` as its title.
- **In the Live editor** (`livemd.js blockField`, `livemarks.js liveBlocks`): a table, a callout and a diagram the
  caret is not on are one `.cm-block-widget .md` drawn by `renderMarkdown`, so they look as here; hover outlines it
  (dashed `--border`), a click shows its Markdown.

**A file's header** (`views/files.js headMenu`): title · modes (`.seg`) · ⋯ (`.files-more`, a `dropdown`) — never
more buttons beside it; what is done with the file goes in that menu. The reading column is `.files-col`,
`--read-max` wide and centred unless `data-width="wide"`.

### Empty, loading, errors

- An empty place says so in one grey line: **`emptyLine(text, { cls })`** (`p.child-empty`, `ui.js`) inside a panel,
  a tab or a group — no box, its margins the place's, `cls` only to place it (an indent, Graph's overlay). A whole page
  with nothing: `emptyState(text)` (soft tint, no dashed border); a list's empty row: `pageEmpty(text)`.
  When one action fills the place, a `secondaryButton` under the line (an item's Canvas tab: *No canvas for ACME
  yet.* + *Create canvas*; the Canvas page with nothing open: `emptyState` + *New canvas*). What the place is for
  goes in README and the button's tooltip, never a paragraph in the empty state.
- Being read: **`loadingLine(text = 'Loading…')`**, the same grey line with `role="status"` (a screen reader says
  it), in a panel or for a whole page — never an `emptyState` box that flashes before the content. The menus' and
  pickers' *No matches* stay `.menu-empty`, inside the menu.
- Deleting what can be undone (an item, a comment, a work-log entry, a file) is one click, and the toast's **Undo**
  puts back the same thing in its place (`deleteItem`, `deleteComment`, `unlogWork`, `removeAttachment` in
  `state.js`). A confirmation is for what cannot be undone.
- Errors: `toast(message, true)`; inline warnings `small warn`.
- A notice that something keeps working but should change (a vault of a legacy structure): the On hold tint
  (`--st-onhold-bg`, its icon in `--st-onhold-fg`), as `vault-legacy` in Settings and the quiet `vault-legacy-hint`
  link under the vault selector. The destructive tint (`vault-match`) is only for what is blocked.
- Hidden files in a tree (Show hidden files, the eye by the filter: `.btn.icon.toggle.on` while on): their rows dimmed
  (`.tree-row.is-hidden`); a sealed folder (.git, .task-manager) has a `lock` icon, no chevron, a menu of Show in Finder
  and Copy path only, and in a folder's table reads *Protected*.
- A file the page cannot show: `externalView` (views/files.js) — its icon, one line saying so, and the one action that
  helps (*Open in <App>*, named once the server has looked the app up), or why not in `muted small`. Never a dead end
  with only Download.
- Dates for reading: `shortDate` (*Oct 20*), `longDate` (*Oct 20, 2026*), `stampLabel` (*Oct 20, 09:54*); the raw
  value goes in `title`.

### Fold heads

Anything that folds what is under it — a work group, a table's group, a Docs or Canvas or Agents section, a Graph
panel's section, a shapes family, Settings' *Versions* — has one head: `foldHead({ open, title, onToggle, ico, count,
small, class })` (`ui.js`). One button: a chevron (14px; 12px in a sidebar-like tree, `small`), its icon, its name, its
count as the tabs' pill; `aria-expanded`, and a tooltip that says what a click does (*Hide tasks*). The caller keeps
whether it is open (a pref, a Set, the view's state) and redraws on `onToggle(open)`. Its hover is the accent, its
focus the ring; a sidebar-like tree (Docs, Canvas, Agents: `.docs-title`) keeps the sidebar's hover. The place's class
(`.work-fold`, `.group-toggle`, `.gp-fold`, `.shapes-group-head`, `.body-fold`) sets only its type size and room.
Never a hand-made ▸/▾ button. A row that opens its own detail (an agent's file, a changed file's diff) is a row, not a
fold head. A native `<details>` is kept for a disclosure of explanatory text inside a box (a vault's warnings, *What
does not match*, a vault row's *Folders for new items*), never for a section.

### Panel kit (the side panel's patterns, as components)

The side panel (Properties · Activity · AI Agents · Relations · Time), Docs and Links are built of these; reach for them
anywhere before a new style. JS in `ui.js`, CSS in `app.css` under *Panel kit*. They take the size of where they sit:
the side panel sets 12px for all it holds (`--fs-side` on `.im-side.tabbed`, and `.menu-side` for what opens from it).

| Pattern | Use | Looks |
|---|---|---|
| Primary button | `btn primary` | Filled: the one action that does the job (*Work on it with Claude*, a relation's *Add*). One per place. |
| Secondary button | `secondaryButton(label, { ico, …attrs })` → `btn secondary`; a `select()` as one: `class: 'secondary'` + `face: ['plus', label]` | A border, no fill, the accent on hover; at the left edge, as wide as its text. Opens or adds (*+ Add relation*, *Add existing session*). |
| Tab's add button | `tabAddButton(label, onClick, attrs)` → `btn small ghost tab-add`, as a `stackGroup`'s `aside` (a `select()` as one: `class: 'ghost tab-add'` + `face`) | In an item's tab (Links, Docs, Files), *+ Add…* on the first group's line at the right: grey, no frame, the accent on hover. The form it opens keeps its fields framed. |
| Add line of empty kinds | `workGroups(…, { table: true })` with `shownKinds` (`kindgroups.js`) → `.add-kinds` of `secondaryButton(name, { ico: 'plus', class: 'small' })` | In a tab of folding groups (Initiatives · Issues · Briefs · Records), a kind that holds nothing has no group: its type's name waits on one line at the tab's foot, and a click opens its quick add in its own group. Overview's work keeps its empty groups. |
| Quiet pickers | a `.picks-quiet` around any `select()` (or a `propField`) | Frameless until hovered: then a border and its chevron, never a fill; the focus ring while open. An empty one reads its placeholder in grey. |
| Group | `stackGroup(label, content, { title, aside })` → `.stack-group` / `.stack-label` (`.stack-head` with an `aside`) | Its name above what it holds (grey, `--fs-sm`), a line between one group and the next; no name, only the line. `aside` goes on the name's line at the right. |
| Rows | `rowList(rows, { ordered })` of `rowItem({ text, href, ico, meta, mono, lead, depth, actions, linkAttrs, tip })` | Plain rows: no box, no line, the accent on hover; icon + title, a muted meta at the right (an id, a folder, a link's label), text level with the group's name; `depth` steps a chain in. With `onClick` instead of `href`, a button (a file opened in a dialog); with neither, a muted line. In an item's tabs, the title in plain weight. |
| Row action | `rowAction(ico, label, (e, btn) => …)` | A 24px icon button (× to unlink, ☆ to make it the main, ⋯ for more), shown on the row's hover. A row that opens to edit (a link's *Edit*) is a `.row-edit` li holding the same row the add button opens. |
| Remove (×) | `removeButton(label, onClick, { size, cls, keepFocus })` | `size: 'chip'` inside a chip or a tag: its colour, at .7 until hovered. `'row'` (the default) a 22px square, muted, `--row-hover` on hover: a pinned item's, a terminal's, a filter pill's (round there, `vb-chip-x`). `label` is its tooltip and its name; where it shows is the caller's (`.td-x` only on its row's hover). A row's own × is a `rowAction('x', …)`. Its size class is `x-row` / `x-chip`, never a bare `chip`: that would make it a chip to `.chip`'s rules and selectors. |
| Segmented choice | `seg(options, current, onPick, { aria, role, small, disabled, cls })`, `options` of `[value, label, { ico, tip, disabled, lead, attrs }]` | One `.seg` of buttons, the picked one pressed. A `label` of `null` is an icon-only button named by `tip`. `role` says what it is: `group` (`aria-pressed`, the default), `tablist` (`role="tab"`, `aria-selected`: Canvas's *Shapes · Items*) or `radiogroup` (`aria-checked`: a label filter's *And · Or*). Not for links (Planning's *Day · Week · Month* are links in a `.seg`). |
| Section label | `sectionLabel(content, tag = 'h4')` → `.section-label` (`content` a text, or `[text, …nodes]`) | The small uppercase grey title over a block (Settings' groups, Statuses' kinds, an item's property groups, Schedule's): `--fs-2xs`, 600, `.04em`. Its margin is its place's. |
| Count | `countOf(n, { tab, plain, cls, attrs })` | The default a pill tinted with its own colour (`.count`, at its row's end: the sidebar, a board's column, a Settings group); `tab` the same inside a tab (`.tab-count`); `plain` the muted number beside a title (`.count-plain`: a page's *3 open*, a group's, Planning's, Graph's), `cls` its size. `n` is drawn as it is — 0 is "0" — and `null` draws nothing, an empty pill hidden: `n \|\| null` hides a 0. |
| Shown on hover | `.hover-reveal` inside a `.hover-host` | Hidden until the host is hovered or it has focus; always shown on a touch screen. |
| White card | `.surface-card` | On the panel's grey: what someone wrote or started (a comment, a session); its own padding and layout on top. |
| Chips by name | `labelChip`, `personChip` | One hue per name (`labelHue`), the same everywhere. |

### Graph

The Graph view is `graphCanvas()` (`graphcanvas.js`); an item's card or page draws no graph of its own;
reuse it for any other picture of links. It draws with a **look** (`graphstyle.js` `LOOK_DEFAULTS`): the Graph view's is
Obsidian's — grey nodes (`--graph-node`), faint grey lines (`--graph-line`, `--graph-line-faint`), no arrows, names
(`--graph-label`) that come in as you zoom (`labelAlpha`, Display → *Text fade threshold*) — while `PANEL_LOOK` keeps
the type colours (`--t-<type>`, docs `--t-doc`), arrows and every name. A node is bigger the more it is
tied to and faded when closed; its name under it, on a halo of the background, drawn only where it covers no other name
(`unclutter`: a cluster shows its hubs, a hover the rest). An edge takes a **tone** of the theme, never a colour of its
own — `strong` `--foreground`, `soft` `--graph-line`, `faint` `--graph-line-faint`, `alert` `--destructive` — with a
width and a dash per kind. **Hover** lights the node and its edges in `--graph-accent` (violet, the graph's one colour)
and dims the rest to near nothing; its tooltip (`.graph-tip`, the popover's surface) reads each tie from it. The canvas
reads its colours on every draw: a theme switch redraws it.

The **Graph page** is a list's head (`view-head`: the title and its count on one line) over a canvas from edge to edge
down to the window's foot (`.graph-stage`, a hairline above it, the page's own background: no tinted box), the zoom
buttons at its bottom right. Its settings are **a floating panel** at the top right (`.graph-panel`, the popover's
surface, `--shadow-lg`), shut to a sliders button (`.graph-panel-open`) and always shut on a phone, where it takes the
stage's width. Inside, folding sections (`.gp-section`, a chevron and a bold name; Filters holds ↺ reset and ×): rows
of a name and the list's switch (`.gp-switch` + `.vb-switch`, the whole row flips it), the types as toggling pills
(`.gp-chip`: a dot, the name, the count; struck through while hidden), a search with its clear button (`.gp-search`),
groups as a colour swatch that cycles `GROUP_COLORS` and a search box (`.gp-group`), and sliders (`.gp-range`: a thin
track filled with the accent up to the thumb, its value at its left). Everything in it is kept per vault (`graph.view`).

### Agents (`agentspane.js`, `views/runs.js`, `views/agentshome.js`)

**A list that is not the vault's files reuses the Explorer's tree read-only**: `treePane({ readonly: true, … })` keeps
the filter, folding, keyboard and lit row, and drops dragging, renaming, deleting, *Search in files* and the eye; its
rows take `nameOf`, `iconOf`, `tipOf`, `decorate` and a `menu(node)` of their own. A section per folder is drawn as
Docs' heads (`.docs-head`, the title folds it) with its count at the right (`.agents-count`). An agent's name is
monospace (it is what you type), with the `slash` icon; a namespace is a plain folder row.

**An item's Docs tab is the same tree** (panel.js `docsTree`): `treePane({ readonly: true, filter: false, foldInPlace: true,
ordered: true, defaultOpen })` over `filetree.js` `docsSubtrees` (each Docs section cut to the branches that lead to its
paths, a linked folder whole). Its section heads are `.docs-head` with a title that does not fold (`.docs-tab-title`);
a folder's count is `countOf(…, { plain })` (`.docs-tab-count`); a linked row has `.docs-tab-linked` and an × that shows
on hover as `.tree-more` does (`.docs-tab-unlink`, a finger's size and always shown on a phone). Folds are kept per
item and tree (`docs.tab.<key>.linked` / `.mentioned`); a linked folder starts open.

**`#/runs` is the Home** (`.agents-home`): the week's line on top, then a grid of two columns
(`.agents-home-grid`, one at 900px and below) of sections titled as the Inbox's groups (`.agents-section-title`, no
line under them; a quiet *… →* link at their right, `.agents-home-more`), each a list of `.cs-item` cards: a dot or an
icon, the title in monospace, one muted meta line with the status word first, and at most one quiet icon button at
the right (Stop, Run now, ▷ Run — which opens it in the dock, as on its page). **What needs you is the one box with a tint**
(`.agents-home-alert`, the warning tone), and only while there is something in it — an empty Home is calm. The week is
a muted line, not a row of figures. In the sidebar, Home, Inbox and Routines are three rows on top
(`.agents-nav`), lit as the Explorer's views are — there with no folder yet too, and nothing else: no text, **+** in the bar adds one.

**`#/runs/routines` is Routines** (`views/routines.js`): a page's head (*Routines* · *2 on · 1 paused*), the section's tabs, the page bar's search (`searchBox`), then every agent's schedules as one `scheduleList` (agentschedules.js, `showAgent`), in `schedmodel.js routineOrder` — never a list of its own.

In the middle, **`#/runs/inbox` is the Inbox**, a list as the type lists are: `.section-tabs` Home · Inbox · Routines, then the
list's own `viewBar` (Filter chips, Order, Group, Display, List · Board; *Mark all read* as its `note`) over a
`dataTable` in `.list-main` (40px rows, its quiet head, a list's phone layout: the dot and what it ran …… when, the
folder under them), paged as a list (`LIST_PAGE`). Rows that are not items use `dataTable`'s `rowLabel` and `rowHref`
(⌘-click opens the run's detail in a new tab). Its view's fields, groups, orders and columns are a pure module,
`inboxview.js` (as `worklogview.js` is the Work log's); a Filter value with a `tone` draws the status dot. The status
column is a dot (`.td-dot.tone-*`, the tones of `runmodel.js RUN_STATUSES`) and its word, what it sent is monospace
(700 while unread, the ask in the warning tone after it when it needs you), the unread dot and a 24px ⋯ (`row-action`)
share the last column. Group's heads carry the dot of a status or attention group. The board is the app's,
drawn by `boardOf` (boardview.js), never a copy of it: a column per status, always (`boardGroups: false` hides Group on
it), each `--board-col-w` wide as every board's, a dot and the status's name and count in its head, the head's fold
button on hover, a folded or empty one a `.fold-strip`; heads and strips move their column (`movable` columns and
`onReorder`, kept in `view.colOrder.status`, *Reset column order* in Display), and its cards are `.cs-item`s
(`.agents-inbox-row`, the column's `card`). **Archived** runs (`archived_at`, runmodel.js `isArchived`) are out of the
Inbox and the Home unless Display → *Archived runs* shows them (a `vb-row` with a Hide · Show `.seg`, as Goals'
*Closed goals*); an agent's page keeps them, *Archived* in their meta. Neither the Inbox nor the Home has a max
width: they take the column, as every page of the section. **The status is a dot and a word, never a filled chip**: amber needs you, blue works, green done, red
failed, grey stopped; the same dot marks an agent's row in the sidebar and the Inbox row's count turns amber while one
needs you. The agents themselves are listed in the sidebar only, under **Favourites** (`.agents-favs`: the Projects
mode's `.side-title`, never folding, not there while none is starred) and then a section per folder.

**An agent's page** is a head and tabs, its figures in the side panel. **The head** (`.agents-head-page`): crumbs (`.agents-crumbs`:
folder icon and name, its namespace after a `/`, muted and small), then a row of the name (the `h1`, as an item
type's title: `--fs-title`, 700, not monospace) and at its right the actions (`.agents-actions`, all 32px high — the small *Where* select too —, wrapping
under the name when short of room): the Favourites star (`.btn.fav`, as an initiative's), **Run** primary, *Where* as a
small `select`, **Schedule…** secondary, **Open in ▾** ghost and ⋯; no description under the row (it is the first
property of its Instructions); 24px under it the tabs, their bar and their content level with the head (no inset of their
own, as `.item-tabs`) (the page's parts never shrink: `.agents-page > * { flex: none }`). The page has no max width: it takes the column. **There is no composer on the page**: Run opens
the dock's chat with the command written, and that composer is the only one. **The figures** are the side panel's
first tab, **Overview** (`.agents-overview`): property rows (`prop-rows quiet`, as an item's Properties), each its name,
then the figure (600) and what it counts, muted and smaller (`.agents-ov-value`) — never a scorecard. **The tabs** (`tabPanels`, `.agents-tabs`, as wide as their names and scrolling sideways, never cut):
*Instructions* is its file as a card (`agentfile.js`, `.agents-doc`: a bordered card, a muted head with the file in
monospace and the Explorer's **Preview · Source · Edit** `.seg` at its right — Source and Edit only for a file that is
not Markdown —; Preview is its frontmatter as `prop-rows` (`.agents-file-props`, Details' `.agents-props` rows: a list
as `.chip.mono`, the path in monospace, only the keys it has — `agentsmodel.js fileProps` —, each name over its value
when the card is under 460px, a container query) with a line under them, then the Markdown as Docs' preview draws it
(`.md .files-md`: the app's heading sizes, never brought down) with a prompt's rhythm on top (`.agents-prompt`: room
around headings, between list items and around code, a list's own disc · circle · square); Source is `.files-source`,
Edit the Explorer's `mdEditor`). **Every Markdown file of an agent reads this one way**; *Skills*, *Subagents*,
*Commands* and *Files* only when there is something in them, each a bordered list (`.agents-rel-list`) of rows that
unfold — icon, name in monospace with a *via …* chip when it came through another, its description clamped to two
lines, a chevron that turns — into the same file card, flush with the row (no frame of its own, a line above, indented
to the name): unfolded, the row is its name, the card's head its path and Preview · Source · Edit, then the file (its
description is one of its property rows, never a loose muted paragraph); *Details* the property rows. It is laid out as an item's page is (`.page.two-panel` >
`.page-body` with `.page-main` and a `.page-side.im-side.tabbed` that `sideFold` folds; as wide as every right panel,
`.agents-body`): the side panel's tabs are **Runs** and **Schedules**, drawn as an item's AI tab draws its
conversations (`.cs-list` of `.cs-item` cards, the arrow and ⋯ on hover).

**A run's detail replaces the list in the panel** (no new page, no modal): *‹ Runs*, then the status dot and word over
what it sent, a row of actions (the primary one first, ⋯ last at the right, `.agents-run-actions`), its facts as
`prop-rows quiet`, then **Changes** — `.agents-change` rows of path, `+n −n` in the diff colours and a toggle that
unfolds the file's diff, drawn by `diffview.js diffBlock` as the dock's chat draws an edit (hunks as a muted line). A
list that polls redraws only when what it shows changed, so a hovered row or an open menu stays put.

**A schedule is a `.cs-item` too**: its rule in words as the title (`tm/schedules.py label`, never worked out in the
page), *Next tomorrow 9:00 (in 19 h) · last ran today 14:27* as the meta, a green / grey / red dot for on / paused /
could not start, ▷ Run now and ⋯ on hover. **The Schedule dialog** is the Add-folder dialog's frame (`.agents-modal`):
two groups, **When** and **Run**, each under a small grey uppercase title (`.agents-sched-group > h4`), their rows as
Settings' (a 100px label, 38px high, 12px in from the title; stacked on a phone), a line between the two groups and
none between rows: one choice a row — Repeats, At, Days or Every, Arguments, Mode, Model, Effort, Where —, **every
control the column's width**, so all end on one edge (*this Mac's time* beside the When title, not after the field),
the days as toggle pills (`.agents-sched-day`). No notes in it: what a scheduled run does is in README.

### Resizing a panel

A panel whose width (or the dock's height) the user picks gets a grip wired by `wireResizer` (`resizer.js`): drag, ←/→
(↑/↓) while focused, double-click to reset, a `*-resizing` class on `<html>` while dragging. `cssWidth` keeps a width
in a CSS variable and a pref. The grip is 7px wide, transparent, and draws a `--focus` line on hover, focus and drag
(`#side-resizer`, `.docs-resizer`, `.td-grip`); it is a `role="separator"` with a label, and it hides where the panel
stacks (≤760px). Never another hand-written copy.

### Dialogs

**Every dialog is `openDialog()` (`ui.js`)**: the one `#modal` of index.html, opened and closed the same way everywhere.

```js
const { modal, close } = openDialog({ title, ico, label, cls, head, body, foot, focus, onKey, onClose, dismissable });
```

- **Its head** is a `.modal-head`: an 18px icon (`ico`), the title (a string, or nodes: *Delete status* + its chip),
  `head` nodes before the ✕ (an attachment's *Open in new tab* and *Download*), and the ✕ (*Close (Esc)*).
- **Its foot** (`foot`) is a `.modal-foot`: the keys in `muted small` at the left, a `spacer`, then Cancel
  (`btn ghost`) and the primary. A form that submits with ↵ keeps its buttons inside its `<form>` instead.
- **What it does for every caller:** Tab stays inside (`trapFocus`); Esc, the ✕ and a press on the backdrop close it
  (on `mousedown`, so a drag out of a field doesn't); the focus goes back to what opened it; `focus` gets the focus
  once it's drawn (after the key that opened it, so its letter doesn't land in the field). `onKey(e)` sees each key
  first (⌘↵ to save). `dismissable()` keeps it open while a save is in flight. `close(value)` → `onClose(value)`,
  once; dismissed, `value` is undefined (`askArgs` resolves null).
- **A new dialog closes the one open** and keeps its opener.
- **A frame of its own** (the create form's `modalFrame`): `title: null` and no `body`; the caller draws into `modal`.
- Never `getElementById('modal')` and a hand-made close: that's how ten copies came to differ (a Cancel styled three
  ways, a backdrop on `click` here and `mousedown` there, two without a focus trap). The item card (`#item-modal`,
  `panel.js`) is the other layer and has its own.

### Menus and pickers

Use `select()` (button + searchable menu, `search: true` for long lists), `selectButton()` + `dropdown()` for action
menus, and the app's own date picker (`dateInput()`, `pickDate()` in `datepicker.js`), never the browser's
`<input type=date>`. A menu entry's `kbd` is a shortcut (a keycap); a number of things is `count` (the grey `.count`
pill the tabs and the sidebar use).

**Everything that opens from a button over the page is a `floating(anchor, el, { layer, align, side, grow, onEsc,
onClose })`** (`ui.js`): `dropdown()` (and so `select()`'s list and the date picker), the view bar's `popover()`,
`itemPicker()` and *Add existing session*. A new one goes through it, never its own listeners. It gives them one way to
behave:

- **Two layers, one open in each.** A `'menu'` (the default) may open from inside a `'panel'` (a popover or a
  picker: what you work in) and closes alone; opening a panel closes whatever was open.
- **One Esc** closes the top one and puts the focus back on its button — the card or dialog under it stays. `onEsc()`
  returning true keeps it open when the Esc was for something inside (*Add existing session*'s folders go back to its
  sessions).
- **One click outside** closes it; a click in a menu a panel opened is not outside the panel. The same button again
  closes it: `if (floatingFrom(anchor, layer)) …`.
- **Placed** under the button, at its left (`align: 'end'`: its right); above it when there is no room under it
  (`side: 'top'`: always, a button at a dialog's foot), else moved up into view. `grow` (a picker whose rows change
  with a search): anchored by the edge nearest the button, so it grows away from it. Opened from the side panel it
  takes the panel's text size (`sideSized`). **On a phone** (≤760px, the phone layout) it opens in the middle of the screen instead, over the page dimmed
  with `--overlay` (`.menu.centered`: up to 380px wide, a long one scrolls inside; one opened from another dims the
  page once); with `grow`, its top stays still at 12% of the screen, clear of the keyboard. What opens focuses its first control
  through `focusFirst(el, selector)`, which on a phone skips a text field: its keyboard would cover the popup at once.

## 4. Do / don't

| Do | Don't |
|---|---|
| Reuse `prop-rows`, `quiet`, `cards rows`, `statusChip`, `select`, `quietBlanks`, `emptyState`, `mdBlock`, and the Panel kit. | Write a new chip, pill, button or row style for one screen. |
| Show a value as text; frame it on hover. | Leave bordered inputs on a card, a page or the create form. |
| Ask on creation only what is known then. | Offer on the create form a field a later step writes (branch, disposition…). |
| A dot + words for status. | Fill a status or a whole column with colour. |
| A line between rows. | A box around each row of a list. |
| An empty property reads *Empty* in grey; an empty kind of child waits on *+ Add …*. | A wall of framed empty fields or empty headers. |
| A sentence for "how it goes". | Progress bars, score cards, KPI tiles inside items. |
| Undo in a toast. | `confirm()` for something reversible. |
| Tokens and `--fs-*` sizes. | Hex colours or pixel font sizes in a rule. |
| `cssKey()`/`statusCss()` for a status's classes. | Hard-coded status or type names (they are structure data, `tm/structures/`). |
| A desktop-only control marked `data-feature="<name>"`, or left out when `has('<name>')` (`features.js`) is false. | A check of `sys.platform` or the user agent in the page: the server says what the platform has (README §7 *On a phone*). |
| `refOf(item)` for an id on screen. | `item.id` in a label: in a vault on short ids it is a bare number (`482`). |
| One view bar on every list, board and section tab (`viewBar`). | A filter drawer, a scope segment or a select of a page's own. |
| Let a narrow page drop columns and words (`hiddenColumns`, container queries). | Make the page scroll sideways. |

## 5. Checking a UI change

1. Both suites green (CLAUDE.md *Done means*).
2. On a sample server (`python3 tools/serve_sample.py`, `--legacy` to also see an Initiatives vault): the changed screens at **375, 820, 1000, 1303 px**,
   light **and** dark, no horizontal scroll, no console errors (README §6 *Checking a layout change*).
3. Hover and touch: whatever is quiet until hover must be visible on a touch screen (phone.css's `(pointer: coarse)`
   block). A phone is checked with a coarse pointer: the browser pane's `mobile` preset (it reports `pointer: coarse`),
   then the iOS Simulator; a 375px window with a mouse is a narrow desktop, not a phone.
4. Open a few selects on the changed screens: they must open (a name clash once broke every menu).
5. README §7 says what a user now sees; CHANGELOG under *Unreleased*.
6. A change to Basecoat's families, to a theme's tokens or to the phone layer: Classic (and Modern for the phone layer) compared with `main`'s on two sample servers, each
   page's every element's computed style (colour, sizes, spacing, radius, shadow, display, flex, font, transition…)
   hashed and compared, at the four widths in light and dark. Equal hashes, or each difference explained.

## 6. Where things are

| Thing | File |
|---|---|
| Tokens, every style | `static/css/app.css` (sections marked `/* ── … ── */`) |
| A theme's tokens (Modern) | `static/css/themes/<id>.css`; choices and how they apply: `static/js/themeprefs.js`, `theme.js` |
| `h`, `icon`, `select`, `dropdown`, `tabPanels`, `itemCard`, `statusChip`, `statusLabel`, `emptyState`, `openDialog`, `trapFocus`, `emptyLine`, `loadingLine`, `formActions`, `linkButton`, `closedToggle`, `propRow`, `floating`, `closeFloating`, `floatingFrom`, `carriedAction`, `foldHead`; the Panel kit (`secondaryButton`, `tabAddButton`, `stackGroup`, `rowList`, `rowItem`, `rowAction`, `removeButton`, `seg`, `sectionLabel`, `countOf`) | `static/js/ui.js` |
| Property fields, `statusSelect`, `quietBlanks`, `planControl` | `static/js/itemform.js` |
| The description block (`mdBlock`: rendered box, editor on a click, full screen) | `static/js/mdblock.js` |
| The Markdown editor (`mdEditor`: toolbar, Live / Markdown / Both / View); Live's drawing; its menus and links | `static/js/mdeditor.js`; `livemd.js` (CodeMirror, its `THEME`) and `livemarks.js`; `completions.js` and `vaultlinks.js` |
| Card and page layout, Properties, Relations, tabs of children | `static/js/panel.js` |
| Tables | `static/js/datatable.js` |
| The graph: canvas, layout and filters, edge styles | `static/js/graphcanvas.js`, `graphlayout.js`, `graphmodel.js`, `graphstyle.js` |
| Dates for reading | `static/js/dates.js` |
| The redesign's mock-ups (card A, header B, initiative C, phone D) | the owner's design canvas: https://claude.ai/artifact/KjaKJv2B5fgcuN8EheQP7p (private; option A is the one built) |
