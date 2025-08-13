#!/bin/bash
# EMERGENCY ROLLBACK SCRIPT - USE WITH CAUTION
# Backup ID: migration-2025-08-13T11-26-18-516Z

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP_DIR="$PROJECT_ROOT/backups/migration-2025-08-13T11-26-18-516Z"

echo "🚨 EMERGENCY ROLLBACK INITIATED"
echo "Backup: migration-2025-08-13T11-26-18-516Z"
echo "Target: $PROJECT_ROOT"
echo ""

# Confirmation prompt
read -p "This will overwrite current data. Continue? (yes/no): " -r
if [[ ! $REPLY =~ ^yes$ ]]; then
    echo "❌ Rollback cancelled"
    exit 1
fi

echo "📁 Creating pre-rollback backup..."
timestamp=$(date +%Y%m%d-%H%M%S)
mkdir -p "$PROJECT_ROOT/rollback-backup-$timestamp"
cp -r "$PROJECT_ROOT/leveldb" "$PROJECT_ROOT/rollback-backup-$timestamp/" 2>/dev/null || echo "No LevelDB to backup"
cp -r "$PROJECT_ROOT/deployments" "$PROJECT_ROOT/rollback-backup-$timestamp/" 2>/dev/null || echo "No deployments to backup"

echo "🔄 Restoring from backup..."
# Restore LevelDB
if [ -d "$BACKUP_DIR/leveldb/current" ]; then
    rm -rf "$PROJECT_ROOT/leveldb"
    cp -r "$BACKUP_DIR/leveldb/current" "$PROJECT_ROOT/leveldb"
    echo "✅ LevelDB restored"
fi

# Restore deployments
if [ -d "$BACKUP_DIR/legacy-json" ]; then
    cp "$BACKUP_DIR/legacy-json"/*.json "$PROJECT_ROOT/deployments/"
    echo "✅ Legacy JSON restored"
fi

# Restore unified
if [ -d "$BACKUP_DIR/unified-json/unified" ]; then
    rm -rf "$PROJECT_ROOT/deployments/unified"
    cp -r "$BACKUP_DIR/unified-json/unified" "$PROJECT_ROOT/deployments/"
    echo "✅ Unified JSON restored"
fi

echo "🔐 Verifying integrity..."
cd "$BACKUP_DIR"
if sha256sum -c checksums/SHA256SUMS > /dev/null 2>&1; then
    echo "✅ Backup integrity verified"
else
    echo "⚠️  Backup integrity check failed - proceed with caution"
fi

echo ""
echo "✅ Emergency rollback completed!"
echo "📋 Pre-rollback data saved to: rollback-backup-$timestamp"
echo "📖 See RESTORE_PROCEDURES.md for post-rollback steps"
