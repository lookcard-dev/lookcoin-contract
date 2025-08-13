#!/bin/bash
# Generated Rollback Script for Migration Cleanup
# Generated at: 2025-08-13T11:35:57.898Z

set -e
echo "🔄 Starting rollback of migration cleanup..."

# Note: /Users/mike/Workplace/LookCard/lookcoin-contract/tsconfig.json was modified - manual review required
# Note: /Users/mike/Workplace/LookCard/lookcoin-contract/.gitignore was modified - manual review required
# Note: /Users/mike/Workplace/LookCard/lookcoin-contract/leveldb-unified-comparison-2025-08-13T10-59-54-229Z.json was removed - restore from backup if needed
# Note: /Users/mike/Workplace/LookCard/lookcoin-contract/leveldb-unified-comparison-2025-08-13T10-59-29-728Z.json was removed - restore from backup if needed
# Note: /Users/mike/Workplace/LookCard/lookcoin-contract/leveldb-unified-comparison-2025-08-13T10-58-23-589Z.json was removed - restore from backup if needed
# Note: /Users/mike/Workplace/LookCard/lookcoin-contract/leveldb-unified-comparison-2025-08-13T10-58-11-797Z.json was removed - restore from backup if needed
# Note: /Users/mike/Workplace/LookCard/lookcoin-contract/leveldb-unified-comparison-2025-08-13T10-57-52-348Z.json was removed - restore from backup if needed
# Note: /Users/mike/Workplace/LookCard/lookcoin-contract/leveldb-unified-comparison-2025-08-13T10-56-40-938Z.json was removed - restore from backup if needed
# Note: /Users/mike/Workplace/LookCard/lookcoin-contract/leveldb-inventory.json was removed - restore from backup if needed
# Note: /Users/mike/Workplace/LookCard/lookcoin-contract/leveldb-data-integrity-report.md was removed - restore from backup if needed
# Note: /Users/mike/Workplace/LookCard/lookcoin-contract/leveldb-backup/leveldb-export-2025-08-13T06-48-38-098Z.json was removed - restore from backup if needed
# Note: /Users/mike/Workplace/LookCard/lookcoin-contract/leveldb-analysis-report-1754996362937.json was removed - restore from backup if needed
# Note: /Users/mike/Workplace/LookCard/lookcoin-contract/backups/migration-2025-08-13T11-26-18-516Z/leveldb/previous-exports/leveldb-export-2025-08-13T06-48-38-098Z.json was removed - restore from backup if needed
# Note: /Users/mike/Workplace/LookCard/lookcoin-contract/backups/migration-2025-08-13T11-26-18-516Z/leveldb/leveldb-inventory.json was removed - restore from backup if needed
# Note: /Users/mike/Workplace/LookCard/lookcoin-contract/backups/migration-2025-08-13T11-26-18-516Z/leveldb/leveldb-data-integrity-report.md was removed - restore from backup if needed
# Note: /Users/mike/Workplace/LookCard/lookcoin-contract/leveldb-inventory.json was removed - restore from backup if needed
# Note: /Users/mike/Workplace/LookCard/lookcoin-contract/leveldb-data-integrity-report.md was removed - restore from backup if needed
# Note: /Users/mike/Workplace/LookCard/lookcoin-contract/leveldb-backup was removed - restore from backup if needed
# Note: /Users/mike/Workplace/LookCard/lookcoin-contract/leveldb was removed - restore from backup if needed
# Note: /Users/mike/Workplace/LookCard/lookcoin-contract/scripts/utils/LevelDBStateManager.ts was removed - restore from backup if needed
# Note: /Users/mike/Workplace/LookCard/lookcoin-contract/scripts/utils/StateManagerFactory.ts was modified - manual review required
# Note: /Users/mike/Workplace/LookCard/lookcoin-contract/package.json was modified - manual review required
# Restore enhanced-bscmainnet.json
cp "/Users/mike/Workplace/LookCard/lookcoin-contract/deployments/archive/enhanced-json/enhanced-bscmainnet.json" "/Users/mike/Workplace/LookCard/lookcoin-contract/deployments/enhanced-bscmainnet.json"
rm "/Users/mike/Workplace/LookCard/lookcoin-contract/deployments/archive/enhanced-json/enhanced-bscmainnet.json"
# Restore config-optimismsepolia.json
cp "/Users/mike/Workplace/LookCard/lookcoin-contract/deployments/archive/legacy-json/config-optimismsepolia.json" "/Users/mike/Workplace/LookCard/lookcoin-contract/deployments/config-optimismsepolia.json"
rm "/Users/mike/Workplace/LookCard/lookcoin-contract/deployments/archive/legacy-json/config-optimismsepolia.json"
# Restore config-bsctestnet.json
cp "/Users/mike/Workplace/LookCard/lookcoin-contract/deployments/archive/legacy-json/config-bsctestnet.json" "/Users/mike/Workplace/LookCard/lookcoin-contract/deployments/config-bsctestnet.json"
rm "/Users/mike/Workplace/LookCard/lookcoin-contract/deployments/archive/legacy-json/config-bsctestnet.json"
# Restore config-basesepolia.json
cp "/Users/mike/Workplace/LookCard/lookcoin-contract/deployments/archive/legacy-json/config-basesepolia.json" "/Users/mike/Workplace/LookCard/lookcoin-contract/deployments/config-basesepolia.json"
rm "/Users/mike/Workplace/LookCard/lookcoin-contract/deployments/archive/legacy-json/config-basesepolia.json"
# Restore sapphiretestnet.json
cp "/Users/mike/Workplace/LookCard/lookcoin-contract/deployments/archive/legacy-json/sapphiretestnet.json" "/Users/mike/Workplace/LookCard/lookcoin-contract/deployments/sapphiretestnet.json"
rm "/Users/mike/Workplace/LookCard/lookcoin-contract/deployments/archive/legacy-json/sapphiretestnet.json"
# Restore sapphiremainnet.json
cp "/Users/mike/Workplace/LookCard/lookcoin-contract/deployments/archive/legacy-json/sapphiremainnet.json" "/Users/mike/Workplace/LookCard/lookcoin-contract/deployments/sapphiremainnet.json"
rm "/Users/mike/Workplace/LookCard/lookcoin-contract/deployments/archive/legacy-json/sapphiremainnet.json"
# Restore optimismsepolia.json
cp "/Users/mike/Workplace/LookCard/lookcoin-contract/deployments/archive/legacy-json/optimismsepolia.json" "/Users/mike/Workplace/LookCard/lookcoin-contract/deployments/optimismsepolia.json"
rm "/Users/mike/Workplace/LookCard/lookcoin-contract/deployments/archive/legacy-json/optimismsepolia.json"
# Restore bsctestnet.json
cp "/Users/mike/Workplace/LookCard/lookcoin-contract/deployments/archive/legacy-json/bsctestnet.json" "/Users/mike/Workplace/LookCard/lookcoin-contract/deployments/bsctestnet.json"
rm "/Users/mike/Workplace/LookCard/lookcoin-contract/deployments/archive/legacy-json/bsctestnet.json"
# Restore bscmainnet.json
cp "/Users/mike/Workplace/LookCard/lookcoin-contract/deployments/archive/legacy-json/bscmainnet.json" "/Users/mike/Workplace/LookCard/lookcoin-contract/deployments/bscmainnet.json"
rm "/Users/mike/Workplace/LookCard/lookcoin-contract/deployments/archive/legacy-json/bscmainnet.json"
# Restore basesepolia.json
cp "/Users/mike/Workplace/LookCard/lookcoin-contract/deployments/archive/legacy-json/basesepolia.json" "/Users/mike/Workplace/LookCard/lookcoin-contract/deployments/basesepolia.json"
rm "/Users/mike/Workplace/LookCard/lookcoin-contract/deployments/archive/legacy-json/basesepolia.json"

echo "✅ Rollback completed - manual verification recommended"