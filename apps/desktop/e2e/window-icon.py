"""Prints Logbook's window icon as X11 sees it (_NET_WM_ICON, which GTK sets from the window's
icon): the sizes it holds, and the colour of the largest one at a point given as fractions of its
width and height (argv[1], argv[2]), as JSON. The smoke test checks the person's picture (D101).
The newest Logbook window's: one from the session before can still be closing. Linux/X11 only;
needs python3-xlib.
"""
import json
import sys
from Xlib import X, display

d = display.Display()
root = d.screen().root
NET_WM_ICON = d.intern_atom('_NET_WM_ICON')
fx, fy = (float(sys.argv[1]), float(sys.argv[2])) if len(sys.argv) > 2 else (0.5, 0.5)


def windows(w):
    yield w
    for child in w.query_tree().children:
        yield from windows(child)


found = []
for w in windows(root):
    try:
        if w.get_wm_name() == 'Logbook':
            prop = w.get_full_property(NET_WM_ICON, X.AnyPropertyType)
            if prop:
                found.append((w.id, prop))
    except Exception:
        continue
# X gives each new connection higher ids, so the newest app's window has the highest.
for _, prop in sorted(found, reverse=True)[:1]:
    data, icons, at = list(prop.value), [], 0
    while at + 2 <= len(data):
        width, height = data[at], data[at + 1]
        icons.append((width, height, data[at + 2 : at + 2 + width * height]))
        at += 2 + width * height
    width, height, pixels = max(icons, key=lambda i: i[0] * i[1])
    argb = pixels[int(fy * (height - 1)) * width + int(fx * (width - 1))]
    rgba = [(argb >> 16) & 255, (argb >> 8) & 255, argb & 255, (argb >> 24) & 255]
    print(json.dumps({'sizes': [[i[0], i[1]] for i in icons], 'pixel': rgba}))
    sys.exit(0)
sys.exit(1)
