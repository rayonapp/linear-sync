import * as core from '@actions/core'
import * as github from '@actions/github'

export async function run(): Promise<void> {
  try {
    const mainBranch: string = core.getInput('mainBranch') ?? 'dev'
    const token: string = core.getInput('token')

    const octokit = github.getOctokit(token)
    const latestRelease = await octokit.rest.repos.getLatestRelease({
      ...github.context.repo
    })

    console.log('latest release', latestRelease.data.name)

    const mainBranchRes = await octokit.rest.repos.getBranch({
      ...github.context.repo,
      branch: mainBranch
    })

    console.log(JSON.stringify(mainBranchRes.data))
    const toSha = // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mainBranchRes.data as any[0] as unknown as typeof mainBranchRes.data)
        ?.commit.sha

    const fromSha = latestRelease.data.target_commitish

    const commits = await octokit.rest.repos.compareCommits({
      ...github.context.repo,
      base: fromSha,
      head: toSha
    })

    const prNumbers = commits.data.commits
      .map(commit => {
        const match = commit.commit.message.match(/Merge pull request #(\d+)/)
        return match ? match[1] : null
      })
      .filter(Boolean) as string[]

    console.log(`${prNumbers.length} found`)

    const linearTickets = (
      await Promise.all(
        prNumbers.map(async prNumber => {
          console.log(`${prNumber} PR found`)
          const comments = await octokit.rest.issues.listComments({
            ...github.context.repo,
            issue_number: Number(prNumber)
          })
          const linearComment = comments.data.find(
            c => c.performed_via_github_app?.name === 'Linear'
          )
          const ticket = linearComment?.body?.match(/\bRAY-\d+\b/)
          return ticket?.[0]
        })
      )
    ).filter(Boolean)

    console.log(`Tickets found ${linearTickets.join()}`)
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
