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

print(f"Scanning {len(all_files)} files for detailed UX traps...")

cat1_details = []
cat2_details = []
cat3_details = []

for filepath in sorted(all_files):
    rel = os.path.relpath(filepath, "/home/fb01/school")
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    lines = content.split("\n")

    # Inspect file for specific known components & logic
    
    # -------------------------------------------------------------
    # Category 1: Modal confirm pretending to save to DB
    # -------------------------------------------------------------
    # Check sheet editors, tree editors, config modals
    if any(k in rel for k in ["Editor", "Modal", "Tab", "Builder", "Manager", "Section"]):
        for i, line in enumerate(lines):
            if ("<button" in line or "<Button" in line) and any(w in line for w in ["저장", "확인", "적용", "완료"]):
                # check surrounding 20 lines
                ctx = "\n".join(lines[max(0, i-20):min(len(lines), i+10)])
                if any(m in ctx for m in ["isModal", "setShow", "onSave", "onConfirm", "onApply", "onEdit", "setStaged", "setTemp", "setRows"]):
                    # If handler does NOT call fetch / db / updateDoc / setDoc, it's local staging!
                    # If button text says "저장" or "확인" without specifying "임시 적용" or "목록에 반영", it's a Cat 1 trap!
                    if not any(api in ctx for api in ["fetch(", "updateDoc", "setDoc", "deleteDoc", "/api/"]):
                        cat1_details.append({
                            "file": rel,
                            "line": i+1,
                            "code": line.strip(),
                            "reason": "모달/팝업 내 '확인/저장' 버튼이 실제 백엔드 DB/API를 호출하지 않고 메모리(React State)만 수정함. 사용자는 서버에 저장된 것으로 오해할 수 있음."
                        })

    # -------------------------------------------------------------
    # Category 2: Saved but cache shows old values (Stale Cache)
    # -------------------------------------------------------------
    # Look for API calls or Firestore updates
    for i, line in enumerate(lines):
        if any(term in line for term in ["fetch(", "updateDoc(", "setDoc(", "deleteDoc("]):
            # inspect function block
            fn_block = "\n".join(lines[max(0, i-5):min(len(lines), i+30)])
            if any(m in fn_block for m in ["POST", "PUT", "DELETE", "PATCH", "updateDoc", "setDoc", "deleteDoc"]):
                # Check if file interacts with user/ou/group/discipline/timetable data
                # but lacks invalidateClientCache or state refresh
                has_cache_inval = "invalidateClientCache" in fn_block
                has_state_refresh = any(r in fn_block for r in ["load", "fetch", "refresh", "setUsers", "setGroups", "setRecords", "setOus", "setRules", "router.refresh"])
                
                if not has_cache_inval and not has_state_refresh:
                    cat2_details.append({
                        "file": rel,
                        "line": i+1,
                        "code": line.strip(),
                        "reason": "서버/DB 변경(POST/PUT/DELETE/updateDoc) 완료 후 clientCache 무효화(invalidateClientCache) 및 데이터 재로드(refetch)가 누락되어 기존 캐시된 옛 값이 화면에 유지됨."
                    })

    # -------------------------------------------------------------
    # Category 3: Failure masked as success
    # -------------------------------------------------------------
    # 3.1 Fetch without res.ok / res.data.success check
    for i, line in enumerate(lines):
        if "fetch(" in line:
            block = "\n".join(lines[i:min(len(lines), i+25)])
            if any(msg in block for msg in ["alert(", "toast.success(", "setMessage", "setStatus", "성공", "완료", "저장되었습니다"]) and not any(check in block for check in ["res.ok", "response.ok", "data.success", "res.status === 200", "res.status == 200"]):
                cat3_details.append({
                    "file": rel,
                    "line": i+1,
                    "type": "Fetch 응답 검증 누락",
                    "code": line.strip(),
                    "reason": "fetch() 실행 후 response.ok 또는 data.success 상태를 검증하지 않고 즉시 성공 알림(alert/toast)을 표시함. HTTP 4xx/500 에러 발생 시에도 성공 메시지가 출력됨."
                })

    # 3.2 Loop/batch operation ignoring individual failures
    for i, line in enumerate(lines):
        if any(msg in line for msg in ["alert(", "toast.success(", "setMessage"]) and any(w in line for w in ["성공", "완료", "저장되었습니다", "처리되었습니다"]):
            block_before = "\n".join(lines[max(0, i-30):i])
            if any(loop in block_before for loop in ["for ", "forEach", "Promise.all", "batch", ".map("]) and any(err in block_before for err in ["catch", "failed", "errors", "failCount"]):
                if not any(check in block_before or check in line for check in ["failCount > 0", "failed.length > 0", "errors.length > 0", "fail", "실패"]):
                    cat3_details.append({
                        "file": rel,
                        "line": i+1,
                        "type": "일괄/루프 처리 부분 실패 은폐",
                        "code": line.strip(),
                        "reason": "여러 항목을 배치/루프 처리할 때 일부 항목에서 예외가 발생하더라도 전체 실패 건수를 알리지 않고 '성공적으로 처리되었습니다' 알림을 표시함."
                    })

print(f"\nDiscovered Cat 1: {len(cat1_details)}")
print(f"Discovered Cat 2: {len(cat2_details)}")
print(f"Discovered Cat 3: {len(cat3_details)}")

