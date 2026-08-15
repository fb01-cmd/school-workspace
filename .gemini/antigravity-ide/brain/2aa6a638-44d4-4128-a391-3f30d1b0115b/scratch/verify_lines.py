import os
import re

def search_in_file(path, term):
    if not os.path.exists(path):
        return []
    results = []
    with open(path, "r", encoding="utf-8") as f:
        lines = f.readlines()
    for i, line in enumerate(lines):
        if term in line:
            results.append((i+1, line.strip()))
    return results

base = "/home/fb01/school/"

print("=== VERIFYING LINE NUMBERS FOR REPORT ===")

# Cat 1
print("\n--- CAT 1 ---")
for f_path in [
    "src/components/admin/lifecycle/PromoteSheetEditor.tsx",
    "src/components/admin/lifecycle/EnrollSheetEditor.tsx",
    "src/components/admin/ChromeBookmarks.tsx",
    "src/components/admin/BookmarkTreeEditor.tsx",
    "src/components/admin/OrgChartBuilder.tsx",
    "src/components/admin/discipline/DisciplineConfigTab.tsx",
    "src/components/admin/timetable/DirectSubstituteTab.tsx"
]:
    full_p = os.path.join(base, f_path)
    if os.path.exists(full_p):
        res = search_in_file(full_p, "onClick")
        print(f"{f_path}: found {len(res)} onClick instances")

# Cat 2
print("\n--- CAT 2 ---")
for f_path, search_term in [
    ("src/components/admin/GroupList.tsx", "fetch"),
    ("src/components/admin/OUConfiguration.tsx", "handleMoveUser"),
    ("src/components/admin/ProfileApprovals.tsx", "handleReject"),
    ("src/components/admin/lifecycle/TransferOutTab.tsx", "handleSaveSettings"),
    ("src/components/admin/discipline/DisciplineRecordTab.tsx", "setDoc"),
    ("src/components/admin/timetable/TeacherSlotBanTab.tsx", "handleSave"),
    ("src/components/admin/RosterApiKeyManager.tsx", "handleSave")
]:
    full_p = os.path.join(base, f_path)
    if os.path.exists(full_p):
        res = search_in_file(full_p, search_term)
        print(f"{f_path} ({search_term}): lines {[r[0] for r in res]}")

# Cat 3
print("\n--- CAT 3 ---")
for f_path, search_term in [
    ("src/components/admin/UserList.tsx", "성공적으로"),
    ("src/components/admin/ClassroomCleanupTab.tsx", "완료되었습니다"),
    ("src/components/admin/timetable/OffscreenShareCard.tsx", "fetch"),
    ("src/components/admin/OrgChartBuilder.tsx", "catch"),
    ("src/components/admin/lifecycle/TeacherLifecycle.tsx", "성공적으로"),
    ("src/components/admin/discipline/DisciplineConfigTab.tsx", "성공적으로"),
    ("src/components/admin/timetable/BaseRevisionTab.tsx", "저장되었습니다")
]:
    full_p = os.path.join(base, f_path)
    if os.path.exists(full_p):
        res = search_in_file(full_p, search_term)
        print(f"{f_path} ({search_term}): lines {[r[0] for r in res]}")

