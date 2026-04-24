import os
import json
import logging
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')

# You MUST pip install google-api-python-client google-auth-httplib2 google-auth-oauthlib before running
# Load environment variables
from dotenv import load_dotenv
load_dotenv()

SPREADSHEET_ID = os.getenv("SPREADSHEET_ID")
SERVICE_ACCOUNT_FILE = os.getenv("GOOGLE_SERVICE_ACCOUNT_PATH")

if not SPREADSHEET_ID or not SERVICE_ACCOUNT_FILE:
    logging.error("Missing SPREADSHEET_ID or GOOGLE_SERVICE_ACCOUNT_PATH in .env")
    exit(1)

def main():
    print("========================================")
    print("🚀 HRMSLite Google Sheets Database Audit")
    print("========================================")

    try:
        # Authenticate
        credentials = Credentials.from_service_account_file(
            SERVICE_ACCOUNT_FILE, 
            scopes=['https://www.googleapis.com/auth/spreadsheets']
        )
        service = build('sheets', 'v4', credentials=credentials)
        sheet_service = service.spreadsheets()

        # Get all sheets
        metadata = sheet_service.get(spreadsheetId=SPREADSHEET_ID).execute()
        sheets = metadata.get('sheets', [])
        
        print(f"✅ Successfully authenticated.")
        print(f"📄 Found {len(sheets)} sheets in document.\n")

        total_candidates = 0
        issues_found = []

        for sheet in sheets:
            title = sheet['properties']['title']
            
            # Read all data from sheet
            result = sheet_service.values().get(
                spreadsheetId=SPREADSHEET_ID, 
                range=f"'{title}'!A:Z"
            ).execute()
            
            values = result.get('values', [])
            if not values:
                print(f"⚠️ {title}: EMPTY SHEET")
                continue
                
            headers = values[0]
            row_count = len(values) - 1
            print(f"📊 {title}: {row_count} rows, {len(headers)} columns")
            
            if title in ['Users', 'ActivityLog', 'Sheet8']:
                continue # Skip non-candidate sheets
                
            total_candidates += row_count
            
            # Audit columns and rows
            sr_no_idx = -1
            mobile_idx = -1
            name_idx = -1
            
            try:
                sr_no_idx = headers.index('Sr.')
                mobile_idx = headers.index('Mobile No')
                name_idx = headers.index('Name')
            except ValueError:
                issues_found.append(f"{title}: Missing critical columns (Sr., Mobile No, or Name)")
                
            mobiles = set()
            sr_nos = set()
            
            for i, row in enumerate(values[1:], start=2):
                # Check for malformed data
                if len(row) < len(headers):
                    # Pad with empty strings
                    row.extend([''] * (len(headers) - len(row)))
                    
                if sr_no_idx != -1:
                    sr = row[sr_no_idx]
                    if not sr:
                        issues_found.append(f"{title} (Row {i}): Missing Sr. No")
                    elif sr in sr_nos:
                        issues_found.append(f"{title} (Row {i}): Duplicate Sr. No ({sr})")
                    else:
                        sr_nos.add(sr)
                        
                if mobile_idx != -1:
                    mobile = row[mobile_idx]
                    if not mobile:
                        issues_found.append(f"{title} (Row {i}): Missing Mobile No")
                    elif mobile in mobiles:
                        issues_found.append(f"{title} (Row {i}): Duplicate Mobile No ({mobile})")
                    else:
                        mobiles.add(mobile)

        print("\n========================================")
        print("🔍 AUDIT RESULTS")
        print("========================================")
        print(f"Total Candidate Records: {total_candidates}")
        
        if issues_found:
            print(f"⚠️ Found {len(issues_found)} issues:")
            for issue in issues_found[:20]: # Print top 20
                print(f"  - {issue}")
            if len(issues_found) > 20:
                print(f"  ... and {len(issues_found) - 20} more.")
        else:
            print("✅ Database is healthy. No structural issues found.")

    except Exception as e:
        logging.error(f"Audit failed: {e}")

if __name__ == '__main__':
    main()
