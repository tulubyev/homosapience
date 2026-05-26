#!/usr/bin/env python3
"""
HSI Gonka Integration — Master Test Runner

Runs all test suites and prints consolidated results.
"""
import subprocess
import sys

suites = [
    ("Core Modules (Expression, Antibot, Translation, Bond)", "tests/test_all.py"),
    ("Fine-Tuning Pipeline (Dataset, Trainer, Quality Gates)", "tests/test_finetune.py"),
]

total_run = total_fail = total_err = 0
all_passed = True

for name, path in suites:
    print(f"\n{'─'*60}")
    print(f"▶  {name}")
    print(f"{'─'*60}")
    result = subprocess.run(
        [sys.executable, path],
        capture_output=False,
        cwd="/home/claude/hsi_gonka",
    )
    if result.returncode != 0:
        all_passed = False

print(f"\n{'═'*60}")
print(f"  FINAL RESULT: {'✅  ALL SUITES PASSED' if all_passed else '❌  FAILURES FOUND'}")
print(f"{'═'*60}\n")
sys.exit(0 if all_passed else 1)
