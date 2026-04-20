# Release process

Tools required:

- Node.js >= `20.x`
- NPM >= `11.x`
- jq (https://stedolan.github.io/jq/)

We prefer to keep versions the same across the packages, and release all at once, even if there were no changes in some.

Bump the version:

```bash
# get the current version
cat packages/client-common/package.json | grep '"version":'
# update the version appropriately and set it to the environment variable
export NEW_VERSION=[new_version]
```

Make sure that the working directory is up to date and clean:

```bash
git checkout main
git pull
git clean -dfX
```

```bash
git checkout -b release-$NEW_VERSION
.scripts/update_version.sh "$NEW_VERSION"
```

Commit the version update and push it to the repository:

```bash
git add .
git commit -m "chore: bump version to $NEW_VERSION"
git push -u origin release-$NEW_VERSION
```

Create a PR and merge it. Wait for the CI/CD pipeline to publish a signed `head` version.

After the package is published it can be tested in a separate project by installing it with the `head` tag:

```bash
npm install @clickhouse/client@head
```

and run a simple e2e test: https://github.com/ClickHouse/clickhouse-js/actions/workflows/npm.yml

Promote the `head` tag to `latest`:

```bash
npm dist-tag add @clickhouse/client-common@head latest
npm dist-tag add @clickhouse/client@head latest
npm dist-tag add @clickhouse/client-web@head latest
```

Check that the packages have been published correctly: <https://www.npmjs.com/org/clickhouse>

Then create a new release in GitHub using the created tag and the corresponding changelog notes.

All done, thanks!
