#!/bin/bash
set -e
set -x

cd $(dirname $0)/../

npm install
node .

export TZ=

git config --local user.email "41898282+github-actions[bot]@users.noreply.github.com"
git config --local user.name "github-actions[bot]"

git diff --exit-code patches || {
	git stash
	git pull
	git stash pop
	git add patches deleted
	git commit -m "sync"
	git push
}

git config --local --unset user.email
git config --local --unset user.name
