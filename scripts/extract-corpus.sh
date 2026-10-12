#!/usr/bin/env bash
# One-time corpus sweep (plan step 0): dump every page of the rulebook to
# data/raw/page-NN.txt so the rest of the build reads text, never the 58 MB PDF.
set -euo pipefail
PDF="Magnagothica Maleghast/maleghast_update3.pdf"
mkdir -p data/raw
for p in $(seq -w 1 35); do
  pdftotext -f $((10#$p)) -l $((10#$p)) "$PDF" "data/raw/page-$p.txt"
done
echo "extracted $(ls data/raw/page-*.txt | wc -l) pages"
