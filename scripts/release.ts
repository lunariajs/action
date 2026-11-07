/**
 * Publishes a new version of the action. Runs as the `publish` script of
 * `changesets/action` after the "[ci] release" PR is merged.
 *
 * `dist/` is gitignored on `main`, so we commit it on a detached HEAD and push:
 * - the `vX.Y.Z` tag, pinning that exact version.
 * - the release line branch (`v0.3` while on 0.x, `v1` after 1.0), which users
 *   can reference to receive non-breaking updates.
 *
 * Based on the release script used by `changesets/action` itself.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// This script force-pushes the public release line branch, so it should only
// ever run from the release workflow, never from a local checkout.
if (process.env.GITHUB_ACTIONS !== 'true') {
	console.error('The release script only runs in GitHub Actions. Merge the release PR instead.');
	process.exit(1);
}

process.chdir(join(import.meta.dirname, '..'));

const { name, version } = JSON.parse(readFileSync('package.json', 'utf-8')) as {
	name: string;
	version: string;
};
const tag = `v${version}`;
const isPrerelease = version.includes('-');
const [major, minor] = version.split('.');
// On 0.x every minor can be breaking, so the release line includes the minor.
const releaseLine = major === '0' ? `v0.${minor}` : `v${major}`;

function run(command: string, args: string[]) {
	execFileSync(command, args, { stdio: 'inherit' });
}

function remoteRefExists(ref: string) {
	try {
		execFileSync('git', ['ls-remote', '--exit-code', 'origin', ref], {
			stdio: 'ignore',
		});
		return true;
	} catch (e) {
		// `--exit-code` exits with 2 when no matching ref is found.
		if ((e as { status?: number }).status === 2) return false;
		throw e;
	}
}

// `changesets/action` reads the published tags from this file to create GitHub releases.
// It warns when the file is missing, so create it even when nothing is published.
const outputFile = process.env.CHANGESETS_OUTPUT;
if (outputFile) appendFileSync(outputFile, '');

if (remoteRefExists(`refs/tags/${tag}`)) {
	console.info(`Skipping release, ${tag} is already published.`);
	process.exit(0);
}

// Versions before this release flow were published as branches (e.g. `v0.2.0`).
// Creating a tag with the same name would make `lunariajs/action@v0.2.0` ambiguous.
if (remoteRefExists(`refs/heads/${tag}`)) {
	console.info(`Skipping release, ${tag} was already published as a branch.`);
	process.exit(0);
}

run('pnpm', ['build']);

run('git', ['checkout', '--detach']);
run('git', ['add', '--force', 'dist']);
run('git', ['commit', '-m', tag]);

// Fails if the tag already exists locally, instead of silently reusing it.
run('git', ['tag', '-a', tag, '-m', tag]);

if (isPrerelease) {
	run('git', ['push', 'origin', `refs/tags/${tag}`]);
} else {
	// `--atomic` makes sure the tag is never published without its release line branch.
	// Only the release line branch is force-pushed (`+`), never the tag.
	run('git', ['push', '--atomic', 'origin', `refs/tags/${tag}`, `+HEAD:refs/heads/${releaseLine}`]);
}

// Only report the tag once it's pushed, so a GitHub release is never created without it.
if (outputFile) {
	appendFileSync(outputFile, `${JSON.stringify({ type: 'git-tag', tag, packageName: name })}\n`);
}
console.info(`Published ${tag}`);
