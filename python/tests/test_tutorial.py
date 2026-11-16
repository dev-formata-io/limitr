"""
The Python tutorial's programs (python/tutorial, and its Network track in python/tutorial/network), each run as its chapter shows it and checked against what the
chapter says it prints. Run: python -m pytest
"""

import pathlib
import re
import subprocess
import sys

import pytest

TUTORIAL = pathlib.Path(__file__).resolve().parent.parent / 'tutorial'
BLOCKS = re.compile(r'```(python|text)\n(.*?)```', re.S)


def programs(track: str = ''):
    """(chapter, program, expected output): a python block that builds a Limitr, then the block after 'It prints:'."""
    found = []
    for chapter in sorted((TUTORIAL / track).glob('[0-9][0-9]-*.md')):
        text = chapter.read_text(encoding='utf-8')
        program = None
        for m in BLOCKS.finditer(text):
            lang, body = m.group(1), m.group(2)
            if lang == 'python':
                program = body if 'from limitr import Limitr' in body and 'Limitr.cloud' not in body else None
            elif program is not None and text[:m.start()].rstrip().endswith('It prints:'):
                found.append(pytest.param(program, body.rstrip('\n'), id=f'{track + "/" if track else ""}{chapter.stem}-{len(found)}'))
                program = None
    return found


def test_every_chapter_has_its_program():
    assert len(programs()) == 15
    assert len(programs('network')) == 6   # the Network track: chapters 2 to 7 (chapter 1 is prose)


@pytest.mark.parametrize('program,expected', programs() + programs('network'))
def test_program_prints_what_the_chapter_says(program, expected, tmp_path):
    script = tmp_path / 'example.py'
    script.write_text(program, encoding='utf-8')
    out = subprocess.run([sys.executable, str(script)], capture_output=True, text=True, timeout=120, cwd=tmp_path)
    assert out.returncode == 0, out.stderr
    assert out.stdout.rstrip('\n') == expected
