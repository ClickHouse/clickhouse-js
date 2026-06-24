#!/usr/bin/env python3
"""Assert that chdt-parse rejects the deliberately-unsupported types."""

import argparse
import subprocess
import sys


def read_cases(path):
    cases = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                cases.append(line)
    return cases


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tool", required=True)
    ap.add_argument("--cases", required=True)
    args = ap.parse_args()

    cases = read_cases(args.cases)
    failures = 0
    for type_str in cases:
        out = subprocess.run([args.tool, type_str], capture_output=True, text=True)
        if out.returncode != 0:
            print(f"  ok  rejected: {type_str}")
        else:
            failures += 1
            print(f"FAIL  unexpectedly accepted: {type_str}")

    print(f"\n{len(cases) - failures}/{len(cases)} correctly rejected")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
