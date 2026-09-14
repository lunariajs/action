import * as core from '@actions/core';
import * as github from '@actions/github';
import { createLunaria } from '@lunariajs/core';
import { getCollapsedPath } from '@lunariajs/core/dashboard';
import { markdownTable } from 'markdown-table';
import {
	body,
	commentSummary,
	notes,
	overviewTracked,
	overviewUntracked,
	trackedFilesDetails,
	warnings,
} from './comment.js';
import type { Files, PullRequest } from './types.js';

type LunariaInstance = Awaited<ReturnType<typeof createLunaria>>;

/**
 * Sets the current working directory to the one specified by the `working-directory` input.
 * Necessary to allow for monorepo support.
 */
function setWorkingDirectory(workingDirectory?: string) {
	if (workingDirectory) {
		try {
			process.chdir(workingDirectory);
		} catch {
			core.setFailed(
				`Failed to change working directory to ${workingDirectory}. Is the path correct?`
			);
			process.exit(1);
		}
	}
}

/**
 * Removes the root directory of a given filename.
 * This is necessary since Lunaria's glob patterns are based on the cwd
 * and won't account for the root directory by default.
 */
function unrootFilename(root: string, filename: string) {
	if (root === '.') return filename;
	const rootDir = `${root}/`;

	if (filename.startsWith(rootDir)) return filename.replace(rootDir, '');
	return filename;
}

function getStatusOverview(title: string, ignoredKeywords: string[]) {
	const match =
		ignoredKeywords.length > 0
			? title.match(new RegExp(`(${ignoredKeywords.join('|')})`, 'i'))?.at(0)
			: undefined;

	return {
		overview: match ? overviewUntracked(match) : overviewTracked,
		isIgnored: !!match,
	};
}

async function getTrackedFilesTable(
	pullRequest: PullRequest,
	trackedFiles: Files,
	lunaria: LunariaInstance,
	isIgnored: boolean
) {
	const { repository, dashboard } = lunaria.config;
	const rows: string[][] = [];

	for (const file of trackedFiles) {
		const foundWarnings: Array<keyof typeof warnings> = [];

		const rootlessFilename = unrootFilename(repository.rootDir, file.filename);
		const collapsedPath = getCollapsedPath(dashboard, rootlessFilename);

		const statusType = (status: Files[number]['status']) => {
			// It might be necessary to rethink these according to how Git
			// handles the different statuses.
			switch (status) {
				case 'renamed':
				case 'copied':
					return 'added';
				case 'modified':
					return 'changed';
				default:
					return status;
			}
		};

		const fileStatus = await lunaria.getFileStatus(rootlessFilename);
		const isSourceFile = fileStatus?.source?.path === rootlessFilename;

		const createdDate = new Date(pullRequest.created_at);
		// Don't go after the latest source change if the source file is part of the PR, assume creation date of PR.
		// If it wasn't possible to find the latest source change date, we assume it isn't possibly outdated.
		const latestSourceChange =
			!isSourceFile && fileStatus
				? new Date(fileStatus.source.git.latestTrackedCommit.date)
				: createdDate;

		if (latestSourceChange > createdDate) foundWarnings.push('outdated');

		const warningIcons = foundWarnings.map((k) => warnings[k].icon).join(' ');
		const key = `${isSourceFile ? 'source' : 'localization'}-${statusType(file.status)}` as const;
		const note = `${notes[key]} ${warningIcons}`;

		rows.push([`[${collapsedPath}](${file.blob_url})`, note]);
	}

	const filesTable = markdownTable([['File', 'Note'], ...rows]);
	const warningsTable = markdownTable([
		['Icon', 'Description'],
		...Object.values(warnings).map(({ icon, description }) => [icon, description]),
	]);

	return trackedFilesDetails(filesTable, warningsTable, isIgnored);
}

async function main() {
	const context = github.context;
	const payload = context.payload;

	if (!payload.pull_request) {
		core.notice('Skipped, could not find the pull request context.');
		return;
	}

	if (!payload.repository) {
		core.notice('Skipped, could not find pull request repository.');
		return;
	}

	if (payload.action !== 'opened' && payload.action !== 'synchronize') {
		core.notice('Skipped, Lunaria action only runs during pull request opening/synchronization.');
		return;
	}

	const githubToken = core.getInput('token');
	const octokit = github.getOctokit(githubToken);

	const workingDirectory = core.getInput('working-directory');
	setWorkingDirectory(workingDirectory);

	const lunaria = await createLunaria();
	const config = lunaria.config;

	const pullRequestContext = {
		...context.repo,
		pull_number: payload.pull_request.number,
		issue_number: payload.pull_request.number,
	};

	const { data: pullRequest } = await octokit.rest.pulls.get(pullRequestContext);

	const pullRequestFiles = await octokit.paginate(
		octokit.rest.pulls.listFiles,
		{
			...pullRequestContext,
			per_page: 100,
		},
		(response) => response.data
	);

	const trackedFiles = pullRequestFiles.filter((file) =>
		lunaria.findFilesEntry(unrootFilename(config.repository.rootDir, file.filename))
	);

	if (!trackedFiles.length) {
		core.notice("This pull request doesn't include any tracked files.");
		return;
	}

	const { overview, isIgnored } = getStatusOverview(
		pullRequest.title,
		config.tracking.ignoredKeywords
	);
	const trackedFilesTable = await getTrackedFilesTable(
		pullRequest,
		trackedFiles,
		lunaria,
		isIgnored
	);

	await commentSummary(octokit, pullRequestContext, body(overview, trackedFilesTable));
}

main().catch((e) => {
	core.setFailed(e.message);
});
