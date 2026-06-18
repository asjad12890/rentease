import re

SRC = "main.py"
with open(SRC, "r", encoding="utf-8") as f:
    text = f.read()

# Pattern A: "<var> = sqlite3.connect(DB_PATH)\n<indent><var>.row_factory = sqlite3.Row\n"
pat_a = re.compile(
    r'([ \t]*)(\w+)\s*=\s*sqlite3\.connect\(DB_PATH\)\n[ \t]*\2\.row_factory\s*=\s*sqlite3\.Row\n'
)
count_a = len(pat_a.findall(text))
text = pat_a.sub(lambda m: f"{m.group(1)}{m.group(2)} = get_db_connection()\n", text)

# Pattern B: standalone "<var> = sqlite3.connect(DB_PATH)" without a following row_factory line
pat_b = re.compile(r'([ \t]*)(\w+)\s*=\s*sqlite3\.connect\(DB_PATH\)')
count_b = len(pat_b.findall(text))
text = pat_b.sub(lambda m: f"{m.group(1)}{m.group(2)} = get_db_connection()", text)

with open(SRC, "w", encoding="utf-8") as f:
    f.write(text)

print(f"Pattern A (with row_factory) replaced: {count_a}")
print(f"Pattern B (standalone) replaced: {count_b}")
