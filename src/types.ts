import type { getOctokit } from '@actions/github';

export type Octokit = ReturnType<typeof getOctokit>;
export type Files = Awaited<ReturnType<Octokit['rest']['pulls']['listFiles']>>['data'];
export type PullRequest = Awaited<ReturnType<Octokit['rest']['pulls']['get']>>['data'];

export interface WorkflowRun {
	event: string;
	conclusion: string | null;
	head_sha: string;
	head_branch: string | null;
	head_repository: { owner: { login: string } } | null;
}
