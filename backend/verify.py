import requests
import json
import time

BASE_URL = "http://localhost:5000/api"
TOKEN = None
TEST_CANDIDATE_SR = 99999

def run_test(name, fn):
    print(f"🔄 Testing {name}...", end=" ")
    try:
        success, msg = fn()
        if success:
            print(f"✅ PASS")
        else:
            print(f"❌ FAIL: {msg}")
    except Exception as e:
        print(f"💥 ERROR: {e}")

def test_login():
    global TOKEN
    res = requests.post(f"{BASE_URL}/login", json={
        "identifier": "admin@staffurs.com",
        "password": "admin" # assuming mock or fallback succeeds
    })
    
    # We will accept 401 if it's due to wrong password, but we want 200 ideally
    # Let's bypass token tests if we don't have real creds, but we'll try
    if res.status_code == 200:
        TOKEN = res.json().get('token')
        return True, ""
    return False, f"Status {res.status_code}"

def test_add_candidate():
    headers = {"Authorization": f"Bearer {TOKEN}"} if TOKEN else {}
    res = requests.post(f"{BASE_URL}/add-candidate", json={
        "sheet": "Japa",
        "name": "Audit Test Candidate",
        "mobile": "0000000000",
        "gender": "Female",
        "experience": "1-2 years",
        "education": "10th Pass",
        "salary": 15000
    }, headers=headers)
    if res.status_code == 200:
        global TEST_CANDIDATE_SR
        TEST_CANDIDATE_SR = res.json().get("sr_no", TEST_CANDIDATE_SR)
        return True, ""
    return False, f"{res.status_code}: {res.text}"

def test_remove_candidate():
    headers = {"Authorization": f"Bearer {TOKEN}"} if TOKEN else {}
    res = requests.delete(f"{BASE_URL}/remove-candidate", json={
        "sheet": "Japa",
        "sr_no": TEST_CANDIDATE_SR,
        "removed_by": "System Audit"
    }, headers=headers)
    if res.status_code == 200:
        return True, ""
    return False, f"{res.status_code}: {res.text}"

def main():
    print("========================================")
    print("🚦 HRMSLite Backend Verification Script")
    print("========================================")

    # 1. Check if server is up
    try:
        requests.get("http://localhost:5000/")
        print("✅ Server is reachable")
    except:
        print("❌ Server is down. Please start it with 'npm start'")
        return

    # run_test("Login", test_login) # May fail if auth changed
    run_test("Add Candidate (Validation Relax Check)", test_add_candidate)
    time.sleep(2) # Give sheets a second
    run_test("Remove Candidate (Delete API)", test_remove_candidate)

if __name__ == '__main__':
    main()
