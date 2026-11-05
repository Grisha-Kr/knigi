# -*- coding: utf-8 -*-
"""Модуль для ocrmypdf: передаёт ход распознавания (сколько страниц куска готово) в knigi_convert.py."""
import os
from ocrmypdf import hookimpl

CALLBACK = {"fn": None}


class Bar:
    def __init__(self, *args, total=None, desc="", unit="", disable=False, unit_scale=1, **kw):
        self.desc = str(desc or "")
        self.n = 0
        # у шага OCR ocrmypdf считает по полстраницы (unit_scale 0.5)
        self.scale = unit_scale if isinstance(unit_scale, (int, float)) and unit_scale > 0 else 1

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def update(self, n=1, *, completed=None):
        self.n = completed if completed is not None else self.n + (n or 0)
        fn = CALLBACK["fn"]
        if fn and "OCR" in self.desc:
            try:
                fn(int(self.n * self.scale))
            except Exception:
                pass


@hookimpl
def get_progressbar_class():
    return Bar
