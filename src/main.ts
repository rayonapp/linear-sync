import * as core from '@actions/core'
import * as github from '@actions/github'

export async function run(): Promise<void> {
  try {
    // const mainBranch: string = core.getInput('mainBranch') ?? 'dev'
    const token: string = core.getInput('token')

    const octokit = github.getOctokit(token)
    const latestRelease = await octokit.rest.repos.getLatestRelease({
      ...github.context.repo
    })

    console.log('latest release', latestRelease.data.name)

    const pullRequests = await octokit.rest.pulls.list({
      ...github.context.repo,
      base: 'dev',
      head: latestRelease.data.target_commitish,
      state: 'closed'
    })
    console.log(`${pullRequests.data.length} found`)

    const linearTickets = (
      await Promise.all(
        pullRequests.data.map(async pr => {
          console.log(`${pr.title} PR found`)
          const comments = await octokit.rest.issues.listComments({
            ...github.context.repo,
            issue_number: pr.number
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
