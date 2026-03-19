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
    const stateId = core.getInput('stateId')

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

    // Resolve the target state name from the provided stateId
    let targetStateName: string | undefined
    if (stateId) {
      const targetState = await linearClient.workflowState(stateId)
      targetStateName = targetState.name
      console.log(`Target state name: "${targetStateName}"`)
    }

    // Group tickets by team
    console.log('Fetching tickets and grouping by team...')
    const ticketsWithTeams = await Promise.all(
      linearTickets.map(async ref => {
        const ticket = await linearClient.issue(ref)
        const team = await ticket.team
        return { ref, ticket, team }
      })
    )

    const teamGroups = new Map<
      string,
      { team: NonNullable<(typeof ticketsWithTeams)[number]['team']>; entries: typeof ticketsWithTeams }
    >()
    for (const entry of ticketsWithTeams) {
      if (!entry.team) {
        console.warn(`Ticket ${entry.ref} has no team, skipping`)
        continue
      }
      const existing = teamGroups.get(entry.team.id)
      if (existing) {
        existing.entries.push(entry)
      } else {
        teamGroups.set(entry.team.id, { team: entry.team, entries: [entry] })
      }
    }

    console.log(`Found ${teamGroups.size} team(s) across ${linearTickets.length} ticket(s)`)

    // Process each team
    for (const [teamId, { team, entries }] of teamGroups) {
      console.log(`Processing team "${team.name}" (${teamId}) with ${entries.length} ticket(s)`)

      // Get or create "Releases" parent label for this team
      const labels = await linearClient.issueLabels({
        filter: { name: { eq: 'Releases' }, team: { id: { eq: teamId } } }
      })
      let parentId = labels.nodes[0]?.id
      if (!parentId) {
        console.log(`Releases label doesn't exist for team "${team.name}", creating it...`)
        parentId = (
          await (
            await linearClient.createIssueLabel({ name: 'Releases', teamId })
          ).issueLabel
        )?.id as string
      }

      // Create release label for this team
      console.log(`Creating release label "${releaseLabelName}" for team "${team.name}"...`)
      const releaseLabel = await (
        await linearClient.createIssueLabel({
          name: releaseLabelName,
          parentId,
          teamId
        })
      ).issueLabel
      if (!releaseLabel) {
        console.error(`Cannot create release label for team "${team.name}", skipping`)
        continue
      }

      // Resolve the equivalent stateId for this team
      let teamStateId: string | undefined
      if (targetStateName) {
        const teamStates = await team.states()
        const matchingState = teamStates.nodes.find(
          s => s.name === targetStateName
        )
        if (matchingState) {
          teamStateId = matchingState.id
        } else {
          console.warn(
            `Team "${team.name}" has no state named "${targetStateName}", skipping state update for this team`
          )
        }
      }

      // Update tickets in this team
      for (const { ref, ticket } of entries) {
        try {
          console.log(`Updating ticket ${ref}`)
          const updatePayload: { labelIds: string[]; stateId?: string } = {
            labelIds: [releaseLabel.id, ...ticket.labelIds].filter(Boolean)
          }
          if (teamStateId) {
            updatePayload.stateId = teamStateId
          }
          await ticket.update(updatePayload)
        } catch (e) {
          console.error(e)
        }
      }
    }
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
