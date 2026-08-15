import os

base = "/home/fb01/school/"

def find_lines_with_terms(rel_path, terms):
    full_path = os.path.join(base, rel_path)
    if not os.path.exists(full_path):
        return
    with open(full_path, "r", encoding="utf-8") as f:
        lines = f.readlines()
    print(f"=== {rel_path} ===")
    for i, line in enumerate(lines):
        if any(t in line for t in terms):
            print(f"  Line {i+1}: {line.strip()}")

find_lines_with_terms("src/components/admin/ClassroomCleanupTab.tsx", ["alert", "toast", "성공", "완료", "정리"])
find_lines_with_terms("src/components/admin/OUConfiguration.tsx", ["fetch", "updateDoc", "setDoc", "invalidateClientCache", "alert"])
find_lines_with_terms("src/components/admin/discipline/DisciplineRecordTab.tsx", ["fetch", "updateDoc", "setDoc", "invalidateClientCache", "save"])

