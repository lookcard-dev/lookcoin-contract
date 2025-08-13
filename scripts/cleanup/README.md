# Migration Cleanup Scripts

This directory contains scripts to safely complete the migration from LevelDB to Unified JSON deployment format.

## Overview

The migration cleanup process consists of three main components:

1. **System Validation** - Ensures unified system is working properly
2. **Cleanup Finalization** - Archives legacy files and removes LevelDB dependencies  
3. **Orchestration** - Coordinates the complete cleanup process

## Scripts

### 1. `validate-unified-system.ts`

Validates that the unified JSON deployment system is working correctly before cleanup.

**Usage:**
```bash
tsx scripts/cleanup/validate-unified-system.ts
```

**Checks:**
- ✅ Unified deployment directory exists
- ✅ Unified JSON files are present and valid
- ✅ File integrity and structure
- ✅ Backup system is operational
- ✅ Contract data is valid
- ✅ Dependencies are available

### 2. `finalize-migration-cleanup.ts` 

Core cleanup script that safely archives legacy files and removes LevelDB dependencies.

**Usage:**
```bash
# Dry run (recommended first)
tsx scripts/cleanup/finalize-migration-cleanup.ts --dry-run

# Full cleanup
tsx scripts/cleanup/finalize-migration-cleanup.ts

# With options
tsx scripts/cleanup/finalize-migration-cleanup.ts --preserve-analysis --force
```

**Operations:**
1. 📋 Validates system state and backups
2. 📁 Creates archive directory structure
3. 📦 Archives legacy deployment files
4. 📦 Removes LevelDB package dependencies
5. 🔧 Cleans up LevelDB code references
6. 🗂️ Removes LevelDB directories
7. ⚙️ Updates configuration files
8. 🔍 Performs final verification

**Options:**
- `--dry-run` - Preview changes without applying them
- `--skip-backup-validation` - Skip backup system validation
- `--preserve-analysis` - Keep LevelDB analysis files
- `--force` - Proceed even with validation failures
- `--quiet` - Suppress verbose output

### 3. `run-migration-cleanup.ts`

Orchestration script that runs validation and cleanup in the proper sequence.

**Usage:**
```bash
# Recommended: Start with dry run
tsx scripts/cleanup/run-migration-cleanup.ts --dry-run

# Full orchestrated cleanup
tsx scripts/cleanup/run-migration-cleanup.ts

# Skip validation (not recommended)
tsx scripts/cleanup/run-migration-cleanup.ts --skip-validation --force
```

**Options:**
- `--dry-run` - Preview entire process
- `--skip-validation` - Skip unified system validation
- `--preserve-analysis` - Keep analysis files  
- `--force` - Proceed despite validation failures
- `--quiet` - Minimal output
- `--help` - Show detailed help

## Recommended Workflow

### Phase 1: Validation and Testing

```bash
# 1. Validate unified system
tsx scripts/cleanup/validate-unified-system.ts

# 2. Preview full cleanup process
tsx scripts/cleanup/run-migration-cleanup.ts --dry-run

# 3. Test specific operations
tsx scripts/cleanup/finalize-migration-cleanup.ts --dry-run --preserve-analysis
```

### Phase 2: Execute Cleanup

```bash
# Full cleanup with all safety checks
tsx scripts/cleanup/run-migration-cleanup.ts
```

### Phase 3: Verification

```bash
# Verify unified system still works
npm run deploy:bsc-testnet --dry-run
npm run configure:bsc-testnet --dry-run

# Check final state
ls -la deployments/
ls -la deployments/unified/
ls -la deployments/archive/
```

## Safety Features

### Backup Validation
- ✅ Verifies backup system exists and is complete
- ✅ Validates backup integrity before proceeding
- ✅ Ensures rollback capability is available

### Atomic Operations
- ✅ All file operations are atomic
- ✅ Comprehensive error handling and rollback
- ✅ Detailed operation logging

### Dry Run Mode
- ✅ Preview all operations without changes
- ✅ Validate system state and dependencies
- ✅ Test cleanup logic safely

### Rollback Support
- ✅ Automatic rollback script generation
- ✅ Emergency recovery procedures
- ✅ Detailed operation audit trail

## Directory Structure After Cleanup

```
deployments/
├── unified/                    # Active unified deployment files
│   ├── bscmainnet.unified.json
│   ├── bsctestnet.unified.json
│   ├── basesepolia.unified.json
│   ├── optimismsepolia.unified.json
│   └── sapphiremainnet.unified.json
├── backups/                    # Deployment file backups
│   └── backup-*-*/
├── archive/                    # NEW - Legacy files archive
│   ├── legacy-json/
│   │   ├── ARCHIVE_README.md
│   │   ├── basesepolia.json
│   │   ├── bscmainnet.json
│   │   ├── bsctestnet.json
│   │   ├── optimismsepolia.json
│   │   ├── sapphiremainnet.json
│   │   ├── config-basesepolia.json
│   │   ├── config-bsctestnet.json
│   │   └── config-optimismsepolia.json
│   └── enhanced-json/
│       └── enhanced-bscmainnet.json
└── users/                      # User-specific configs (preserved)
```

## Files Removed

### LevelDB Components
- ❌ `leveldb/` directory
- ❌ `leveldb-backup/` directory  
- ❌ `scripts/utils/LevelDBStateManager.ts`
- ❌ LevelDB analysis files (unless `--preserve-analysis`)

### Package Dependencies
- ❌ `"level": "^10.0.0"` from package.json
- ❌ Other LevelDB-related dependencies

### Code References
- ❌ LevelDB imports in StateManagerFactory.ts
- ❌ LevelDB backend support in factory methods
- ❌ LevelDB configuration options

## Error Recovery

### If Cleanup Fails
1. Check generated rollback script: `cleanup-rollback-*.sh`
2. Review operation log and error messages
3. Restore from backup if needed: see `backups/migration-*/RESTORE_PROCEDURES.md`

### If System Issues After Cleanup
1. Verify unified system: `tsx scripts/cleanup/validate-unified-system.ts`
2. Test deployment scripts: `npm run deploy:bsc-testnet --dry-run`
3. Rollback if necessary using backup procedures

## Important Notes

### Before Running Cleanup
- ✅ Ensure all team members are aware of the changes
- ✅ Verify unified system is working correctly
- ✅ Complete any pending deployments using current system
- ✅ Have backup restoration procedure ready

### After Cleanup
- ✅ Update CI/CD pipelines to use `deployments/unified/`
- ✅ Update team documentation and procedures
- ✅ Test all deployment scripts with new format
- ✅ Archive cleanup scripts after verification period

### Disk Space
- 📦 Legacy files are archived, not deleted (for safety)
- 🗑️ LevelDB directories are removed (saves ~50-100MB)
- 📊 Analysis files can be preserved or removed (saves ~10-20MB)

## Support

For questions or issues with the cleanup process:

1. Check the generated reports: `cleanup-report-*.json`
2. Review backup system: `backups/migration-*/`
3. Consult migration documentation: `docs/MIGRATION_*.md`
4. Use dry-run mode to test operations safely

## Migration Status

This cleanup represents the final phase of the LevelDB to Unified JSON migration:

- ✅ **Phase 1**: LevelDB data exported and migrated
- ✅ **Phase 2**: Unified JSON system implemented and tested  
- ✅ **Phase 3**: System validation and integrity checks
- 🚀 **Phase 4**: Legacy cleanup and finalization ← **YOU ARE HERE**

After successful cleanup, the migration will be complete and the system will run entirely on the unified JSON format.