from backend.app.db import NEW_BOX_COLORS, class_palette


def test_new_class_colors_reserve_hidden_red_and_keep_saved_colors():
    saved = {'Legacy red': '#ff0000', 'Legacy white': '#ffffff', 'Legacy black': '#000000'}
    names = [f'Class {i}' for i in range(30)]
    colors = class_palette(names, saved)
    assert {name: colors[name] for name in saved} == saved
    assert all(colors[name] in NEW_BOX_COLORS for name in names)
    assert not {'#ff0000', '#ffffff', '#000000', '#ef4444'} & set(NEW_BOX_COLORS)
    assert class_palette(names, colors) == colors


def test_palette_uses_distinct_choices_until_all_are_used():
    names = [f'Class {i}' for i in range(len(NEW_BOX_COLORS))]
    colors = class_palette(names)
    assert len({colors[name] for name in names}) == len(NEW_BOX_COLORS)
