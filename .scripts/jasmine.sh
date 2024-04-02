#!/bin/bash
ts-node -r tsconfig-paths/register -r source-map-support/register --transpileOnly --project=tsconfig.dev.json node_modules/jasmine/bin/jasmine --config=$1
