#!/bin/bash
npx tsx --tsconfig=tsconfig.dev.json node_modules/jasmine/bin/jasmine --config=$1
