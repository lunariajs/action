import * as core from '@actions/core';
import * as github from '@actions/github';
import { createLunaria } from '@lunariajs/core';
import { getCollapsedPath } from '@lunariajs/core/dashboard';
import { markdownTable } from 'markdown-table';
import {
	body,
	commentSummary,
	deleteExistingComment,
	notes,
	overviewTracked,
	overviewUntracked,
	trackedFilesDetails,
	warnings,
} from './comment.js';
import type { Files, Octokit, PullRequest, WorkflowRun } from './types.js';

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
				`Failed to change working directory to ${workingDirectory}. Is the path correct?`,
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
	isIgnored: boolean,
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

/**
 * Gets the pull request number from the event, or from the triggering `pull_request`
 * workflow when running on `workflow_run`.
 */
async function getPullRequestNumber(octokit: Octokit) {
	const { eventName, payload, repo } = github.context;

	if (eventName === 'workflow_run') {
		const run = payload.workflow_run as WorkflowRun | undefined;

		if (run?.event !== 'pull_request') {
			core.notice('Skipped, the workflow run was not triggered by a pull request.');
			return;
		}

		if (run.conclusion !== 'success') {
			core.notice(`Skipped, the triggering workflow run didn't succeed (${run.conclusion}).`);
			return;
		}

		if (!run.head_repository || !run.head_branch) {
			core.notice('Skipped, could not find the head branch of the workflow run.');
			return;
		}

		// `workflow_run.pull_requests` is empty for pull requests from forks.
		const { data: pullRequests } = await octokit.rest.pulls.list({
			...repo,
			state: 'open',
			head: `${run.head_repository.owner.login}:${run.head_branch}`,
		});

		const pullRequest = pullRequests.find((pr) => pr.head.sha === run.head_sha);

		if (!pullRequest) {
			core.notice(`Skipped, could not find an open pull request for commit ${run.head_sha}.`);
			return;
		}

		return pullRequest.number;
	}

	if (!payload.pull_request) {
		core.notice('Skipped, could not find the pull request context.');
		return;
	}

	if (payload.action !== 'opened' && payload.action !== 'synchronize') {
		core.notice('Skipped, Lunaria action only runs during pull request opening/synchronization.');
		return;
	}

	return payload.pull_request.number;
}

async function main() {
	const octokit = github.getOctokit(core.getInput('token'));

	const pullRequestNumber = await getPullRequestNumber(octokit);
	if (pullRequestNumber === undefined) return;

	const workingDirectory = core.getInput('working-directory');
	setWorkingDirectory(workingDirectory);

	const lunaria = await createLunaria();
	const config = lunaria.config;

	const pullRequestContext = {
		...github.context.repo,
		pull_number: pullRequestNumber,
		issue_number: pullRequestNumber,
	};

	const { data: pullRequest } = await octokit.rest.pulls.get(pullRequestContext);

	const pullRequestFiles = await octokit.paginate(
		octokit.rest.pulls.listFiles,
		{
			...pullRequestContext,
			per_page: 100,
		},
		(response) => response.data,
	);

	const trackedFiles = pullRequestFiles.filter((file) =>
		lunaria.findFilesEntry(unrootFilename(config.repository.rootDir, file.filename)),
	);

	if (!trackedFiles.length) {
		core.notice("This pull request doesn't include any tracked files.");
		// Remove any previous summary so it doesn't go stale if all tracked files were removed.
		// If tracked files are added again later, a fresh comment will be created.
		await deleteExistingComment(octokit, pullRequestContext);
		return;
	}

	const { overview, isIgnored } = getStatusOverview(
		pullRequest.title,
		config.tracking.ignoredKeywords,
	);
	const trackedFilesTable = await getTrackedFilesTable(
		pullRequest,
		trackedFiles,
		lunaria,
		isIgnored,
	);

	await commentSummary(octokit, pullRequestContext, body(overview, trackedFilesTable));
}

main().catch((e) => {
	core.setFailed(e.message);
});
