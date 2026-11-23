"""A vault's own settings: what it shows, kept inside the vault (.task-manager/settings.json) so that every device that
opens the same folder — the Mac app, the iPhone app over iCloud Drive — sees the same vault. What only one device
knows (the vault's name in this app, its path here, whether it is the default) stays in that device's config.json.

It holds `disabled_types` (Settings → Vaults → Item types), `disabled_features` and `enabled_features`
(→ Features: FEATURES below) and `reminders` (Settings → Reminders: the default every item without reminders of its
own follows, tm/reminders.py) — and `me`, which of its contacts you are (Contacts → You), so a list can show what has
been handed to you. A feature is on unless the vault turned it off, so one list is enough — except for a
feature that starts off (`default_off`), where absence means off and the vault names it in `enabled_features` to have
it. The
file is read on its own, with no Store, because
config.json is loaded before any store is opened; it is written only through Store.save_vault_settings (the vault's
lock, atomic)."""
import json
import os

DIR = '.task-manager'
FILE = 'settings.json'
KEYS = ('disabled_types', 'disabled_features', 'enabled_features', 'reminders', 'me')  # what the file may hold; anything else in it is kept as it is, never read

# What a vault may turn off as a whole (Settings → Vaults → Features): its id (what features.js has() asks), its name,
# what it hides, and the item types that go with it (turned off with it, as Item types turns them off). With
# `follows_types` the feature is off too once every one of its types is off (the Activity tab with the Activity type).
# With `default_off` it is the other way round: the feature starts off in every vault, old or new, and is on only
# where the vault asked for it (`enabled_features`) — a feature nobody has to want.
# Nothing is ever deleted: turned on again, everything is back.
FEATURES = (
    {'id': 'agents', 'label': 'AI Agents', 'types': ('agent', 'prompt'), 'follows_types': False,
     'hides': 'Agents and Prompts, an item’s AI Sessions tab and Claude button, the sidebar’s Agents mode and its runs'},
    {'id': 'canvas', 'label': 'Canvas', 'types': (), 'follows_types': False,
     'hides': 'the Canvas page, an item’s Canvas tab and the Goals page’s canvas layout'},
    {'id': 'inbox', 'label': 'Inbox', 'types': ('inbox',), 'follows_types': True,
     'hides': 'the Inbox and its quick capture (Q, Capture to Inbox)'},
    {'id': 'activity', 'label': 'Activity', 'types': ('activity',), 'follows_types': True,
     'hides': 'Activities and an item’s Activity tab (its comments and history)'},
    {'id': 'goals', 'label': 'Goals', 'types': ('goal',), 'follows_types': True,
     'hides': 'Goals, an item’s goal and the lists’ goal column and grouping'},
    {'id': 'graph', 'label': 'Graph', 'types': (), 'follows_types': False,
     'hides': 'the Graph page and Show in graph'},
    {'id': 'meetings', 'label': 'Meetings & transcription', 'types': ('meeting', 'transcription'), 'follows_types': True,
     'hides': 'Meetings and Transcriptions, and their place in Today and the Month'},
    {'id': 'worklog', 'label': 'Work log', 'types': (), 'follows_types': False,
     'hides': 'the Work log page, an item’s Time tab and the minutes in Today'},
    {'id': 'contacts', 'label': 'Contacts', 'types': (), 'follows_types': False,
     'hides': 'the Contacts page, @ mentions and an item’s watchers (attendees stay, as plain names)'},
    {'id': 'reminders', 'label': 'Reminders', 'types': (), 'follows_types': False,
     'hides': 'an item’s Reminders row and Settings → Reminders, and nothing of this vault rings on any device (a '
              'planned time and duration stay)'},
    {'id': 'responsible', 'label': 'Responsible', 'types': (), 'follows_types': False, 'default_off': True,
     'needs': 'contacts',
     'hides': 'who a story, a task, a support ticket or a hotfix is handed to: its Responsible row, the column, the '
              'filter and the grouping in the lists, and the chip on its card (what an item already says is left on disk)'},
    {'id': 'notifications', 'label': 'Notifications', 'types': (), 'follows_types': False,
     'hides': 'the system’s notifications: no reminder of this vault rings on the Mac or the iPhone, and Claude’s '
              'sessions and agent runs no longer tell you when you look elsewhere (the toast on the page stays)'},
)
FEATURE_IDS = tuple(f['id'] for f in FEATURES)
# The features that start off: for these, and only these, `enabled_features` is what turns them on.
DEFAULT_OFF = tuple(f['id'] for f in FEATURES if f.get('default_off'))


def feature_types(disabled_features, types):
    """The item types the features turned off take with them, among `types` (a structure's), in its order."""
    off = set(disabled_features or ())
    return [t for t in types if any(t in f['types'] for f in FEATURES if f['id'] in off)]


def features_off(disabled_features, disabled_types, types, enabled_features=None):
    """The features off in a vault: those it turned off, those whose types (among the structure's `types`) Item types
    turned all off (`follows_types`), those that start off and the vault has not asked for (`default_off`), and those
    whose feature (`needs`) is itself off. In FEATURES' order."""
    off, gone = set(disabled_features or ()), set(disabled_types or ())
    on = set(enabled_features or ())
    off |= {i for i in DEFAULT_OFF if i not in on}
    for f in FEATURES:
        mine = [t for t in f['types'] if t in types]
        if f['follows_types'] and mine and all(t in gone for t in mine):
            off.add(f['id'])
    for f in FEATURES:  # after the rest: what a feature rests on may have just gone off
        if f.get('needs') in off:
            off.add(f['id'])
    return [i for i in FEATURE_IDS if i in off]


def path(root):
    return os.path.join(root, DIR, FILE)


def read(root):
    """The vault's settings, or None when it keeps none (no file, a folder that is gone, or a file that is not a JSON
    object: then the device's own config is used, as before the file existed)."""
    try:
        with open(path(root), encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None
