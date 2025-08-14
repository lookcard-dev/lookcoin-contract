#!/bin/bash

# Comprehensive JavaScript/TypeScript Error Detection Script
# Detects: Type errors, syntax errors, code quality issues, potential bugs

echo "🔍 Comprehensive JavaScript/TypeScript Validation"
echo "================================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

ERRORS=0

# 1. TypeScript Compiler - Type & Syntax Errors
echo -e "\n${BLUE}1. TypeScript Compiler (tsc) - Type & Syntax Errors${NC}"
echo "---------------------------------------------------"
if npx tsc --noEmit --target es2020; then
    echo -e "${GREEN}✅ TypeScript compilation: PASSED${NC}"
else
    echo -e "${RED}❌ TypeScript compilation: FAILED${NC}"
    ((ERRORS++))
fi

# 2. ESLint - Code Quality & Style (Modern replacement for TSLint)
echo -e "\n${BLUE}2. ESLint - Code Quality & Best Practices${NC}"
echo "-------------------------------------------"
if npx eslint "**/*.{js,ts}" --ignore-pattern node_modules --ignore-pattern typechain-types; then
    echo -e "${GREEN}✅ ESLint validation: PASSED${NC}"
else
    echo -e "${YELLOW}⚠️  ESLint found issues (see above)${NC}"
    ((ERRORS++))
fi

# 3. JavaScript Syntax Check (Node.js built-in)
echo -e "\n${BLUE}3. JavaScript Syntax Validation${NC}"
echo "-------------------------------"
JS_SYNTAX_ERRORS=0

# Find all JS/TS files and check syntax
while IFS= read -r -d '' file; do
    if [[ "$file" == *.js ]]; then
        if ! node --check "$file" 2>/dev/null; then
            echo -e "${RED}❌ Syntax error in: $file${NC}"
            ((JS_SYNTAX_ERRORS++))
        fi
    fi
done < <(find . -name "*.js" -not -path "./node_modules/*" -not -path "./typechain-types/*" -print0)

if [ $JS_SYNTAX_ERRORS -eq 0 ]; then
    echo -e "${GREEN}✅ JavaScript syntax: PASSED${NC}"
else
    echo -e "${RED}❌ JavaScript syntax: $JS_SYNTAX_ERRORS files failed${NC}"
    ((ERRORS++))
fi

# 4. Import/Export Consistency Check
echo -e "\n${BLUE}4. Import/Export Consistency${NC}"
echo "----------------------------"
MIXED_IMPORTS=0

# Check for mixed require/import usage in TypeScript files
while IFS= read -r -d '' file; do
    if [[ "$file" == *.ts ]]; then
        HAS_REQUIRE=$(grep -l "require(" "$file" 2>/dev/null || true)
        HAS_IMPORT=$(grep -l "^import\|^\s*import" "$file" 2>/dev/null || true)
        
        if [[ -n "$HAS_REQUIRE" && -n "$HAS_IMPORT" ]]; then
            echo -e "${YELLOW}⚠️  Mixed require/import in: $file${NC}"
            ((MIXED_IMPORTS++))
        fi
    fi
done < <(find . -name "*.ts" -not -path "./node_modules/*" -not -path "./typechain-types/*" -print0)

if [ $MIXED_IMPORTS -eq 0 ]; then
    echo -e "${GREEN}✅ Import/Export consistency: PASSED${NC}"
else
    echo -e "${YELLOW}⚠️  Mixed import patterns: $MIXED_IMPORTS files${NC}"
fi

# 5. Dead Code Detection
echo -e "\n${BLUE}5. Dead Code Detection${NC}"
echo "---------------------"
DEAD_CODE_ISSUES=0

# Check for TODO/FIXME comments
TODO_COUNT=$(grep -r "TODO\|FIXME\|XXX\|HACK" . --include="*.ts" --include="*.js" --exclude-dir=node_modules --exclude-dir=typechain-types | wc -l)
if [ "$TODO_COUNT" -gt 0 ]; then
    echo -e "${YELLOW}⚠️  Found $TODO_COUNT TODO/FIXME comments${NC}"
    ((DEAD_CODE_ISSUES++))
fi

# Check for console.log statements (potential debugging leftovers)
DEBUG_COUNT=$(grep -r "console\.log\|console\.debug" . --include="*.ts" --include="*.js" --exclude-dir=node_modules --exclude-dir=typechain-types | wc -l)
if [ "$DEBUG_COUNT" -gt 0 ]; then
    echo -e "${YELLOW}⚠️  Found $DEBUG_COUNT console.log/debug statements${NC}"
    ((DEAD_CODE_ISSUES++))
fi

if [ $DEAD_CODE_ISSUES -eq 0 ]; then
    echo -e "${GREEN}✅ Dead code detection: PASSED${NC}"
else
    echo -e "${YELLOW}⚠️  Potential dead code issues: $DEAD_CODE_ISSUES types${NC}"
fi

# 6. Security Issues (Basic Check)
echo -e "\n${BLUE}6. Basic Security Issues${NC}"
echo "-------------------------"
SECURITY_ISSUES=0

# Check for hardcoded secrets/passwords
SECRET_COUNT=$(grep -r "password\s*=\|secret\s*=\|key\s*=\|token\s*=" . --include="*.ts" --include="*.js" --exclude-dir=node_modules --exclude-dir=typechain-types | grep -v "// " | wc -l)
if [ "$SECRET_COUNT" -gt 0 ]; then
    echo -e "${RED}❌ Potential hardcoded secrets: $SECRET_COUNT instances${NC}"
    ((SECURITY_ISSUES++))
fi

# Check for eval usage
EVAL_COUNT=$(grep -r "eval(" . --include="*.ts" --include="*.js" --exclude-dir=node_modules --exclude-dir=typechain-types | wc -l)
if [ "$EVAL_COUNT" -gt 0 ]; then
    echo -e "${RED}❌ Dangerous eval() usage: $EVAL_COUNT instances${NC}"
    ((SECURITY_ISSUES++))
fi

if [ $SECURITY_ISSUES -eq 0 ]; then
    echo -e "${GREEN}✅ Basic security check: PASSED${NC}"
else
    echo -e "${RED}❌ Security issues found: $SECURITY_ISSUES types${NC}"
    ((ERRORS++))
fi

# 7. Package Security Audit
echo -e "\n${BLUE}7. Package Security Audit${NC}"
echo "-------------------------"
if npm audit --audit-level=moderate 2>/dev/null; then
    echo -e "${GREEN}✅ Package security: PASSED${NC}"
else
    echo -e "${YELLOW}⚠️  Package security issues found (run 'npm audit' for details)${NC}"
fi

# Final Summary
echo -e "\n${BLUE}================================================${NC}"
echo -e "${BLUE}VALIDATION SUMMARY${NC}"
echo -e "${BLUE}================================================${NC}"

if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}🎉 ALL VALIDATIONS PASSED!${NC}"
    echo -e "${GREEN}Your code is ready for production.${NC}"
    exit 0
else
    echo -e "${RED}❌ FOUND $ERRORS CRITICAL ISSUES${NC}"
    echo -e "${RED}Please fix the issues above before proceeding.${NC}"
    exit 1
fi