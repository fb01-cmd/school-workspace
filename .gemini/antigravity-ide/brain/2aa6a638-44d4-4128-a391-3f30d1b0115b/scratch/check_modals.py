import os
import re

components_dir = "/home/fb01/school/src/components"

files = []
for root, dirs, f_list in os.walk(components_dir):
    for f in f_list:
        if f.endswith(".tsx"):
            files.append(os.path.join(root, f))

for filepath in sorted(files):
    rel = os.path.relpath(filepath, "/home/fb01/school")
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    # Search for button tags containing "저장", "확인", "적용", "완료"
    lines = content.split("\n")
    for i, line in enumerate(lines):
        if "<button" in line or "<Button" in line:
            # check line or next line for label
            btn_text = ""
            for j in range(i, min(len(lines), i+3)):
                if any(w in lines[j] for w in ["저장", "확인", "적용", "완료"]):
                    btn_text = lines[j].strip()
                    break
            
            if btn_text:
                # check context to see if inside modal/dialog/editor
                ctx_before = "\n".join(lines[max(0, i-20):i])
                if any(m in ctx_before for m in ["fixed", "absolute", "modal", "Modal", "dialog", "Dialog", "Editor", "popup", "Popup"]):
                    # get onClick
                    onClick_line = ""
                    for j in range(max(0, i-2), min(len(lines), i+3)):
                        if "onClick=" in lines[j]:
                            onClick_line = lines[j].strip()
                            break
                    print(f"[{rel}:{i+1}] Button text: '{btn_text}' | onClick: '{onClick_line}'")

