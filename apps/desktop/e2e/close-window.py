"""Asks Logbook's window to close the way a window manager's close button does: an X11
WM_DELETE_WINDOW message. WebDriver's own "close window" skips that path, so the smoke test uses
this to check that text typed just before closing is saved (D86). Linux/X11 only; needs python3-xlib.
"""
import sys
from Xlib import X, display, protocol

d = display.Display()
root = d.screen().root
WM_PROTOCOLS = d.intern_atom('WM_PROTOCOLS')
WM_DELETE = d.intern_atom('WM_DELETE_WINDOW')


def windows(w):
    yield w
    for child in w.query_tree().children:
        yield from windows(child)


sent = 0
for w in windows(root):
    try:
        if w.get_wm_name() == 'Logbook' and WM_DELETE in (w.get_wm_protocols() or []):
            w.send_event(protocol.event.ClientMessage(window=w, client_type=WM_PROTOCOLS, data=(32, [WM_DELETE, X.CurrentTime, 0, 0, 0])), event_mask=X.NoEventMask)
            sent += 1
    except Exception:
        pass
d.flush()
sys.exit(0 if sent else 1)
