"""Generate Wallpaper Engine's project.json from Lively's LivelyProperties.json and LivelyInfo.json.

Run from the repository root:  python tools/make_project_json.py
Wallpaper Engine keys are the Lively setting names in lower case (it only allows letters and digits);
sea.js maps them back. Wallpaper Engine has no buttons, so buttons become switches that act when flipped.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'shallow-sea')

BUTTON_SWITCHES = {
    'newSeabed': 'New seabed (flip to shuffle) 換一片海床（切換一次就換）',
    'showSeabed': 'Show seabed number (flip to show) 顯示海床編號（切換一次就顯示）',
}


def main():
    props = json.load(open(os.path.join(SRC, 'LivelyProperties.json'), encoding='utf-8'))
    info = json.load(open(os.path.join(SRC, 'LivelyInfo.json'), encoding='utf-8'))
    we = {}
    order = 100
    for key, p in props.items():
        kind, k = p['type'], key.lower()
        order += 10
        if kind == 'label':
            continue
        if kind == 'slider':
            we[k] = {'type': 'slider', 'text': p['text'], 'min': p['min'], 'max': p['max'], 'value': p['value'],
                     'fraction': False, 'editable': True, 'order': order}
        elif kind == 'checkbox':
            we[k] = {'type': 'bool', 'text': p['text'], 'value': bool(p['value']), 'order': order}
        elif kind == 'dropdown':
            we[k] = {'type': 'combo', 'text': p['text'], 'value': str(p['value']), 'order': order,
                     'options': [{'label': item, 'value': str(i)} for i, item in enumerate(p['items'])]}
        elif kind == 'color':
            h = p['value'].lstrip('#')
            rgb = ' '.join(f'{int(h[i:i + 2], 16) / 255:.4f}' for i in (0, 2, 4))
            we[k] = {'type': 'color', 'text': p['text'], 'value': rgb, 'order': order}
        elif kind == 'textbox':
            we[k] = {'type': 'textinput', 'text': p['text'], 'value': p['value'], 'order': order}
        elif kind == 'button':
            we[k] = {'type': 'bool', 'text': BUTTON_SWITCHES[key], 'value': False, 'order': order}
    project = {
        'contentrating': 'Everyone',
        'title': info['Title'],
        'description': info['Desc'] + '\n\nhttps://github.com/Lego514/shallow-sea',
        'file': 'index.html',
        'preview': 'preview.gif',
        'tags': ['Nature', 'Relaxing'],
        'type': 'web',
        'version': 0,
        'general': {'properties': we},
    }
    out = os.path.join(SRC, 'project.json')
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(project, ensure_ascii=False, indent=2) + '\n')
    print(f'wrote {os.path.normpath(out)} with {len(we)} settings')


if __name__ == '__main__':
    main()
