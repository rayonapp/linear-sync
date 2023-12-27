import * as core from '@actions/core'
import * as github from '@actions/github'
import { LinearClient } from '@linear/sdk'

export async function run(): Promise<void> {
  try {
    const token: string = core.getInput('token')
    const apiKey: string = core.getInput('linearApiKey')

    const linearClient = new LinearClient({ apiKey })

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
    ).filter(Boolean) as string[]

    console.log(`Tickets found ${linearTickets.join()}`)

    const labels = await linearClient.issueLabels({
      filter: { name: { eq: 'Releases' } }
    })
    let parentId = labels.nodes[0].id
    if (!parentId) {
      console.log(`Releases label doesn't exist, creating it...`)
      parentId = (
        await (
          await linearClient.createIssueLabel({ name: 'Releases' })
        ).issueLabel
      )?.id as string
    }
    console.log('Creating new version label...')
    const releaseLabel = await (
      await linearClient.createIssueLabel({ name: 'v1.0.0', parentId })
    ).issueLabel
    console.log(releaseLabel?.id)
    for (const ref of linearTickets) {
      const ticket = await linearClient.issue(ref)
      await ticket.update({
        labelIds: [...releaseLabel!.id, ...ticket.labelIds]
      })
    }
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
