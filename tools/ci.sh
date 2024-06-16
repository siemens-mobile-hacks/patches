#!/bin/bash
set -e
set -x

cd $(dirname $0)/../

# Run update
npm install
node . --cookie=$KIBAB_TEST_USER "$@"
node src/get-bad-patches.js > bad.md

# Commit
git config --local core.hooksPath /notexistent
git config --local user.email "41898282+github-actions[bot]@users.noreply.github.com"
git config --local user.name "github-actions[bot]"

export TZ=
git diff --exit-code patches bad.md || {
	git stash
	git pull
	git stash pop
	git add patches bad.md
	git commit -m "sync"
	git push
}

# Reset git settings
git config --local --unset user.email
git config --local --unset user.name
