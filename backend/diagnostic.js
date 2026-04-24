import * as sheetsAPI from './googleSheetsService.js';
import db from './db.js';

async function runDiagnostics() {
  console.log("=== STEP 1: GOOGLE SHEETS DATABASE AUDIT ===");
  
  try {
    const sheets = ['Users', 'activity logs', 'Japa', 'Elderly Care', 'Patient Care', 'Newborn Baby Care', 'Cook', 'Driver', 'Maid / Housekeeping'];
    
    for (const sheet of sheets) {
      console.log(`\nChecking sheet: ${sheet}`);
      try {
        const rows = await sheetsAPI.getSheetData(`${sheet}!A:U`);
        if (!rows || rows.length === 0) {
          console.log(`[FAIL] Sheet ${sheet} is empty or does not exist.`);
          continue;
        }
        
        const headers = rows[0];
        console.log(`[PASS] Headers found: ${headers.join(' | ')}`);
        console.log(`[PASS] Row count (including headers): ${rows.length}`);
        
        // Basic check on data
        let emptyRequired = 0;
        for (let i = 1; i < rows.length; i++) {
            // Check if essential columns are there depending on sheet
            if (sheet !== 'Users' && sheet !== 'activity logs') {
                if (!rows[i][1]) emptyRequired++; // Name is index 1
            } else if (sheet === 'Users') {
                if (!rows[i][0]) emptyRequired++; // Login ID
            }
        }
        
        if (emptyRequired > 0) {
            console.log(`[WARN] Found ${emptyRequired} rows with missing required fields (Name or Login ID).`);
        } else {
            console.log(`[PASS] No empty required fields detected.`);
        }

      } catch (err) {
        console.log(`[FAIL] Could not access sheet ${sheet}: ${err.message}`);
      }
    }

    console.log("\n=== STEP 5: GOOGLE SHEETS <-> BACKEND SYNC CHECK ===");
    // Test get filter options
    const filters = await db.getFilterOptions('all');
    if (filters && filters.state) {
        console.log(`[PASS] getFilterOptions successful. Found ${filters.state.length} unique states.`);
    } else {
        console.log(`[FAIL] getFilterOptions failed or returned empty.`);
    }

    // Test Search
    const searchRes = await db.applyFilters('all', { search: 'a' }, 1, 5);
    if (searchRes && searchRes.data) {
        console.log(`[PASS] applyFilters search successful. Found ${searchRes.total} total matching 'a'. Returning ${searchRes.data.length} rows.`);
    } else {
        console.log(`[FAIL] applyFilters search failed.`);
    }

  } catch (error) {
    console.error("[CRITICAL FAIL] Diagnostic script encountered an error:", error);
  }
}

runDiagnostics();
