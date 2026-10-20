"""The Ticketing structure (the native format of ~/github/docs/ticketing-second-brain): its definition
(definition.py), how its files map to items (codec.py), what a vault of it must look like (check.py), its
templates (templates/), and the rules of its types (rules.py). Imports only the frontmatter module and the
standard library: it never reaches into the Store or the server."""

from .check import check
from .codec import TicketingCodec
from .definition import build

TICKETING = build(TicketingCodec(), check)
