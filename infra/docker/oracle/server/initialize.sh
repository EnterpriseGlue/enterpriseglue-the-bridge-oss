#!/bin/bash
set -euo pipefail
cp /etc/enterpriseglue/oracle-server/sqlnet.ora "$ORACLE_HOME/network/admin/sqlnet.ora"
