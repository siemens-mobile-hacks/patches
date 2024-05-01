#!/bin/bash
set -e
set -x

cd $(dirname $0)/../

npm install
node . --cookie=$KIBAB_TEST_USER "$@"

export TZ=

git config --local user.email "41898282+github-actions[bot]@users.noreply.github.com"
git config --local user.name "github-actions[bot]"

git diff --exit-code patches || {
	git stash
	git pull
	git stash pop
	git add patches
	git commit -m "sync"
	git push
}

git config --local --unset user.email
git config --local --unset user.name
