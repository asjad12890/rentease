import re

SRC = "main.py"

with open(SRC, "r", encoding="utf-8") as f:
    text = f.read()

n = len(text)
call_re = re.compile(r'(cur2?)\.execute\(')


def find_matching_paren_end(text, paren_open_idx):
    """paren_open_idx points at the '(' just after 'execute'. Returns index just after the matching ')'."""
    depth = 1
    j = paren_open_idx + 1
    in_str = None  # None or the quote sequence ("'", '"', "'''", '"""')
    n = len(text)
    while j < n and depth > 0:
        c = text[j]
        if in_str:
            if c == '\\':
                j += 2
                continue
            if text[j:j + len(in_str)] == in_str:
                j += len(in_str)
                in_str = None
                continue
            j += 1
            continue
        else:
            if text[j:j + 3] in ('"""', "'''"):
                in_str = text[j:j + 3]
                j += 3
                continue
            if c in ('"', "'"):
                in_str = c
                j += 1
                continue
            if c == '(':
                depth += 1
            elif c == ')':
                depth -= 1
            j += 1
    return j  # index just after matching ')'


matches = []
for m in call_re.finditer(text):
    cursorvar = m.group(1)
    start_exec = m.start()
    paren_open_idx = m.end() - 1
    end_args = find_matching_paren_end(text, paren_open_idx)
    rest = text[end_args:end_args + 11]
    method = None
    if rest.startswith('.fetchall()'):
        method = 'fetchall'
        chain_end = end_args + len('.fetchall()')
    elif rest.startswith('.fetchone()'):
        method = 'fetchone'
        chain_end = end_args + len('.fetchone()')
    if method:
        matches.append((start_exec, end_args, chain_end, cursorvar, method))

print(f"Found {len(matches)} chained fetch calls")

# Sanity: ensure no two matches share the same starting line (would complicate replacement)
line_starts = []
for (start_exec, end_args, chain_end, cursorvar, method) in matches:
    line_start = text.rfind('\n', 0, start_exec) + 1
    line_starts.append(line_start)
dupes = [ls for ls in set(line_starts) if line_starts.count(ls) > 1]
if dupes:
    print(f"WARNING: {len(dupes)} line(s) contain multiple chained calls — review needed")
    for ls in dupes:
        line_end_dbg = text.find('\n', ls)
        print("  >>", text[ls:line_end_dbg])

# Apply replacements in reverse order so earlier offsets stay valid
replacements = []
for (start_exec, end_args, chain_end, cursorvar, method) in matches:
    line_start = text.rfind('\n', 0, start_exec) + 1
    line_end = text.find('\n', chain_end)
    if line_end == -1:
        line_end = n
    prefix = text[line_start:start_exec]
    indent_match = re.match(r'[ \t]*', prefix)
    indent = indent_match.group()
    args_full = text[start_exec + len(cursorvar) + len('.execute'):end_args]  # "(...)"
    suffix = text[chain_end:line_end]
    line_a = f"{indent}{cursorvar}.execute{args_full}"
    line_b = f"{prefix}{cursorvar}.{method}(){suffix}"
    new_text = line_a + "\n" + line_b
    replacements.append((line_start, line_end, new_text))

replacements.sort(key=lambda r: r[0], reverse=True)
for (line_start, line_end, new_text) in replacements:
    text = text[:line_start] + new_text + text[line_end:]

with open(SRC, "w", encoding="utf-8") as f:
    f.write(text)

print("Done. Wrote", SRC)
