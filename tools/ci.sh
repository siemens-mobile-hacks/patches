#!/bin/bash
set -e
set -x

cd $(dirname $0)/../

# patches.kibab.com timezone
export TZ=Europe/Moscow
export LC_ALL=C

npm install
node .
git add patches
git commit -m "sync"
git commit --amend --author="github-actions[bot] <github-actions[bot]@users.noreply.github.com>" --no-edit
