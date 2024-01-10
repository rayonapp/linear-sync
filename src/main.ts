import * as core from '@actions/core'
import * as github from '@actions/github'
import { LinearClient } from '@linear/sdk'

export async function run(): Promise<void> {
  try {
    const token: string = core.getInput('token')
    const apiKey: string = core.getInput('linearApiKey')
    const ticketPrefix: string = core.getInput('ticketPrefix')
    const releaseLabelName: string = core.getInput('releaseLabel')
    const baseBranch = core.getInput('baseBranch')
    const maxPrLength = core.getInput('maxPrLength')

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
      base: baseBranch,
      state: 'closed',
      sort: 'updated',
      direction: 'desc',
      per_page: Number(maxPrLength)
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
          const ticket = linearComment?.body?.match(
            new RegExp(`\\b${ticketPrefix}-\\d+\\b`) // eslint-disable-line no-useless-escape
          )
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
    if (!releaseLabel) {
      throw new Error('Cannot retrieve new version label')
    }
    for (const ref of linearTickets) {
      try {
        console.log(`Updating ticket ${ref}`)
        const ticket = await linearClient.issue(ref)
        await ticket.update({
          labelIds: [releaseLabel.id, ...ticket.labelIds].filter(Boolean)
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
