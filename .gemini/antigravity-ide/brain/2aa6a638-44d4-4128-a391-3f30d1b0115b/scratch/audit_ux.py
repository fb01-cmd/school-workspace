import os
import re

components_dir = "/home/fb01/school/src/components"

files_to_check = []
for root, dirs, files in os.walk(components_dir):
    for f in files:
        if f.endswith(".tsx") or f.endswith(".ts"):
            files_to_check.append(os.path.join(root, f))

print(f"Total files: {len(files_to_check)}")

# 1. Check try/catch and response checking for "실패했는데 성공처럼 보이는 것"
print("\n--- Catch blocks / Error handling checks ---")
for path in files_to_check:
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    
    # Catch block swallowing error or showing success inside catch or after failed fetch
    lines = content.split("\n")
    for i, line in enumerate(lines):
        # Look for alert("...성공") or toast.success or alert("...완료") after catch or without checking res.ok
        if "성공" in line or "완료" in line or "저장되었습니다" in line or "적용되었습니다" in line:
            # Check context around i
            context = "\n".join(lines[max(0, i-10):min(len(lines), i+5)])
            if "catch" in context and ("alert" in line or "toast" in line or "setMessage" in line or "setStatus" in line):
                print(f"[Match Pattern C?] {os.path.basename(path)}:{i+1} -> {line.strip()}")

