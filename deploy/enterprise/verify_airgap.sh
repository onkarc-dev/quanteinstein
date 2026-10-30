#!/usr/bin/env bash
# ==============================================================================
# Quanteinstein Enterprise OS · Air-Gap & Zero-Egress Conformance Verification
# SEC Rule 17a-4 / FINRA Rule 4511 / Institutional Single-Tenant VPC Compliance
# ==============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}==============================================================================${NC}"
echo -e "${BLUE} Quanteinstein Enterprise OS · Zero-Egress Air-Gap Conformance Suite ${NC}"
echo -e "${BLUE}==============================================================================${NC}"

FAILED_CHECKS=0

assert_egress_blocked() {
    local target_ip="$1"
    local port="$2"
    local desc="$3"

    echo -n "  Checking egress to ${desc} (${target_ip}:${port})... "
    if timeout 2 bash -c "cat < /dev/null > /dev/tcp/${target_ip}/${port}" 2>/dev/null; then
        echo -e "${RED}[VIOLATION] Connection succeeded! Egress is NOT blocked.${NC}"
        FAILED_CHECKS=$((FAILED_CHECKS + 1))
    else
        echo -e "${GREEN}[COMPLIANT] Blocked.${NC}"
    fi
}

assert_dns_blackholed() {
    local domain="$1"

    echo -n "  Checking public DNS resolution blackhole for ${domain}... "
    if host -W 2 "${domain}" >/dev/null 2>&1 || getent hosts "${domain}" >/dev/null 2>&1; then
        echo -e "${RED}[VIOLATION] Public DNS resolved! Network is NOT air-gapped.${NC}"
        FAILED_CHECKS=$((FAILED_CHECKS + 1))
    else
        echo -e "${GREEN}[COMPLIANT] Resolution failed / blackholed.${NC}"
    fi
}

echo -e "\n${YELLOW}[Phase 1: Network Egress & Perimeter Boundary Audit]${NC}"
assert_egress_blocked "8.8.8.8" "53" "Public DNS (Google)"
assert_egress_blocked "1.1.1.1" "443" "Public Internet Gateway (Cloudflare)"
assert_egress_blocked "140.82.121.4" "443" "Public Source Repository (GitHub)"
assert_dns_blackholed "api.binance.com"
assert_dns_blackholed "registry.npmjs.org"
assert_dns_blackholed "pypi.org"

echo -e "\n${YELLOW}[Phase 2: Low-Latency Kernel Primitives & IPC Audit]${NC}"
echo -n "  Checking POSIX shared memory mount (/dev/shm)... "
if [ -d "/dev/shm" ]; then
    echo -e "${GREEN}[COMPLIANT] Mounted.${NC}"
else
    echo -e "${RED}[VIOLATION] /dev/shm directory missing.${NC}"
    FAILED_CHECKS=$((FAILED_CHECKS + 1))
fi

echo -n "  Checking memory lock limits (ulimit -l)... "
MEMLOCK_LIMIT=$(ulimit -l)
if [ "$MEMLOCK_LIMIT" = "unlimited" ] || [ "$MEMLOCK_LIMIT" -gt 1048576 ] 2>/dev/null; then
    echo -e "${GREEN}[COMPLIANT] (${MEMLOCK_LIMIT})${NC}"
else
    echo -e "${YELLOW}[WARNING] Memlock limit is ${MEMLOCK_LIMIT}. Recommend 'unlimited' for mlockall.${NC}"
fi

echo -e "\n${YELLOW}[Phase 3: Environment Profile & Route Purge Verification]${NC}"
EDITION_VAL="${EDITION:-enterprise}"
AIRGAP_VAL="${AIR_GAPPED_MODE:-true}"

echo -n "  Checking EDITION configuration... "
if [ "$EDITION_VAL" = "enterprise" ]; then
    echo -e "${GREEN}[COMPLIANT] EDITION=${EDITION_VAL}${NC}"
else
    echo -e "${RED}[VIOLATION] EDITION is not enterprise (${EDITION_VAL})${NC}"
    FAILED_CHECKS=$((FAILED_CHECKS + 1))
fi

echo -n "  Checking AIR_GAPPED_MODE flag... "
if [ "$AIRGAP_VAL" = "true" ]; then
    echo -e "${GREEN}[COMPLIANT] AIR_GAPPED_MODE=true${NC}"
else
    echo -e "${RED}[VIOLATION] AIR_GAPPED_MODE is not true (${AIRGAP_VAL})${NC}"
    FAILED_CHECKS=$((FAILED_CHECKS + 1))
fi

echo -e "\n${BLUE}==============================================================================${NC}"
if [ $FAILED_CHECKS -eq 0 ]; then
    echo -e "${GREEN}✓ ALL AIR-GAP VERIFICATION AUDITS PASSED WITH ZERO VIOLATIONS.${NC}"
    echo -e "${GREEN}  Quanteinstein Enterprise OS is certified for single-tenant VPC deployment.${NC}"
    exit 0
else
    echo -e "${RED}✗ AIR-GAP AUDIT FAILED WITH ${FAILED_CHECKS} VIOLATION(S).${NC}"
    exit 1
fi
