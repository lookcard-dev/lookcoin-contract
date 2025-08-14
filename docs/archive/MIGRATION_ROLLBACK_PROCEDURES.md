# LookCoin Migration Rollback Procedures
**Emergency Response and Data Recovery Guide**

## Document Overview

This document provides comprehensive rollback and recovery procedures for the LookCoin state management migration. It covers emergency rollback procedures for each migration phase, data recovery instructions, fallback mechanisms, and system restoration procedures.

**Classification**: CRITICAL OPERATIONAL PROCEDURES  
**Audience**: Technical team, incident response team, system administrators  
**Last Updated**: 2025-08-12  
**Version**: 1.0.0

## Emergency Response Overview

### When to Execute Rollback
**IMMEDIATE ROLLBACK TRIGGERS**:
- Data corruption or loss detected
- System functionality severely compromised  
- Performance degradation >50% from baseline
- Unable to deploy or access contracts
- Data inconsistency across networks >1%
- Critical errors in migration process

### Response Time Requirements
- **Emergency Assessment**: < 5 minutes
- **Rollback Decision**: < 10 minutes  
- **Rollback Execution**: < 30 minutes
- **System Verification**: < 60 minutes

### Team Activation
**Emergency Response Team**:
- **Incident Commander**: Technical Team Lead
- **Migration Engineer**: Primary migration executor  
- **Systems Engineer**: Infrastructure and backup systems
- **Communications Lead**: Stakeholder updates

---

## Table of Contents
- [Emergency Contacts and Escalation](#emergency-contacts-and-escalation)
- [Phase-Specific Rollback Procedures](#phase-specific-rollback-procedures)
- [Data Recovery Procedures](#data-recovery-procedures)
- [System Restoration Procedures](#system-restoration-procedures)
- [Fallback Mechanisms](#fallback-mechanisms)
- [Verification and Validation](#verification-and-validation)
- [Post-Rollback Analysis](#post-rollback-analysis)

---

## Emergency Contacts and Escalation

### Primary Emergency Contacts
```
EMERGENCY RESPONSE TEAM
├── Incident Commander: [Technical Team Lead]
│   Phone: [REDACTED]
│   Email: [REDACTED]
│   Slack: @technical-lead
├── Migration Engineer: [Primary Migration Engineer] 
│   Phone: [REDACTED]
│   Email: [REDACTED]
│   Slack: @migration-lead
├── Systems Engineer: [Infrastructure Lead]
│   Phone: [REDACTED]
│   Email: [REDACTED]  
│   Slack: @systems-lead
└── Communications Lead: [Engineering Manager]
    Phone: [REDACTED]
    Email: [REDACTED]
    Slack: @eng-manager
```

### Escalation Chain
1. **Level 1 (0-15 minutes)**: Technical Team
2. **Level 2 (15-30 minutes)**: Engineering Management
3. **Level 3 (30+ minutes)**: Executive Team
4. **Level 4 (1+ hour)**: CEO/CTO

### Communication Channels
- **Primary**: Slack #emergency-response
- **Secondary**: Emergency phone tree
- **Backup**: Email chain
- **External**: Status page updates

---

## Phase-Specific Rollback Procedures

### Phase 1: Pre-Migration Validation Rollback

**Risk Level**: Low (Read-only operations)  
**Rollback Complexity**: Minimal  
**Recovery Time**: < 5 minutes

#### When Phase 1 Rollback is Needed
- Test failures indicate system issues
- Data integrity problems discovered
- Performance baselines unacceptable  
- Team readiness issues

#### Phase 1 Rollback Steps
```bash
# 1. Stop all validation processes
pkill -f "npm run analyze"
pkill -f "npm run test:migration"

# 2. Reset any configuration changes  
git checkout HEAD -- hardhat.config.ts
git clean -fd

# 3. Verify system state unchanged
npm run verify:original-state
```

**Success Criteria**:
- All validation processes stopped
- System returned to original state
- No data changes made
- Original functionality intact

**Time Estimate**: 5 minutes

---

### Phase 2: Dual-Write Implementation Rollback

**Risk Level**: Medium  
**Rollback Complexity**: Moderate  
**Recovery Time**: < 15 minutes

#### When Phase 2 Rollback is Needed
- Dual-write mode causing data corruption
- Performance impact unacceptable (>50% degradation)
- Synchronization failures between backends
- System stability compromised

#### Phase 2 Rollback Steps
```bash
# 1. IMMEDIATE: Disable dual-write mode
export DUAL_WRITE_MODE=false
export FORCE_LEVELDB_ONLY=true

# 2. Restart state manager factory
npm run restart:state-manager

# 3. Verify LevelDB-only mode active
npm run verify:leveldb-only-mode

# 4. Test basic operations
npm run test:basic-operations

# 5. Clear any dual-write cache/locks
npm run clear:dual-write-cache
```

**Detailed Rollback Actions**:

1. **Immediate Configuration Rollback**:
```javascript
// In StateManagerFactory.ts - force LevelDB only
if (process.env.FORCE_LEVELDB_ONLY === 'true') {
  return new LevelDBStateManager(network);
}
```

2. **Clear Dual-Write State**:
```bash
# Remove dual-write configuration
rm -f .dual-write-config
rm -f /tmp/migration-*

# Reset environment variables
unset DUAL_WRITE_MODE
export STATE_BACKEND=leveldb
```

3. **Verify System Integrity**:
```bash
# Verify LevelDB access
npm run test:leveldb-access

# Test deployment operations
npm run test:deploy-basic

# Check for data corruption
npm run verify:data-integrity
```

**Success Criteria**:
- Dual-write mode completely disabled
- System operating in LevelDB-only mode
- Performance returned to baseline
- No data corruption detected
- All basic operations functional

**Time Estimate**: 15 minutes

---

### Phase 3: Data Migration Rollback

**Risk Level**: HIGH  
**Rollback Complexity**: Complex  
**Recovery Time**: < 60 minutes

#### When Phase 3 Rollback is Needed
- Data corruption during migration
- Bulk migration process failed
- Data consistency validation failed
- Critical contracts inaccessible

#### Phase 3 Emergency Rollback Steps

**IMMEDIATE ACTIONS (0-5 minutes)**:
```bash
# 1. STOP migration process immediately
pkill -f "npm run migrate:bulk"
killall node  # Kill all node processes

# 2. Disable dual-write mode
export DUAL_WRITE_MODE=false
export EMERGENCY_ROLLBACK=true

# 3. Force LevelDB-only mode
npm run emergency:force-leveldb-only
```

**DATA ASSESSMENT (5-15 minutes)**:
```bash
# 4. Assess data integrity
npm run emergency:assess-data-integrity

# 5. Check LevelDB consistency  
npm run verify:leveldb-integrity

# 6. Validate contract accessibility
npm run verify:contract-access-all-networks
```

**SYSTEM RESTORATION (15-45 minutes)**:
```bash
# 7. Restore from backup if needed
if [ "$LEVELDB_CORRUPTED" = "true" ]; then
  npm run restore:leveldb-backup
fi

# 8. Clean up partial JSON files
npm run cleanup:partial-migration

# 9. Reset state manager configuration
npm run reset:state-manager-config

# 10. Comprehensive system verification
npm run verify:full-system-rollback
```

**Detailed Recovery Actions**:

1. **Stop Migration Process**:
```bash
# Kill migration processes
ps aux | grep "migrate" | awk '{print $2}' | xargs kill -9

# Stop any background sync processes  
pkill -f "sync-backends"
```

2. **Data Corruption Assessment**:
```javascript
// Emergency data integrity check
const assessDataIntegrity = async () => {
  const leveldbManager = new LevelDBStateManager();
  const networks = ['bscmainnet', 'bsctestnet', 'basesepolia', 'optimismsepolia', 'sapphiretestnet'];
  
  for (const network of networks) {
    try {
      const contracts = await leveldbManager.getAllContracts(network);
      console.log(`${network}: ${contracts.length} contracts accessible`);
    } catch (error) {
      console.error(`${network}: DATA CORRUPTION DETECTED - ${error.message}`);
      return false;
    }
  }
  return true;
};
```

3. **Backup Restoration (if needed)**:
```bash
# Restore LevelDB from backup
if [ -d "leveldb.backup" ]; then
  rm -rf leveldb/
  cp -r leveldb.backup/ leveldb/
  echo "LevelDB restored from backup"
fi

# Verify backup integrity
npm run verify:backup-integrity
```

4. **Clean Partial Migration**:
```bash
# Remove partial JSON files
find deployments/ -name "*.json.partial" -delete
find deployments/ -name "*.json.tmp" -delete

# Remove migration state files
rm -f .migration-state
rm -f .migration-progress
```

**Success Criteria**:
- Migration process completely stopped
- System operating on LevelDB only
- All 28 contracts accessible via LevelDB
- No data corruption in LevelDB
- Basic deployment operations functional
- System performance returned to baseline

**Time Estimate**: 45-60 minutes

---

### Phase 4: JSON Backend Validation Rollback

**Risk Level**: Medium  
**Rollback Complexity**: Moderate  
**Recovery Time**: < 30 minutes

#### When Phase 4 Rollback is Needed
- JSON backend functionality failures
- Integration testing failures
- Performance requirements not met
- Critical edge cases failing

#### Phase 4 Rollback Steps
```bash
# 1. Disable JSON backend testing
export JSON_BACKEND_DISABLED=true

# 2. Return to dual-write mode (if safe)
if [ "$LEVELDB_INTACT" = "true" ]; then
  export DUAL_WRITE_MODE=true
fi

# 3. Verify LevelDB functionality
npm run verify:leveldb-full-functionality  

# 4. Test deployment operations
npm run test:deployment-operations

# 5. Clean up JSON test artifacts
npm run cleanup:json-test-artifacts
```

**Success Criteria**:
- JSON backend testing disabled
- LevelDB functionality verified
- Deployment operations working
- System stable in dual-write or LevelDB-only mode

**Time Estimate**: 30 minutes

---

### Phase 5: Final Cutover Rollback

**Risk Level**: CRITICAL  
**Rollback Complexity**: High  
**Recovery Time**: < 45 minutes

#### When Phase 5 Rollback is Needed
- JSON-only mode causing system failures
- Critical functionality broken after cutover
- Data accessibility issues
- Performance unacceptable in production

#### Phase 5 Emergency Rollback Steps

**IMMEDIATE ACTIONS (0-5 minutes)**:
```bash
# 1. EMERGENCY: Re-enable dual-write mode
export DUAL_WRITE_MODE=true
export JSON_BACKEND_DISABLED=true

# 2. Force LevelDB primary
export PRIMARY_BACKEND=leveldb

# 3. Restart state manager
npm run emergency:restart-state-manager
```

**SYSTEM VERIFICATION (5-30 minutes)**:
```bash
# 4. Verify LevelDB access
npm run verify:leveldb-primary-access

# 5. Test critical operations
npm run test:critical-operations

# 6. Validate all networks accessible  
npm run verify:all-networks-accessible

# 7. Performance check
npm run check:performance-baseline
```

**CLEANUP AND STABILIZATION (30-45 minutes)**:
```bash
# 8. Clean up JSON-only configuration
npm run cleanup:json-only-config

# 9. Restore dual-write stability
npm run stabilize:dual-write-mode

# 10. Full system verification
npm run verify:post-rollback-stability
```

**Success Criteria**:
- System operating on LevelDB (dual-write or primary)
- All critical operations functional
- All networks accessible
- Performance within acceptable ranges
- System stability restored

**Time Estimate**: 45 minutes

---

## Data Recovery Procedures

### Data Recovery Scenarios

#### Scenario 1: LevelDB Corruption
**Symptoms**: LevelDB read/write errors, corrupted data, missing contracts

**Recovery Steps**:
```bash
# 1. Assess corruption extent
npm run assess:leveldb-corruption

# 2. Attempt LevelDB repair
npm run repair:leveldb-database

# 3. If repair fails, restore from backup
npm run restore:leveldb-from-backup

# 4. Verify data integrity post-recovery
npm run verify:data-integrity-full
```

#### Scenario 2: JSON Files Corruption  
**Symptoms**: JSON parse errors, missing deployment files, invalid data

**Recovery Steps**:
```bash
# 1. Identify corrupted JSON files
npm run identify:corrupted-json

# 2. Restore from LevelDB source
npm run restore:json-from-leveldb

# 3. Validate restored JSON data
npm run validate:restored-json

# 4. Update JSON schema if needed
npm run update:json-schema
```

#### Scenario 3: Partial Migration Data Loss
**Symptoms**: Missing contracts, incomplete data, inconsistent state

**Recovery Steps**:
```bash
# 1. Stop all migration processes
npm run stop:all-migration-processes

# 2. Identify missing data
npm run identify:missing-data

# 3. Recover from LevelDB
npm run recover:missing-from-leveldb

# 4. Validate recovered data
npm run validate:recovered-data
```

### Backup and Restore Procedures

#### Creating Emergency Backups
```bash
# Create comprehensive backup
npm run backup:create-emergency-backup

# Backup includes:
# - Complete LevelDB directory
# - All JSON deployment files  
# - Configuration files
# - Migration state files
```

#### Restoring from Backups
```bash
# List available backups
npm run backup:list-available

# Restore specific backup
npm run backup:restore --backup-id=emergency-2025-08-12

# Verify backup integrity
npm run backup:verify-integrity
```

---

## System Restoration Procedures

### Complete System Restoration
When system requires complete restoration to known good state:

#### Step 1: Environment Reset
```bash
# 1. Stop all processes
npm run stop:all-processes

# 2. Clean environment
export CLEAN_SLATE=true
npm run clean:full-environment

# 3. Reset configuration
git checkout HEAD -- .env hardhat.config.ts

# 4. Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

#### Step 2: Data Restoration
```bash
# 5. Restore LevelDB from backup
npm run restore:leveldb-backup

# 6. Remove partial JSON files
npm run cleanup:partial-json-files

# 7. Reset state manager
npm run reset:state-manager-factory
```

#### Step 3: System Verification
```bash
# 8. Comprehensive verification
npm run verify:complete-system

# 9. Test all deployment operations
npm run test:all-deployment-scenarios

# 10. Performance verification
npm run verify:performance-baseline
```

### Service-Level Restoration
For partial system issues:

#### Configuration-Only Issues
```bash
# Reset configuration files
git checkout HEAD -- hardhat.config.ts scripts/utils/

# Clear configuration cache
npm run clear:config-cache

# Verify configuration
npm run verify:configuration
```

#### State Manager Issues
```bash
# Reset state manager factory
npm run reset:state-manager-factory

# Clear state manager cache
rm -rf /tmp/state-manager-*

# Reinitialize state managers
npm run init:state-managers
```

---

## Fallback Mechanisms

### Automatic Fallback Systems

#### Primary-Secondary Backend Fallback
```javascript
// Built-in fallback mechanism in StateManagerFactory
class StateManagerFactory {
  static async createManager(network: string): Promise<IStateManager> {
    try {
      // Primary: Try JSON backend
      if (shouldUseJSONBackend()) {
        const jsonManager = new JSONStateManager(network);
        await jsonManager.validateConnection();
        return jsonManager;
      }
    } catch (error) {
      console.warn('JSON backend failed, falling back to LevelDB:', error);
    }
    
    // Fallback: Use LevelDB
    return new LevelDBStateManager(network);
  }
}
```

#### Automatic Error Recovery
```javascript
// Automatic retry with fallback
const withFallback = async (operation, maxRetries = 3) => {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      if (attempt < maxRetries) {
        console.warn(`Attempt ${attempt} failed, retrying...`);
        await sleep(1000 * attempt); // Exponential backoff
      }
    }
  }
  
  throw new Error(`Operation failed after ${maxRetries} attempts: ${lastError.message}`);
};
```

### Manual Fallback Triggers
```bash
# Force LevelDB fallback
export FORCE_LEVELDB_FALLBACK=true

# Force specific backend
export FORCE_BACKEND=leveldb  # or 'json'

# Emergency mode (LevelDB only, no dual-write)
export EMERGENCY_MODE=true
```

---

## Verification and Validation

### Post-Rollback Verification Checklist

#### System Health Check
- [ ] All processes stopped cleanly
- [ ] Configuration restored to known good state
- [ ] Backend systems accessible
- [ ] No error logs indicating ongoing issues

#### Data Integrity Check
- [ ] All 28 contracts accessible
- [ ] Contract addresses match expected values
- [ ] Implementation hashes consistent
- [ ] No data corruption detected

#### Functionality Check
- [ ] Basic deployment operations work
- [ ] Cross-network operations functional
- [ ] All network configurations valid
- [ ] Error handling working correctly

#### Performance Check
- [ ] Response times within baseline ranges
- [ ] Memory usage normal
- [ ] No performance degradation
- [ ] Concurrent operations working

### Automated Verification Scripts
```bash
# Complete post-rollback verification
npm run verify:post-rollback:complete

# Data integrity verification
npm run verify:data-integrity:comprehensive

# Functionality verification
npm run verify:functionality:all

# Performance verification
npm run verify:performance:baseline
```

---

## Post-Rollback Analysis

### Incident Analysis Framework

#### Immediate Assessment (0-2 hours post-rollback)
1. **Root Cause Identification**
   - What triggered the rollback?
   - What went wrong in the migration process?
   - Were there warning signs missed?

2. **Impact Assessment**
   - Data integrity impact
   - System availability impact
   - Performance impact
   - User/stakeholder impact

3. **Response Effectiveness**
   - Was rollback executed within time requirements?
   - Were all procedures followed correctly?
   - What worked well in the response?
   - What could be improved?

#### Detailed Analysis (2-24 hours post-rollback)
1. **Technical Deep Dive**
   - Detailed log analysis
   - Performance data review
   - Code review of failed components
   - Infrastructure analysis

2. **Process Review**
   - Migration process effectiveness
   - Decision-making timeline
   - Communication effectiveness
   - Documentation accuracy

### Post-Incident Report Template
```markdown
# Migration Rollback Incident Report

## Executive Summary
- **Incident Date**: [Date/Time]
- **Rollback Trigger**: [Root cause]
- **Rollback Phase**: [Which phase]
- **Recovery Time**: [Duration]
- **Impact Level**: [High/Medium/Low]

## Timeline of Events
- [Time] - Initial issue detected
- [Time] - Rollback decision made
- [Time] - Rollback execution started
- [Time] - System restored
- [Time] - Verification completed

## Root Cause Analysis
[Detailed technical analysis]

## Impact Assessment  
[Data, system, performance impact]

## Response Effectiveness
[What worked, what didn't]

## Lessons Learned
[Key takeaways]

## Action Items
[Specific improvements to implement]

## Follow-up Actions
[Next steps and timeline]
```

### Continuous Improvement Process
1. **Document Lessons Learned**
2. **Update Rollback Procedures**
3. **Improve Migration Process**
4. **Enhance Monitoring/Alerting**
5. **Update Team Training**
6. **Review and Test Changes**

---

## Emergency Command Reference

### Critical Emergency Commands
```bash
# EMERGENCY STOP ALL MIGRATION
npm run emergency:stop-all-migration

# FORCE LEVELDB ONLY  
npm run emergency:force-leveldb-only

# ASSESS SYSTEM STATUS
npm run emergency:assess-system-status

# RESTORE FROM BACKUP
npm run emergency:restore-from-backup

# VERIFY SYSTEM HEALTH
npm run emergency:verify-system-health

# COMPLETE ROLLBACK
npm run emergency:complete-rollback
```

### Emergency Configuration
```bash
# Emergency environment variables
export EMERGENCY_MODE=true
export FORCE_LEVELDB_ONLY=true  
export DISABLE_JSON_BACKEND=true
export SKIP_VALIDATION=true
export ROLLBACK_IN_PROGRESS=true
```

---

**Document Classification**: CRITICAL  
**Access Level**: Emergency Response Team  
**Version**: 1.0.0  
**Last Updated**: 2025-08-12  
**Next Review**: Post-migration completion  
**Emergency Contact**: [Technical Team Lead] - [Phone Number]