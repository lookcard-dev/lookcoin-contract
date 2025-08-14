# Unified Schema Migration Plan

## Executive Summary

This document outlines the comprehensive plan to consolidate fragmented JSON deployment files into a single unified schema (v3.0.0) per network. This migration eliminates data fragmentation, reduces complexity, and provides a single source of truth for all deployment state.

**Migration Status**: Ready for Implementation  
**Risk Level**: Low (with rollback capability)  
**Estimated Duration**: 2-4 hours for all networks  
**Data Loss Risk**: Zero (automatic backups)

---

## Problem Statement

### Current Fragmentation Issues

The current deployment system suffers from severe fragmentation:

1. **Multiple Files Per Network**:
   - `bscmainnet.json` - Basic contract addresses and deployment info
   - `enhanced-bscmainnet.json` - Rich operational manifest with topology
   - `config-bscmainnet.json` - Cross-chain configuration status

2. **Data Duplication & Conflicts**:
   - Same data exists in multiple files with potential inconsistencies
   - Contract addresses duplicated across standard and enhanced files
   - Configuration spread between multiple sources

3. **Maintenance Complexity**:
   - JSONStateManager reads from fragmented sources
   - Validation scripts fail due to format mismatches
   - Difficult to understand complete deployment state

4. **Migration Challenges**:
   - LevelDB to JSON migration created additional file variants
   - No clear schema ownership or version control
   - Risk of data loss when updating multiple files

### Impact Analysis

- **Development Velocity**: Slowed by confusion over which file to update
- **Operational Risk**: Potential for inconsistent state across files
- **Debugging Difficulty**: Hard to trace issues across multiple files
- **Integration Complexity**: External tools must handle multiple formats

---

## Solution Architecture

### Unified Schema v3.0.0

The solution consolidates ALL deployment data into a single file per network with the following structure:

```typescript
UnifiedDeployment {
  // Schema versioning
  schemaVersion: '3.0.0'
  fileVersion: number  // Optimistic locking
  
  // Network identity
  network: string
  chainId: number
  networkTier: 'mainnet' | 'testnet' | 'dev'
  
  // Complete metadata
  metadata: {
    deployment info
    protocol status
    migration history
    data sources
  }
  
  // All contracts in one place
  contracts: {
    core: { LookCoin, SupplyOracle }
    protocol: { LayerZero, Celer, Hyperlane modules }
    infrastructure: { Router, FeeManager, etc }
    legacy: { name mappings }
  }
  
  // Full configuration
  configuration: {
    governance
    protocols (with remotes)
    security
    supplyOracle
  }
  
  // Network topology
  topology: {
    connectedChains
    tierValidation
    configurationStatus
  }
  
  // Verification & operations
  verification: { ... }
  operations: { ... }
  emergency: { ... }
}
```

### Key Benefits

1. **Single Source of Truth**: One file contains ALL deployment state
2. **Version Control**: Schema versioning and file versioning for updates
3. **Complete History**: Migration tracking and audit trails
4. **Extensibility**: Easy to add new fields without breaking compatibility
5. **Atomic Operations**: Single file updates eliminate partial state
6. **Clear Structure**: Logical organization of related data

---

## Migration Strategy

### Phase 1: Preparation (Pre-Migration)

**Duration**: 30 minutes  
**Risk**: None

1. **Backup Current State**:
   ```bash
   # Create full backup of deployments directory
   cp -r deployments/ deployments.backup.$(date +%Y%m%d-%H%M%S)/
   ```

2. **Validate Existing Data**:
   ```bash
   # Run validation on current files
   tsx scripts/migration/03-validate-migration.ts
   ```

3. **Review Migration Plan**:
   - Identify all networks with deployment files
   - Check for any custom modifications
   - Verify backup storage space

### Phase 2: Test Migration (Dry Run)

**Duration**: 15 minutes  
**Risk**: None

1. **Run Dry Migration**:
   ```bash
   # Test migration without writing files
   tsx scripts/migration/04-consolidate-to-unified.ts --all --dry-run --verbose
   ```

2. **Review Output**:
   - Check for any errors or warnings
   - Verify contract counts match expectations
   - Ensure all data sources are detected

### Phase 3: Execute Migration

**Duration**: 30 minutes  
**Risk**: Low (with rollback)

1. **Migrate Individual Network** (Recommended for first attempt):
   ```bash
   # Start with testnet
   tsx scripts/migration/04-consolidate-to-unified.ts --network bsctestnet
   
   # Verify the output
   cat deployments/unified/bsctestnet.unified.json | jq .schemaVersion
   ```

2. **Migrate All Networks**:
   ```bash
   # Run full migration with backups
   tsx scripts/migration/04-consolidate-to-unified.ts --all --verbose
   ```

3. **Output Structure**:
   ```
   deployments/
   ├── unified/                    # New unified files
   │   ├── bscmainnet.unified.json
   │   ├── bsctestnet.unified.json
   │   └── ...
   ├── backups/                    # Automatic backups
   │   └── backup-bscmainnet-2025-08-13T.../
   └── [original files remain]     # Not deleted
   ```

### Phase 4: Validation

**Duration**: 15 minutes  
**Risk**: None

1. **Validate Unified Files**:
   ```bash
   # Validate all unified files
   for file in deployments/unified/*.json; do
     echo "Validating $file..."
     tsx scripts/validate-unified-schema.ts --file "$file"
   done
   ```

2. **Cross-Check Data**:
   ```bash
   # Compare contract counts
   tsx scripts/migration/verify-consolidation.ts
   ```

3. **Test StateManager**:
   ```bash
   # Test UnifiedJSONStateManager
   tsx scripts/test-unified-manager.ts
   ```

### Phase 5: Integration

**Duration**: 1-2 hours  
**Risk**: Medium

1. **Update StateManagerFactory**:
   ```typescript
   // In StateManagerFactory.ts
   import UnifiedJSONStateManager from './UnifiedJSONStateManager';
   
   // Replace JSONStateManager with UnifiedJSONStateManager
   return new UnifiedJSONStateManager(config);
   ```

2. **Update Deployment Scripts**:
   - Modify deployment scripts to write unified format
   - Update configuration scripts to read from unified files
   - Ensure setup scripts use new structure

3. **Test Critical Operations**:
   ```bash
   # Test contract deployment (on testnet)
   npm run deploy:bsc-testnet -- --simple-mode
   
   # Test configuration
   npm run configure:bsc-testnet
   ```

### Phase 6: Cleanup (Optional)

**Duration**: 15 minutes  
**Risk**: Low

After successful validation and testing:

1. **Archive Old Files**:
   ```bash
   # Move fragmented files to archive
   mkdir -p deployments/archive/fragmented
   mv deployments/*.json deployments/archive/fragmented/
   # Keep unified files in deployments/unified/
   ```

2. **Update Documentation**:
   - Update README with new file structure
   - Document unified schema location
   - Update deployment guides

---

## Rollback Procedures

### Immediate Rollback

If issues are detected immediately after migration:

```bash
# Rollback specific network from backup
tsx scripts/migration/05-rollback-unified.ts --network bscmainnet --verify

# Rollback all networks
tsx scripts/migration/05-rollback-unified.ts --all --verify
```

### Rollback from Unified

If backups are unavailable but unified files exist:

```bash
# Split unified back to fragments
tsx scripts/migration/05-rollback-unified.ts --all --from-unified
```

### Manual Rollback

If automated rollback fails:

```bash
# Restore from manual backup
rm -rf deployments/*.json
cp deployments.backup.*/. deployments/
```

---

## Risk Assessment & Mitigation

### Risk Matrix

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Data Loss | Low | High | Automatic backups, dry run mode |
| Format Errors | Low | Medium | Schema validation, type checking |
| Integration Issues | Medium | Medium | Gradual rollout, testing |
| Performance Impact | Low | Low | Caching, optimized reads |
| Rollback Failure | Very Low | High | Multiple rollback methods |

### Mitigation Strategies

1. **Automatic Backups**: Every migration creates timestamped backups
2. **Dry Run Mode**: Test migrations without writing files
3. **Validation**: Comprehensive validation at every step
4. **Gradual Rollout**: Migrate one network at a time if preferred
5. **Rollback Tools**: Multiple rollback methods available
6. **Version Control**: Git tracking of all changes

---

## Success Metrics

### Immediate Success Indicators

- ✅ All networks successfully migrated
- ✅ Zero data loss (validated by comparison)
- ✅ All contracts accounted for
- ✅ Validation passes without errors
- ✅ StateManager reads unified files correctly

### Long-term Success Metrics

- 📈 Reduced deployment script complexity
- 📈 Faster configuration operations
- 📈 Fewer deployment-related issues
- 📈 Improved developer experience
- 📈 Easier integration with external tools

---

## Implementation Checklist

### Pre-Migration

- [ ] Review this migration plan
- [ ] Create manual backup of deployments/
- [ ] Notify team of migration window
- [ ] Ensure sufficient disk space
- [ ] Stop any active deployment operations

### Migration Execution

- [ ] Run dry migration for all networks
- [ ] Review dry run output
- [ ] Execute migration for testnet first
- [ ] Validate testnet migration
- [ ] Execute migration for remaining networks
- [ ] Validate all migrations

### Post-Migration

- [ ] Run comprehensive validation
- [ ] Test StateManager operations
- [ ] Update deployment scripts
- [ ] Test critical operations on testnet
- [ ] Document any issues or learnings
- [ ] Archive old files (after confidence period)

### Rollback (if needed)

- [ ] Identify issue requiring rollback
- [ ] Choose appropriate rollback method
- [ ] Execute rollback
- [ ] Verify data integrity
- [ ] Document issue for resolution

---

## Command Reference

### Migration Commands

```bash
# Dry run (no changes)
tsx scripts/migration/04-consolidate-to-unified.ts --all --dry-run

# Migrate single network
tsx scripts/migration/04-consolidate-to-unified.ts --network bscmainnet

# Migrate all networks
tsx scripts/migration/04-consolidate-to-unified.ts --all

# Migrate with verbose output
tsx scripts/migration/04-consolidate-to-unified.ts --all --verbose

# Migrate without backup (not recommended)
tsx scripts/migration/04-consolidate-to-unified.ts --all --no-backup
```

### Rollback Commands

```bash
# Rollback from backup
tsx scripts/migration/05-rollback-unified.ts --network bscmainnet

# Rollback all from backup
tsx scripts/migration/05-rollback-unified.ts --all

# Split unified back to fragments
tsx scripts/migration/05-rollback-unified.ts --all --from-unified

# Rollback with verification
tsx scripts/migration/05-rollback-unified.ts --all --verify

# Dry run rollback
tsx scripts/migration/05-rollback-unified.ts --all --dry-run
```

### Validation Commands

```bash
# Validate unified schema
tsx scripts/validate-unified-schema.ts --file deployments/unified/bscmainnet.unified.json

# Validate all unified files
tsx scripts/validate-unified-schema.ts --directory deployments/unified

# Compare before/after migration
tsx scripts/migration/verify-consolidation.ts
```

---

## Support & Troubleshooting

### Common Issues

1. **"No deployment files found"**
   - Ensure you're in the correct directory
   - Check that deployment files exist

2. **"Validation failed"**
   - Review validation errors in output
   - Check for data corruption in source files
   - Try migrating with --verbose flag

3. **"Permission denied"**
   - Ensure write permissions on deployments/
   - Check disk space availability

4. **"Rollback failed"**
   - Try alternative rollback method
   - Use manual backup restoration
   - Check backup directory exists

### Debug Mode

Enable debug output for detailed logs:

```bash
DEBUG_DEPLOYMENT=true tsx scripts/migration/04-consolidate-to-unified.ts --all --verbose
```

### Getting Help

1. Review error messages carefully
2. Check backup files in deployments/backups/
3. Consult migration logs in console output
4. Test with a single network first
5. Use dry-run mode to preview changes

---

## Conclusion

This migration plan provides a safe, comprehensive approach to consolidating fragmented deployment files into a unified schema. With automatic backups, validation, and rollback capabilities, the risk of data loss is minimal. The unified schema will significantly improve the maintainability and reliability of the deployment system.

**Recommended Approach**: Start with testnet migration, validate thoroughly, then proceed with mainnet networks.

**Expected Outcome**: Single source of truth for all deployment state, improved developer experience, and reduced operational complexity.