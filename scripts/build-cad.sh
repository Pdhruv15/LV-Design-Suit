#!/usr/bin/env bash
# Builds the built-in DWG / DXF reader (engines/cad-reader, acadrust) to WebAssembly into src/engines/cad/generated.
# Needs Rust with the wasm32-unknown-unknown target and wasm-bindgen-cli at the version pinned in Cargo.toml:
#   rustup target add wasm32-unknown-unknown && cargo install wasm-bindgen-cli --version 0.2.129 --locked
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"
# Keep local folders (home, registry, checkout) out of the WebAssembly's panic messages (privacy check);
# the most specific prefix comes last, because the last match wins.
export RUSTFLAGS="--remap-path-prefix=$HOME=/build --remap-path-prefix=$HOME/.rustup=/rustup --remap-path-prefix=$HOME/.cargo/registry/src=/cargo --remap-path-prefix=$PWD=/lvds"
cargo build --release --target wasm32-unknown-unknown --manifest-path engines/cad-reader/Cargo.toml
wasm-bindgen --target web --out-dir src/engines/cad/generated \
  engines/cad-reader/target/wasm32-unknown-unknown/release/lvds_cad_reader.wasm
