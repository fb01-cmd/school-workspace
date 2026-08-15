import os
import glob

files = glob.glob("/home/fb01/school/src/components/admin/**/*.tsx", recursive=True)

print(f"Total admin files: {len(files)}")

for f in sorted(files):
    rel = os.path.relpath(f, "/home/fb01/school")
    with open(f, "r", encoding="utf-8") as file_obj:
        text = file_obj.read()
    
    # Check 1: Modals/Editors with local state confirm/save buttons
    # e.g. setStaged, setTemp, setIsEditing, setRows, onClose
    lines = text.split("\n")
    for idx, line in enumerate(lines):
        if ("<button" in line or "<Button" in line) and any(w in line for w in ["저장", "확인", "적용", "완료", "수정"]):
            # look around
            snippet = "\n".join(lines[max(0, idx-5):min(len(lines), idx+10)])
            print(f"[BTN] {rel}:{idx+1} -> {line.strip()}")

