import os
import re

components_dir = "/home/fb01/school/src/components"
app_dir = "/home/fb01/school/src/app"

all_files = []
for root_dir in [components_dir, app_dir]:
    for root, dirs, files in os.walk(root_dir):
        for f in files:
            if f.endswith(".tsx") or f.endswith(".ts"):
                all_files.append(os.path.join(root, f))

findings_cat1 = [] # Confirmation modal pretending to save when it only updates memory state or needs outer save
findings_cat2 = [] # Saved to DB/API but UI/cache shows stale old values
findings_cat3 = [] # Failures appearing as success or error swallowed / partial failure misreported

for filepath in sorted(all_files):
    rel = os.path.relpath(filepath, "/home/fb01/school")
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    lines = content.split("\n")

    # --- CATEGORY 1: 확인창이 저장인 척하는 것 ---
    # Look for modals, popups, or dialogs with buttons labeled "저장", "확인", "적용"
    # that only call onSave/onChange/setState (updating parent state) without calling API/DB directly,
    # or where user gets no indication that outer page "저장" is required.
    for i, line in enumerate(lines):
        if ("<button" in line or "<Button" in line or "onClick" in line) and any(w in line for w in ["저장", "확인", "적용", "완료", "수정완료"]):
            # Check context
            ctx = "\n".join(lines[max(0, i-15):min(len(lines), i+15)])
            if any(term in ctx for term in ["Modal", "Dialog", "isEditing", "setShow", "onSave", "onConfirm", "onApply", "onEdit"]):
                # check if there's a fetch or firebase call inside the handler or if it's strictly prop callback
                if not ("fetch(" in ctx or "updateDoc" in ctx or "setDoc" in ctx or "deleteDoc" in ctx or "api/" in ctx):
                    findings_cat1.append({
                        "file": rel,
                        "line": i+1,
                        "code": line.strip(),
                        "context_summary": [l.strip() for l in lines[max(0, i-5):min(len(lines), i+5)] if l.strip()]
                    })

    # --- CATEGORY 2: 저장했는데 화면이 캐시 때문에 옛 값을 보여주는 것 ---
    # Look for functions performing fetch(POST/PUT/DELETE) or updateDoc/setDoc/deleteDoc
    # Check if cache invalidation (invalidateClientCache, setClientCache, router.refresh) or state update is missing or partial.
    for i, line in enumerate(lines):
        if any(term in line for term in ["fetch(", "updateDoc(", "setDoc(", "deleteDoc("]):
            # inspect function block
            fn_block = "\n".join(lines[max(0, i-5):min(len(lines), i+35)])
            if any(method in fn_block for method in ["POST", "PUT", "DELETE", "PATCH", "updateDoc", "setDoc", "deleteDoc"]):
                # check if cache invalidation / refresh / refetch exists in this function block
                has_inval = any(c in fn_block for c in ["invalidateClientCache", "setClientCache", "router.refresh", "fetch", "load", "get", "setRecords", "setUsers", "setGroup", "setRules", "setItems", "mutate"])
                # Also check if clientCache is imported in this file
                cache_imported = "clientCache" in content
                
                # Check specific keys that might be missed
                if "invalidateClientCache" not in fn_block:
                    findings_cat2.append({
                        "file": rel,
                        "line": i+1,
                        "code": line.strip(),
                        "fn_block_snippet": "\n".join([l.strip() for l in lines[i:min(len(lines), i+10)]])
                    })

    # --- CATEGORY 3: 실패했는데 성공처럼 보이는 것 ---
    # 1. Catch blocks that swallow errors, show success alert/toast, or set success state
    # 2. API responses where res.ok / data.success is NOT checked before showing success toast/alert
    # 3. Loops/batch operations where failures are ignored and alert says "성공적으로 저장되었습니다"
    for i, line in enumerate(lines):
        if "catch" in line:
            catch_block = "\n".join(lines[i:min(len(lines), i+10)])
            if "성공" in catch_block or "완료" in catch_block or "toast.success" in catch_block:
                findings_cat3.append({
                    "file": rel,
                    "line": i+1,
                    "type": "Catch block contains success notice!",
                    "snippet": catch_block
                })
            elif not any(err_term in catch_block for err_term in ["alert", "toast", "setError", "console.error", "throw", "setStatus", "setMessage", "err"]):
                findings_cat3.append({
                    "file": rel,
                    "line": i+1,
                    "type": "Empty or silent catch block",
                    "snippet": catch_block
                })
        
        # Check fetch followed by success without checking res.ok
        if "fetch(" in line:
            fetch_block = "\n".join(lines[i:min(len(lines), i+20)])
            if any(s in fetch_block for s in ["성공", "완료", "저장되었습니다", "toast.success"]) and not any(chk in fetch_block for chk in ["res.ok", "response.ok", "data.success", "res.status === 200", "res.status == 200"]):
                findings_cat3.append({
                    "file": rel,
                    "line": i+1,
                    "type": "Fetch followed by success alert without res.ok / data.success check",
                    "snippet": fetch_block[:300]
                })

print(f"Findings Cat 1: {len(findings_cat1)}")
print(f"Findings Cat 2: {len(findings_cat2)}")
print(f"Findings Cat 3: {len(findings_cat3)}")

# Print sample findings
print("\n--- SAMPLE CAT 1 ---")
for f in findings_cat1[:10]:
    print(f"{f['file']}:{f['line']} -> {f['code']}")

print("\n--- SAMPLE CAT 2 ---")
for f in findings_cat2[:10]:
    print(f"{f['file']}:{f['line']} -> {f['code']}")

print("\n--- SAMPLE CAT 3 ---")
for f in findings_cat3[:10]:
    print(f"{f['file']}:{f['line']} -> {f['type']} | {f['snippet'][:100]}...")

