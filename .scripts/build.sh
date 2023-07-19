#!/bin/bash
rm -rf out dist
tsc
mkdir -p dist
mv out/$1/src/* dist/
