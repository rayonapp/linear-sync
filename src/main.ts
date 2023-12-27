import * as core from '@actions/core'
import * as github from '@actions/github'
import { LinearClient } from '@linear/sdk'

export async function run(): Promise<void> {
  try {
    const token: string = core.getInput('token')
    const apiKey: string = core.getInput('linearApiKey')
    const releaseLabelName: string = core.getInput('releaseLabel')

    const linearClient = new LinearClient({ apiKey })

    const octokit = github.getOctokit(token)

    console.log('Getting Latest release...')
    const latestRelease = await octokit.rest.repos.getLatestRelease({
      ...github.context.repo
    })
    console.log('Latest release found:', latestRelease.data.name)

    console.log('Getting pull requests...')
    const pullRequests = await octokit.rest.pulls.list({
      ...github.context.repo,
      base: 'dev',
      state: 'closed',
      sort: 'updated',
      direction: 'desc',
      per_page: 100 // Adjust as needed
    })
    const mergedPRs = pullRequests.data.filter(
      pr =>
        pr.merged_at && pr.merged_at >= (latestRelease?.data?.published_at ?? 0)
    )

    console.log(`${mergedPRs.length} merged since last release`)

    const linearTickets = (
      await Promise.all(
        mergedPRs.map(async pr => {
          console.log(`Getting comment from PR #${pr.number}`)
          const comments = await octokit.rest.issues.listComments({
            ...github.context.repo,
            issue_number: Number(pr.number)
          })
          const linearComment = comments.data.find(
            c => c.performed_via_github_app?.name === 'Linear'
          )
          const ticket = linearComment?.body?.match(/\bRAY-\d+\b/)
          if (ticket) {
            console.log(`Found ticket ${ticket}`)
          }
          return ticket?.[0]
        })
      )
    ).filter((t): t is string => Boolean(t))

    console.log('Getting Releases label')
    const labels = await linearClient.issueLabels({
      filter: { name: { eq: 'Releases' } }
    })
    let parentId = labels.nodes[0]?.id
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
      await linearClient.createIssueLabel({ name: releaseLabelName, parentId })
    ).issueLabel
    for (const ref of linearTickets) {
      try {
        console.log(`Updating ticket ${ref}`)
        const ticket = await linearClient.issue(ref)
        await ticket.update({
          labelIds: [releaseLabel!.id, ...ticket.labelIds].filter(Boolean)
        })
      } catch (e) {
        console.error(e)
      }
    }
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
