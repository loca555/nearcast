#!/bin/bash
# Сборка NearCast Rust-контракта для NEAR
#
# NEAR VM (protocol ≤82) не поддерживает bulk-memory, sign-ext и другие
# WASM-фичи, включённые в Rust 1.82+. Поэтому после сборки cargo
# нужна пост-обработка через wasm-opt для понижения до MVP.
#
# Зависимости: cargo, wasm-opt (npm install -g binaryen)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "═══ NearCast — Сборка контракта ═══"

# 1. Сборка через cargo
echo "→ cargo build --release..."
RUSTFLAGS='-C link-arg=-s' cargo build --target wasm32-unknown-unknown --release

WASM_IN="target/wasm32-unknown-unknown/release/nearcast.wasm"
WASM_OUT="target/wasm32-unknown-unknown/release/nearcast-mvp.wasm"

# 2. Пост-обработка: понижение WASM-фич до MVP для совместимости с NEAR VM
echo "→ wasm-opt: понижение bulk-memory, sign-ext, nontrapping-fptoint..."
wasm-opt \
  --enable-bulk-memory \
  --enable-mutable-globals \
  --enable-sign-ext \
  --enable-nontrapping-float-to-int \
  --llvm-memory-copy-fill-lowering \
  --signext-lowering \
  --llvm-nontrapping-fptoint-lowering \
  -Oz \
  --strip-debug \
  "$WASM_IN" \
  -o "$WASM_OUT"

SIZE=$(stat -c%s "$WASM_OUT" 2>/dev/null || stat -f%z "$WASM_OUT" 2>/dev/null || wc -c < "$WASM_OUT")
echo ""
echo "✓ Готово: $WASM_OUT ($SIZE байт)"
echo "  Деплой: near deploy <account> $WASM_OUT --networkId testnet"
