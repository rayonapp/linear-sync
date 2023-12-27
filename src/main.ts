import * as core from '@actions/core'
import * as github from '@actions/github'

export async function run(): Promise<void> {
  try {
    const token: string = core.getInput('token')

    const octokit = github.getOctokit(token)
    const latestRelease = await octokit.rest.repos.getLatestRelease({
      ...github.context.repo
    })

    console.log('latest release', latestRelease.data.name)

    // Fetch pull requests between the latest release and the latest commit on the main branch
    const pullRequests = await octokit.rest.pulls.list({
      ...github.context.repo,
      base: 'dev',
      state: 'closed',
      sort: 'updated',
      direction: 'desc',
      per_page: 100 // Adjust as needed
    })

    // Filter pull requests that were merged between the specified commits
    const mergedPRs = pullRequests.data.filter(
      pr =>
        pr.merged_at && pr.merged_at >= (latestRelease?.data?.published_at ?? 0)
    )

    console.log(`${mergedPRs.length} found`)

    const linearTickets = (
      await Promise.all(
        mergedPRs.map(async pr => {
          console.log(`${pr.title} PR found`)
          const comments = await octokit.rest.issues.listComments({
            ...github.context.repo,
            issue_number: Number(pr.number)
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
