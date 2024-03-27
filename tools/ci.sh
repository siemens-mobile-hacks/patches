#!/bin/bash
set -e
set -x

cd $(dirname $0)/../

export TZ=
export LC_ALL=C

npm install
node .
git add patches
git commit -m "sync" --author="github-actions[bot] <github-actions[bot]@users.noreply.github.com>"
git push
